"""CellCanvas learning on one copick reconstruction, through a CellCanvas core service.

A server-side binding file names, for one copick run/voxel spacing/reconstruction, a registered dataset of a
loopback CellCanvas core service (``cellcanvas_service``) that holds the image features, and the copick
segmentations that store painting and published predictions. The browser only names a binding by its ID, so it
cannot choose service URLs or filesystem paths.

The copick painting segmentation is the annotation of record: 0 is unannotated, positive IDs are the binding's
classes (a background class must be explicit). Before training, it is copied sparsely into the core dataset with
its revision. A prediction is published into copick only after the core reports a successful, current version.
A whole-volume prediction is written to a staging directory and swapped into place, so readers see the previous
complete prediction or the new complete one, never a partial write. A prediction of a region (for example the
current slice of a full-resolution reconstruction) rewrites only the storage chunks that region touches: the
publication is marked incomplete while they are written and complete again with their new checksums, so the client
refreshes it only once complete and an accept refuses it in between; an interrupted write stays incomplete until the
pending receipt is reconciled again, which rewrites the same chunks. Region predictions of the same model accumulate; one from a newer model
first clears the chunks that hold the older model's labels, so the displayed prediction always comes from one model.
Pending operation receipts are persisted beside the binding file, so an uncertain response or a page reload is
reconciled with the same operation ID instead of starting new work.

The core uses Zarr 3 and this server copick's Zarr 2; they share only HTTP and plain arrays.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import shutil
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
import numpy as np
import zarr

from .annotations import (
    UNIT_ANGSTROM,
    AnnotationError,
    Painting,
    SegmentationRef,
    _chunk_entry,
    _xyz,
    block_chunks,
    chunk_aligned,
    digest,
    proposal_record,
    record_proposal,
)

logger = logging.getLogger(__name__)

LOOPBACK = {"127.0.0.1", "localhost", "::1"}
AXES = ("z", "y", "x")
PREDICTION_CHUNKS = (256, 256, 256)  # chunk size of a prediction store created by a region publication


class CellCanvasError(AnnotationError):
    """A refused CellCanvas operation (``code`` and HTTP ``status`` are reported to the client)."""


@dataclass
class Binding:
    id: str
    run: str
    voxel_size: float
    tomo_type: str
    service_url: str
    dataset: str
    classes: list[dict]
    painting: SegmentationRef
    prediction: SegmentationRef
    project_id: Optional[str] = None
    config: Optional[str] = None
    features: dict = field(default_factory=dict)
    state_path: Optional[Path] = None
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    @property
    def class_ids(self) -> set[int]:
        return {int(c["id"]) for c in self.classes}

    def public(self) -> dict:
        return {
            "id": self.id,
            "run": self.run,
            "voxel_size": self.voxel_size,
            "tomo_type": self.tomo_type,
            "classes": self.classes,
            "painting": self.painting.__dict__,
            "prediction": self.prediction.__dict__,
            "features": self.features,
        }


def _segref(data: dict, what: str) -> SegmentationRef:
    return SegmentationRef.parse(data, what)


def load_bindings(path: str | os.PathLike) -> list[Binding]:
    """Read and validate a binding file (JSON ``{"bindings": [...]}``)."""
    path = Path(path).resolve()
    data = json.loads(path.read_text())
    state_dir = path.with_name(path.name + ".state")
    bindings = []
    for raw in data.get("bindings", []):
        url = urlparse(str(raw["service_url"]))
        if url.scheme != "http" or url.hostname not in LOOPBACK:
            raise ValueError(f"Binding {raw.get('id')}: service_url must be an http loopback URL")
        classes = raw.get("classes") or []
        ids = [int(c["id"]) for c in classes]
        if not ids or len(set(ids)) != len(ids) or min(ids) < 1 or max(ids) > 255:
            raise ValueError(f"Binding {raw.get('id')}: classes need unique IDs 1-255 (0 is unannotated)")
        binding = Binding(
            id=str(raw["id"]),
            run=str(raw["run"]),
            voxel_size=float(raw["voxel_size"]),
            tomo_type=str(raw["tomo_type"]),
            service_url=str(raw["service_url"]).rstrip("/"),
            dataset=str(raw["dataset"]),
            classes=[{"id": int(c["id"]), "name": str(c["name"]), "color": c.get("color")} for c in classes],
            painting=_segref(raw["painting"], "painting"),
            prediction=_segref(raw["prediction"], "prediction"),
            project_id=raw.get("project_id"),
            config=str(Path(raw["config"]).resolve()) if raw.get("config") else None,
            features=dict(raw.get("features") or {}),
            state_path=state_dir / f"{raw['id']}.json",
        )
        if binding.painting == binding.prediction:
            raise ValueError(f"Binding {binding.id}: painting and prediction must be different segmentations")
        bindings.append(binding)
    if len({b.id for b in bindings}) != len(bindings):
        raise ValueError("Binding IDs must be unique")
    return bindings


# --- copick side -------------------------------------------------------------------------------------------------


class Session:
    """Operations on one binding of one opened copick project."""

    def __init__(self, binding: Binding, service, client_factory=None):
        self.binding = binding
        self.service = service
        self._client_factory = client_factory or (lambda: httpx.Client(timeout=30))
        # An ordinary copick painting restricted to the bound classes, under the same per-segmentation lock as the
        # generic painting routes; the binding's own lock serializes prediction publication.
        self.painting = Painting(
            service, binding.run, binding.voxel_size, binding.tomo_type, binding.painting, binding.classes
        )

    # copick storage --------------------------------------------------------------------------------------------

    def tomogram_geometry(self) -> dict:
        return self.painting.grid()

    def _segmentation(self, ref: SegmentationRef):
        b = self.binding
        segs = self.service.get_segmentations(
            b.run, ref.name, ref.user_id, ref.session_id, b.voxel_size, seg_types=("multilabel",)
        )
        return segs[0] if segs else None

    def painting_state(self) -> dict:
        return self.painting.state()

    def paint(self, base_revision: Optional[str], strokes: list[dict], stroke_id: Optional[str] = None) -> dict:
        return self.painting.paint(base_revision, strokes, stroke_id)

    def undo(self, base_revision: Optional[str]) -> dict:
        return self.painting.undo(base_revision)

    def published_state(self) -> dict:
        seg = self._segmentation(self.binding.prediction)
        if seg is None:
            return {"exists": False}
        meta = zarr.open_group(seg.zarr(), mode="r").attrs.get("cellcanvas") or {}
        return {"exists": True, **meta}

    # core service ---------------------------------------------------------------------------------------------

    def _core(self, method: str, path: str, **kwargs) -> httpx.Response:
        url = f"{self.binding.service_url}/datasets/{self.binding.dataset}{path}"
        try:
            with self._client_factory() as client:
                return client.request(method, url, **kwargs)
        except httpx.HTTPError as error:
            raise CellCanvasError(f"CellCanvas service unreachable: {error}", "service_unavailable", 503) from None

    def _core_json(self, method: str, path: str, **kwargs) -> dict:
        response = self._core(method, path, **kwargs)
        data = response.json()
        if response.status_code >= 400:
            raise CellCanvasError(
                data.get("error", "CellCanvas service error"), data.get("code", "core_error"), response.status_code
            )
        return data

    def check(self) -> dict:
        """Compare the core dataset geometry with the copick reconstruction; matching names are not enough."""
        problems = []
        geometry = self.tomogram_geometry()
        try:
            core = self._core_json("GET", "")
        except CellCanvasError as error:
            return {"ok": False, "problems": [str(error)], "copick": geometry, "core": None}
        shape = geometry["shape"]
        for key in ("painting", "prediction"):
            if core[key]["shape"] != shape:
                problems.append(f"Core {key} shape {core[key]['shape']} differs from reconstruction {shape}.")
        for spatial in core["features"]["shapes"]:
            dims = [v for i, v in enumerate(spatial) if i != core["features"]["axis"] % 4]
            if dims != shape:
                problems.append(f"Feature spatial shape {dims} differs from reconstruction {shape}.")
        transform = core["spatial_transform"]
        units = set(transform["units"])
        if len(units) != 1 or next(iter(units)) not in UNIT_ANGSTROM:
            problems.append(f"Core units {sorted(units)} are not convertible to Å.")
        else:
            per_unit = UNIT_ANGSTROM[next(iter(units))]
            core_scale = [s * per_unit for s in transform["scale"]]
            core_translation = [t * per_unit for t in transform["translation"]]
            if not all(
                math.isclose(a, b, rel_tol=1e-6) for a, b in zip(core_scale, geometry["scale_angstrom"], strict=True)
            ):
                problems.append(f"Core voxel size {core_scale} Å differs from {geometry['scale_angstrom']} Å.")
            if not all(
                math.isclose(a, b, abs_tol=1e-3)
                for a, b in zip(core_translation, geometry["translation_angstrom"], strict=True)
            ):
                problems.append(f"Core origin {core_translation} Å differs from {geometry['translation_angstrom']} Å.")
            if not all(math.isclose(s, self.binding.voxel_size, rel_tol=1e-6) for s in geometry["scale_angstrom"]):
                problems.append("Reconstruction scale differs from its copick voxel spacing.")
        painting = self.painting_state()
        if painting["exists"] and painting["shape"] != shape:
            problems.append("Existing painting segmentation has a different shape.")
        return {"ok": not problems, "problems": problems, "copick": geometry, "core": core}

    # operation receipts ---------------------------------------------------------------------------------------

    def _read_state(self) -> dict:
        path = self.binding.state_path
        if path and path.exists():
            return json.loads(path.read_text())
        return {}

    def _write_state(self, state: dict) -> None:
        path = self.binding.state_path
        if path is None:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(state, indent=2))
        os.replace(temporary, path)

    def submit(self, kind: str, operation_id: str, region: Optional[dict] = None) -> dict:
        """Submit train or predict once per operation ID; a retry of the same ID returns its receipt.

        ``region`` (predict only) is ``{"z": [start, stop], "y": ..., "x": ...}`` in voxel indices, half-open; missing
        axes span the volume. Without it, or when it spans the whole volume, the whole volume is predicted.
        """
        if region is not None and kind != "predict":
            raise CellCanvasError("Only predict takes a region.", "invalid_request", 400)
        try:
            operation_id = uuid.UUID(operation_id).hex
        except (TypeError, ValueError, AttributeError):
            raise CellCanvasError("operation_id must be a UUID.", "invalid_request", 400) from None
        state = self._read_state()
        pending = state.get("pending")
        last = state.get("last") or {}
        if not pending and last.get("id") == operation_id:
            if last.get("kind") != kind:
                raise CellCanvasError("Operation ID was already used for another operation.", "operation_conflict")
            return self.reconcile()  # the receipt of a resolved retry, not a new submission
        if pending and pending["id"] != operation_id:
            raise CellCanvasError("Another operation is pending; reconcile it first.", "operation_pending")
        if pending and pending["kind"] != kind:
            raise CellCanvasError("Operation ID was already used for another operation.", "operation_conflict")
        check = self.check()
        if not check["ok"]:
            raise CellCanvasError("; ".join(check["problems"]), "geometry_mismatch")
        service_id = check["core"]["service_id"]
        region = _region(region, check["copick"]["shape"])
        if pending:
            if pending["service_id"] != service_id:
                return self.reconcile()
            response = self._core("GET", f"/operations/{operation_id}")
            if response.status_code == 200:
                return self.reconcile()
        pending = {"id": operation_id, "kind": kind, "service_id": service_id, "submitted_at": time.time()}
        if region is not None:
            pending["region"] = region
        if kind == "train":
            pending["painting_revision"] = self._sync_painting(service_id, check["copick"]["shape"])
        # Persist before submitting: a lost response is then reconciled under the same ID.
        state["pending"] = pending
        self._write_state(state)
        body = {"operation_id": operation_id, "service_id": service_id}
        if region is not None:  # whole-volume requests keep the original body, so cores without regions serve them
            body["region"] = region
        response = self._core("POST", f"/{kind}", json=body)
        if response.status_code >= 400:
            data = response.json()
            state["pending"] = None
            state["last"] = {**pending, "state": "rejected", "error": data}
            self._write_state(state)
            raise CellCanvasError(
                data.get("error", "Submission refused"), data.get("code", "core_error"), response.status_code
            )
        return self.reconcile()

    def _sync_painting(self, service_id: str, shape: list[int]) -> Optional[str]:
        if not self.painting.lock.acquire(blocking=False):
            raise CellCanvasError("A painting save is in progress; retry.", "busy")
        try:
            group = self.painting._open(self.binding.painting)
            if group is None:
                raise CellCanvasError("Paint at least one class before training.", "no_painting")
            array = group["0"]
            revision = self.painting.state()["revision"]
            # One chunk row of z planes at a time: memory follows the chunk size and the painted voxels.
            content, plane, step = hashlib.sha256(), int(np.prod(array.shape[1:])), array.chunks[0]
            flats, chunks = [], []
            for z in range(0, array.shape[0], step):
                slab = np.ascontiguousarray(array[z : z + step])
                content.update(slab.tobytes())
                where = np.flatnonzero(slab)
                flats.append(where + z * plane)
                chunks.append(slab.reshape(-1)[where])
            flat, values = np.concatenate(flats), np.concatenate(chunks)
            if revision is None:
                # Painted by another tool without a CellCanvas revision: identify it by content.
                revision = "content-" + content.hexdigest()[:32]
            unknown = set(np.unique(values).tolist()) - self.binding.class_ids
            if unknown:
                raise CellCanvasError(f"Painting contains unbound label IDs {sorted(unknown)}.", "invalid_painting")
            if flat.size == 0:
                raise CellCanvasError("Paint at least one class before training.", "no_painting")
            self._core_json(
                "PUT",
                "/painting",
                json={
                    "service_id": service_id,
                    "revision": revision,
                    "shape": shape,
                    "indices": flat.tolist(),
                    "values": values.astype(int).tolist(),
                },
            )
            return revision
        finally:
            self.painting.lock.release()

    def reconcile(self) -> dict:
        """Resolve the pending receipt; publish a successful prediction before reporting it complete."""
        state = self._read_state()
        pending = state.get("pending")
        if not pending:
            return {"pending": None, "last": state.get("last"), "published": self.published_state()}
        try:
            core = self._core_json("GET", "")
        except CellCanvasError as error:
            return {
                "pending": {**pending, "state": "unknown", "error": str(error)},
                "last": state.get("last"),
                "published": self.published_state(),
            }
        if core["service_id"] != pending["service_id"]:
            outcome = {
                **pending,
                "state": "lost",
                "error": {
                    "code": "service_changed",
                    "error": "The CellCanvas service restarted; this receipt and its model are gone.",
                },
            }
        else:
            response = self._core("GET", f"/operations/{pending['id']}")
            if response.status_code == 404:
                # Persisted but never accepted (the submission did not reach the service).
                outcome = {**pending, "state": "not_submitted"}
            else:
                receipt = response.json()
                if receipt["state"] == "running":
                    return {
                        "pending": {**pending, "state": "running"},
                        "last": state.get("last"),
                        "published": self.published_state(),
                    }
                outcome = {
                    **pending,
                    "state": receipt["state"],
                    "result": receipt.get("result"),
                    "error": receipt.get("error"),
                }
                if receipt["state"] == "succeeded" and pending["kind"] == "predict":
                    outcome["publication"] = self.publish(receipt["result"], pending)
        state["pending"] = None
        state["last"] = outcome
        self._write_state(state)
        return {"pending": None, "last": outcome, "published": self.published_state()}

    def publish(self, result: dict, pending: dict) -> dict:
        """Copy a completed core prediction into copick: a region chunk-wise in place, a volume by a store swap.

        Publications are serialized per binding; concurrent reconciles of one receipt publish it once.
        """
        if not self.binding.lock.acquire(timeout=30):
            raise CellCanvasError("Another publication is in progress; retry.", "busy")
        try:
            published = self.published_state()
            if published.get("operation_id") == pending["id"] and published.get("complete"):
                return published
            return self._publish(result, pending)
        finally:
            self.binding.lock.release()

    def _publish(self, result: dict, pending: dict) -> dict:
        version = result["prediction_version"]
        response = self._core("GET", "/prediction", params={"version": version})
        if response.status_code != 200:
            raise CellCanvasError("Completed prediction is no longer readable; predict again.", "not_ready")
        shape = [int(v) for v in response.headers["x-shape"].split(",")]
        data = np.frombuffer(response.content, dtype=response.headers["x-dtype"]).reshape(shape)
        if data.size and data.max() > 255:
            raise CellCanvasError("Prediction classes exceed the bound class range.", "invalid_prediction")
        grid = self.tomogram_geometry()["shape"]
        lo, hi = [0, 0, 0], list(grid)
        if response.headers.get("x-region"):
            bounds = [[int(v) for v in part.split(":")] for part in response.headers["x-region"].split(",")]
            lo, hi = [b[0] for b in bounds], [b[1] for b in bounds]
        if [b - a for a, b in zip(lo, hi, strict=True)] != shape:
            raise CellCanvasError("Prediction shape differs from its region.", "invalid_prediction")
        meta = {
            "role": "prediction",
            "binding": self.binding.id,
            "complete": True,
            "operation_id": pending["id"],
            "service_id": pending["service_id"],
            "prediction_version": version,
            "painting_revision": response.headers.get("x-painting-revision") or None,
            "features": self.binding.features,
            "published_at": time.time(),
        }
        if lo != [0, 0, 0] or hi != grid:
            return self._publish_region(data, lo, hi, grid, meta, pending)
        final = self._prediction_path()
        staging = final.with_name(f".cellcanvas-staging-{pending['id']}")
        old = final.with_name(f".cellcanvas-old-{pending['id']}")
        shutil.rmtree(staging, ignore_errors=True)
        from copick.util.ome import segmentation_pyramid, write_ome_zarr_3d

        store = zarr.DirectoryStore(str(staging), dimension_separator="/")  # chunk keys as copick writes
        write_ome_zarr_3d(
            store, segmentation_pyramid(data.astype(np.uint8), self.binding.voxel_size, 1, dtype=np.uint8)
        )
        staged = zarr.open_group(store, mode="r+")
        staged.attrs["cellcanvas"] = meta
        # Written into the staged store, so the record and the labels it describes are swapped in together.
        meta["proposal"] = record_proposal(
            staged,
            "cellcanvas",
            operation_id=pending["id"],
            prediction_version=version,
            classes=self.binding.classes,
        )
        if final.exists():
            os.replace(final, old)
        os.replace(staging, final)
        shutil.rmtree(old, ignore_errors=True)
        self.service.clear_stores()
        return meta

    def _publish_region(self, data, lo, hi, grid, meta, pending) -> dict:
        """Write a region prediction into only the chunks it touches (and, after a model change, the stale ones)."""
        meta["region"] = {axis: [a, b] for axis, a, b in zip(AXES, lo, hi, strict=True)}
        group, created = self._region_store(grid)
        array = group["0"]
        previous = dict(group.attrs.get("cellcanvas") or {})
        record = dict(group.attrs.get("proposal") or {})
        chunks = dict(record.get("chunks") or {})
        # Same model: keep its earlier regions. Otherwise clear every chunk holding an older model's labels.
        same_model = bool(previous) and all(previous.get(k) == meta[k] for k in ("service_id", "painting_revision"))
        stale = set() if same_model else {k for k, (_, present) in chunks.items() if present}
        origin, end = chunk_aligned(lo, hi, grid, array.chunks)
        inside = dict(block_chunks(origin, np.subtract(end, origin), array.chunks))
        keys = sorted(set(inside) | stale)
        # Readers and accepts refuse an incomplete publication while chunks are rewritten.
        group.attrs.update(
            cellcanvas={**previous, "complete": False, "writing": pending["id"]},
            proposal={**record, "complete": False},
        )
        written = []
        for key in keys:
            start = [int(i) * c for i, c in zip(key.split("."), array.chunks, strict=True)]
            stop = [min(s + c, n) for s, c, n in zip(start, array.chunks, grid, strict=True)]
            box = tuple(slice(a, b) for a, b in zip(start, stop, strict=True))
            # Only a chunk the same model predicted before keeps its voxels outside the region.
            fresh = not (same_model and key in inside)
            block = np.zeros(np.subtract(stop, start), np.uint8) if fresh else np.asarray(array[box])
            if key in inside:
                a = np.maximum(lo, start)
                b = np.minimum(hi, stop)
                block[tuple(slice(x - s, y - s) for x, y, s in zip(a, b, start, strict=True))] = data[
                    tuple(slice(x - o, y - o) for x, y, o in zip(a, b, lo, strict=True))
                ]
            array[box] = block
            chunks[key] = _chunk_entry(block)
            written.append((start, stop))
        regions = (previous.get("regions") or []) if same_model else []
        meta["regions"] = [*regions, meta["region"]][-64:]  # the latest 64, for display
        meta["changed_region"] = _xyz(np.min([w[0] for w in written], axis=0), np.max([w[1] for w in written], axis=0))
        meta["chunks_written"] = len(written)
        meta["new_store"] = created
        proposal = proposal_record(
            array,
            chunks,
            "cellcanvas",
            operation_id=pending["id"],
            prediction_version=meta["prediction_version"],
            classes=self.binding.classes,
        )
        group.attrs.update(cellcanvas=meta, proposal=proposal)
        self.service.clear_stores()
        return {**meta, "proposal": proposal}

    def _region_store(self, grid):
        """The published prediction store, or (none yet, or another grid) a new empty one swapped into place."""
        final = self._prediction_path()
        if (final / ".zgroup").exists():
            group = zarr.open_group(zarr.DirectoryStore(str(final), dimension_separator="/"), mode="r+")
            if (
                "0" in group
                and list(group["0"].shape) == list(grid)
                and "chunks" in (group.attrs.get("proposal") or {})
            ):
                return group, False
        from copick.util.ome import write_ome_zarr_3d

        staging = final.with_name(f".cellcanvas-staging-{uuid.uuid4().hex}")
        old = final.with_name(f".cellcanvas-old-{uuid.uuid4().hex}")
        store = zarr.DirectoryStore(str(staging), dimension_separator="/")
        # The OME metadata of one level at the binding's voxel size; its array is replaced by an unwritten one, whose
        # chunks read as 0 (unpredicted) until a region is published into them.
        write_ome_zarr_3d(store, {self.binding.voxel_size: np.zeros((1, 1, 1), np.uint8)})
        group = zarr.open_group(store, mode="r+")
        compressor = group["0"].compressor
        chunks = tuple(min(c, n) for c, n in zip(PREDICTION_CHUNKS, grid, strict=True))
        group.create_dataset(
            "0", shape=grid, chunks=chunks, dtype=np.uint8, fill_value=0, compressor=compressor, overwrite=True
        )
        array = group["0"]
        empty: dict[tuple, str] = {}
        records = {}
        for key, sl in block_chunks((0, 0, 0), grid, array.chunks):
            size = tuple(s.stop - s.start for s in sl)
            if size not in empty:
                empty[size] = digest(np.zeros(size, np.uint8))
            records[key] = [empty[size], []]
        group.attrs.update(
            cellcanvas={"role": "prediction", "binding": self.binding.id, "complete": False, "regions": []},
            proposal={**proposal_record(array, records, "cellcanvas"), "complete": False},
        )
        if final.exists():
            os.replace(final, old)
        os.replace(staging, final)
        shutil.rmtree(old, ignore_errors=True)
        self.service.clear_stores()
        return zarr.open_group(zarr.DirectoryStore(str(final), dimension_separator="/"), mode="r+"), True

    def _prediction_path(self) -> Path:
        seg = self._segmentation(self.binding.prediction)
        if seg is None:
            ref = self.binding.prediction
            run = self.service.get_run(self.binding.run)
            seg = run.new_segmentation(
                voxel_size=self.binding.voxel_size,
                name=ref.name,
                session_id=ref.session_id,
                is_multilabel=True,
                user_id=ref.user_id,
                exist_ok=True,
            )
        mapper = seg.zarr()
        fs = getattr(mapper, "fs", None)
        protocol = getattr(fs, "protocol", None)
        protocols = protocol if isinstance(protocol, (tuple, list)) else (protocol,)
        if "file" not in protocols and "local" not in protocols:
            raise CellCanvasError("Publication needs a local copick overlay filesystem.", "unsupported_storage", 501)
        root = getattr(mapper, "root", None) or getattr(mapper, "path", None)  # FSMap or zarr FSStore
        if not root:
            raise CellCanvasError("Cannot locate the prediction store.", "unsupported_storage", 501)
        return Path(root)


def _region(region: Optional[dict], shape: list[int]) -> Optional[dict]:
    """A predict region with every axis bounded, or None when it is absent or spans the whole volume."""
    if region is None:
        return None
    if not isinstance(region, dict) or not region or set(region) - set(AXES):
        raise CellCanvasError('region must map some of "z", "y", "x" to [start, stop].', "invalid_request", 400)
    bounded = {}
    for axis, size in zip(AXES, shape, strict=True):
        bounds = region.get(axis, [0, size])
        if (
            not isinstance(bounds, (list, tuple))
            or len(bounds) != 2
            or not all(isinstance(b, int) and not isinstance(b, bool) for b in bounds)
            or not 0 <= bounds[0] < bounds[1] <= size
        ):
            raise CellCanvasError(f"region {axis} must be [start, stop] within 0..{size}.", "invalid_request", 400)
        bounded[axis] = [int(bounds[0]), int(bounds[1])]
    if all(bounded[axis] == [0, size] for axis, size in zip(AXES, shape, strict=True)):
        return None
    return bounded


def open_session(binding: Binding, service: Any, client_factory=None) -> Session:
    return Session(binding, service, client_factory)

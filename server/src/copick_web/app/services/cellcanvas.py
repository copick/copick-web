"""CellCanvas learning on one copick reconstruction, through a CellCanvas core service.

A server-side binding file names, for one copick run/voxel spacing/reconstruction, a registered dataset of a
loopback CellCanvas core service (``cellcanvas_service``) that holds the image features, and the copick
segmentations that store painting and published predictions. The browser only names a binding by its ID, so it
cannot choose service URLs or filesystem paths.

The copick painting segmentation is the annotation of record: 0 is unannotated, positive IDs are the binding's
classes (a background class must be explicit). Before training, it is copied sparsely into the core dataset with
its revision. A prediction is published into copick only after the core reports a successful, current version:
it is written to a staging directory and swapped into place, so readers see the previous complete prediction or the
new complete one, never a partial write. Pending operation receipts are persisted beside the binding file, so an
uncertain response or a page reload is reconciled with the same operation ID instead of starting new work.

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

logger = logging.getLogger(__name__)

LOOPBACK = {"127.0.0.1", "localhost", "::1"}
MAX_STROKE_POINTS = 4096
MAX_RADIUS_VOXELS = 64
UNIT_ANGSTROM = {"angstrom": 1.0, "ångström": 1.0, "nanometer": 10.0, "nm": 10.0}


class CellCanvasError(Exception):
    def __init__(self, message: str, code: str, status: int = 409):
        super().__init__(message)
        self.code, self.status = code, status


@dataclass(frozen=True)
class SegmentationRef:
    name: str
    user_id: str
    session_id: str


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
    try:
        return SegmentationRef(str(data["name"]), str(data["user_id"]), str(data["session_id"]))
    except (KeyError, TypeError):
        raise ValueError(f"{what} needs name, user_id and session_id") from None


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


def _ome_level0(group) -> tuple[list[float], list[float], float]:
    """Scale, translation (z, y, x) and Å per unit of an OME-Zarr group's first level."""
    multiscales = group.attrs.get("multiscales") or [{}]
    ms = multiscales[0]
    axes = [a for a in ms.get("axes", []) if a.get("type") == "space"]
    units = {a.get("unit", "angstrom") for a in axes} or {"angstrom"}
    if len(units) != 1 or next(iter(units)) not in UNIT_ANGSTROM:
        raise CellCanvasError(f"Unsupported tomogram units {sorted(units)}", "geometry_mismatch")
    scale, translation = [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]
    datasets = ms.get("datasets") or [{}]
    for transform in datasets[0].get("coordinateTransformations", []):
        if transform.get("type") == "scale":
            scale = [float(v) for v in transform["scale"][-3:]]
        elif transform.get("type") == "translation":
            translation = [float(v) for v in transform["translation"][-3:]]
    return scale, translation, UNIT_ANGSTROM[next(iter(units))]


class Session:
    """Operations on one binding of one opened copick project."""

    def __init__(self, binding: Binding, service, client_factory=None):
        self.binding = binding
        self.service = service
        self._client_factory = client_factory or (lambda: httpx.Client(timeout=30))

    # copick storage --------------------------------------------------------------------------------------------

    def tomogram_geometry(self) -> dict:
        b = self.binding
        tomogram = self.service.get_tomogram(b.run, b.voxel_size, b.tomo_type)
        if tomogram is None:
            raise CellCanvasError("Bound reconstruction not found in the copick project.", "not_found", 404)
        group = zarr.open_group(tomogram.zarr(), mode="r")
        scale, translation, per_unit = _ome_level0(group)
        return {
            "shape": list(group["0"].shape),
            "scale_angstrom": [s * per_unit for s in scale],
            "translation_angstrom": [t * per_unit for t in translation],
        }

    def _segmentation(self, ref: SegmentationRef):
        b = self.binding
        segs = self.service.get_segmentations(
            b.run, ref.name, ref.user_id, ref.session_id, b.voxel_size, seg_types=("multilabel",)
        )
        return segs[0] if segs else None

    def _painting_array(self, create: bool, shape=None):
        seg = self._segmentation(self.binding.painting)
        if seg is None:
            if not create:
                return None, None
            run = self.service.get_run(self.binding.run)
            ref = self.binding.painting
            seg = run.new_segmentation(
                voxel_size=self.binding.voxel_size,
                name=ref.name,
                session_id=ref.session_id,
                is_multilabel=True,
                user_id=ref.user_id,
                exist_ok=True,
            )
            seg.from_numpy(np.zeros(shape, dtype=np.uint8), levels=1, dtype=np.uint8)
            group = zarr.open_group(seg.zarr(), mode="r+")
            group.attrs["cellcanvas"] = {"role": "painting", "binding": self.binding.id, "revision": None}
            self.service.clear_stores()
        group = zarr.open_group(seg.zarr(), mode="r+")
        return group, group["0"]

    def painting_state(self) -> dict:
        group, array = self._painting_array(create=False)
        if group is None:
            return {"exists": False, "revision": None, "can_undo": False}
        meta = group.attrs.get("cellcanvas") or {}
        return {
            "exists": True,
            "revision": meta.get("revision"),
            "shape": list(array.shape),
            "dtype": str(array.dtype),
            "can_undo": bool(meta.get("undo")),
        }

    def published_state(self) -> dict:
        seg = self._segmentation(self.binding.prediction)
        if seg is None:
            return {"exists": False}
        meta = zarr.open_group(seg.zarr(), mode="r").attrs.get("cellcanvas") or {}
        return {"exists": True, **meta}

    def paint(self, base_revision: Optional[str], strokes: list[dict], stroke_id: Optional[str] = None) -> dict:
        """Apply brush strokes (discs in one plane, voxel indices x, y, z) to the painting; returns the revision."""
        geometry = self.tomogram_geometry()
        shape = geometry["shape"]  # z, y, x
        allowed = self.binding.class_ids | {0}
        total = sum(len(s.get("points", [])) for s in strokes)
        if not strokes or total == 0 or total > MAX_STROKE_POINTS:
            raise CellCanvasError(f"Send 1-{MAX_STROKE_POINTS} stroke points.", "invalid_request", 400)
        for stroke in strokes:
            if int(stroke.get("label", -1)) not in allowed:
                raise CellCanvasError("Stroke label is not a bound class (0 erases).", "invalid_request", 400)
            radius = float(stroke.get("radius", 0))
            if not 0 <= radius <= MAX_RADIUS_VOXELS:
                raise CellCanvasError(f"Brush radius must be 0-{MAX_RADIUS_VOXELS} voxels.", "invalid_request", 400)
            if stroke.get("plane") not in ("XY", "XZ", "YZ"):
                raise CellCanvasError("Stroke plane must be XY, XZ or YZ.", "invalid_request", 400)
        if not self.binding.lock.acquire(blocking=False):
            raise CellCanvasError("Another painting save or publication is in progress.", "busy")
        try:
            group, array = self._painting_array(create=True, shape=shape)
            if list(array.shape) != shape:
                raise CellCanvasError("Painting shape differs from the reconstruction.", "geometry_mismatch")
            meta = dict(group.attrs.get("cellcanvas") or {})
            if base_revision != meta.get("revision"):
                raise CellCanvasError("Painting changed since it was loaded; reload it.", "revision_conflict")
            before = np.asarray(array[:])
            after = before.copy()
            for stroke in strokes:
                _apply_stroke(after, stroke, shape)
            indices = np.flatnonzero(before.ravel() != after.ravel())
            if not len(indices):
                return {"revision": base_revision, "changed_voxels": 0, "can_undo": bool(meta.get("undo"))}
            history = list(meta.get("undo", []))
            store = group.require_group("_cellcanvas_undo")
            # An out-of-band writer invalidates history rather than being silently rolled back.
            if history and store[history[-1]].attrs["digest"] != _painting_digest(before):
                history = []
            revision = uuid.uuid4().hex
            entry = store.create_group(revision)
            entry.create_dataset("indices", data=indices)
            entry.create_dataset("before", data=before.ravel()[indices])
            entry.attrs.update(digest=_painting_digest(after), stroke_id=stroke_id or revision)
            history.append(revision)
            # Retain up to 20 complete gestures (and cap pathological multi-request gestures).
            while len({store[key].attrs["stroke_id"] for key in history}) > 20 or len(history) > 128:
                oldest = store[history[0]].attrs["stroke_id"]
                history = [key for key in history if store[key].attrs["stroke_id"] != oldest]
            array[:] = after
            meta.update(role="painting", binding=self.binding.id, revision=revision, undo=history)
            group.attrs["cellcanvas"] = meta
            for key in list(store.group_keys()):
                if key not in history:
                    del store[key]
            return {"revision": revision, "changed_voxels": len(indices), "can_undo": bool(history)}
        finally:
            self.binding.lock.release()

    def undo(self, base_revision: Optional[str]) -> dict:
        """Restore one saved gesture, guarded by revision and exact current label bytes."""
        if not self.binding.lock.acquire(blocking=False):
            raise CellCanvasError("Another painting save or publication is in progress.", "busy")
        try:
            group, array = self._painting_array(create=False)
            meta = dict(group.attrs.get("cellcanvas") or {}) if group is not None else {}
            if base_revision != meta.get("revision"):
                raise CellCanvasError("Painting changed since it was loaded; reload it.", "revision_conflict")
            history = list(meta.get("undo", []))
            if not history:
                raise CellCanvasError("No saved stroke to undo.", "nothing_to_undo")
            store = group["_cellcanvas_undo"]
            before = np.asarray(array[:])
            if store[history[-1]].attrs["digest"] != _painting_digest(before):
                raise CellCanvasError("Painting was edited outside this session; undo refused.", "revision_conflict")
            after = before.copy()
            gesture = store[history[-1]].attrs["stroke_id"]
            removed = []
            while history and store[history[-1]].attrs["stroke_id"] == gesture:
                key = history.pop()
                entry = store[key]
                after.ravel()[entry["indices"][:]] = entry["before"][:]
                removed.append(key)
            revision = uuid.uuid4().hex
            array[:] = after
            meta.update(revision=revision, undo=history)
            group.attrs["cellcanvas"] = meta
            for key in removed:
                del store[key]
            return {"revision": revision, "changed_voxels": int((before != after).sum()), "can_undo": bool(history)}
        finally:
            self.binding.lock.release()

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

    def submit(self, kind: str, operation_id: str) -> dict:
        """Submit train or predict once per operation ID; a retry of the same ID returns its receipt."""
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
        if pending:
            if pending["service_id"] != service_id:
                return self.reconcile()
            response = self._core("GET", f"/operations/{operation_id}")
            if response.status_code == 200:
                return self.reconcile()
        pending = {"id": operation_id, "kind": kind, "service_id": service_id, "submitted_at": time.time()}
        if kind == "train":
            pending["painting_revision"] = self._sync_painting(service_id, check["copick"]["shape"])
        # Persist before submitting: a lost response is then reconciled under the same ID.
        state["pending"] = pending
        self._write_state(state)
        body = {"operation_id": operation_id, "service_id": service_id}
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
        if not self.binding.lock.acquire(blocking=False):
            raise CellCanvasError("A painting save is in progress; retry.", "busy")
        try:
            group, array = self._painting_array(create=False)
            if group is None:
                raise CellCanvasError("Paint at least one class before training.", "no_painting")
            labels = np.asarray(array[...])
            revision = (group.attrs.get("cellcanvas") or {}).get("revision")
            if revision is None:
                # Painted by another tool without a CellCanvas revision: identify it by content.
                revision = "content-" + hashlib.sha256(labels.tobytes()).hexdigest()[:32]
            flat = np.flatnonzero(labels)
            values = labels.reshape(-1)[flat]
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
            self.binding.lock.release()

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
        """Copy a completed core prediction into copick by staging and swapping the whole store."""
        published = self.published_state()
        if published.get("operation_id") == pending["id"] and published.get("complete"):
            return published
        version = result["prediction_version"]
        response = self._core("GET", "/prediction", params={"version": version})
        if response.status_code != 200:
            raise CellCanvasError("Completed prediction is no longer readable; predict again.", "not_ready")
        shape = [int(v) for v in response.headers["x-shape"].split(",")]
        data = np.frombuffer(response.content, dtype=response.headers["x-dtype"]).reshape(shape)
        if data.size and data.max() > 255:
            raise CellCanvasError("Prediction classes exceed the bound class range.", "invalid_prediction")
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
        if not self.binding.lock.acquire(timeout=30):
            raise CellCanvasError("Publication is blocked by a painting save; retry.", "busy")
        try:
            final = self._prediction_path()
            staging = final.with_name(f".cellcanvas-staging-{pending['id']}")
            old = final.with_name(f".cellcanvas-old-{pending['id']}")
            shutil.rmtree(staging, ignore_errors=True)
            from copick.util.ome import segmentation_pyramid, write_ome_zarr_3d

            store = zarr.DirectoryStore(str(staging), dimension_separator="/")  # chunk keys as copick writes
            write_ome_zarr_3d(
                store, segmentation_pyramid(data.astype(np.uint8), self.binding.voxel_size, 1, dtype=np.uint8)
            )
            zarr.open_group(store, mode="r+").attrs["cellcanvas"] = meta
            if final.exists():
                os.replace(final, old)
            os.replace(staging, final)
            shutil.rmtree(old, ignore_errors=True)
            self.service.clear_stores()
        finally:
            self.binding.lock.release()
        return meta

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


def _painting_digest(array: np.ndarray) -> str:
    return hashlib.sha256(array.tobytes()).hexdigest()


def _apply_stroke(array, stroke: dict, shape: list[int]) -> int:
    """Paint discs of ``radius`` voxels around each point (x, y, z indices) in the stroke's plane."""
    label = int(stroke["label"])
    radius = float(stroke.get("radius", 0))
    r = int(math.floor(radius))
    points = np.asarray(stroke["points"], dtype=np.int64).reshape(-1, 3)[:, ::-1]  # -> z, y, x
    # In-plane axes in z, y, x order.
    in_plane = {"XY": (1, 2), "XZ": (0, 2), "YZ": (0, 1)}[stroke["plane"]]
    lo = np.maximum(points.min(axis=0) - [r if a in in_plane else 0 for a in range(3)], 0)
    hi = np.minimum(points.max(axis=0) + [r if a in in_plane else 0 for a in range(3)] + 1, shape)
    if np.any(lo >= hi):
        return 0
    region = tuple(slice(int(a), int(b)) for a, b in zip(lo, hi, strict=True))
    block = np.array(array[region], copy=True, order="C")
    before = block.copy()
    grid = np.indices(block.shape).reshape(3, -1).T + lo
    mask = np.zeros(len(grid), dtype=bool)
    a, b = in_plane
    w = ({0, 1, 2} - set(in_plane)).pop()
    for point in points:
        if not (0 <= point[w] < shape[w]):
            continue
        near = (grid[:, w] == point[w]) & ((grid[:, a] - point[a]) ** 2 + (grid[:, b] - point[b]) ** 2 <= radius**2)
        mask |= near
    block.reshape(-1)[mask] = label
    changed = int((block != before).sum())
    if changed:
        array[region] = block
    return changed


def open_session(binding: Binding, service: Any, client_factory=None) -> Session:
    return Session(binding, service, client_factory)

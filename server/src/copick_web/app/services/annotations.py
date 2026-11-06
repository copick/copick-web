"""Painting a copick multilabel segmentation from the browser, and accepting completed proposals into it.

These operations need only a copick project; learning backends (CellCanvas, nnInteractive) are optional.

A painting is a ``uint8`` multilabel segmentation on the reconstruction grid. ``0`` is unknown (never annotated);
positive values are classes, so background is only ever an explicit class. Every change is checked against the
revision the client last saw, and each gesture keeps the voxels it replaced so it can be undone while the stored
labels are exactly what the gesture left behind.

A proposal is model output in its own segmentation. It can be accepted into a painting only once its producer has
recorded it as complete (``attrs["proposal"]``) and only while its stored labels still match that record, so a
partial or later in-progress write is never accepted. Accepting fills only unknown voxels: it never overwrites a
human label, and it is undone like any other gesture.
"""

from __future__ import annotations

import hashlib
import math
import threading
import uuid
from dataclasses import dataclass
from typing import Optional

import numpy as np
import zarr

MAX_STROKE_POINTS = 4096
MAX_RADIUS_VOXELS = 64
MAX_UNDO_GESTURES = 20
META = "painting"
UNDO_GROUP = "_painting_undo"
UNIT_ANGSTROM = {"angstrom": 1.0, "ångström": 1.0, "nanometer": 10.0, "nm": 10.0}
PLANES = {"XY": (1, 2), "XZ": (0, 2), "YZ": (0, 1)}  # in-plane axes in z, y, x order


class AnnotationError(Exception):
    def __init__(self, message: str, code: str, status: int = 409):
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class SegmentationRef:
    name: str
    user_id: str
    session_id: str

    @classmethod
    def parse(cls, data: dict, what: str = "segmentation") -> "SegmentationRef":
        try:
            return cls(str(data["name"]), str(data["user_id"]), str(data["session_id"]))
        except (KeyError, TypeError):
            raise ValueError(f"{what} needs name, user_id and session_id") from None


_locks: dict[tuple, threading.Lock] = {}
_locks_guard = threading.Lock()


def target_lock(*key) -> threading.Lock:
    """One lock per painted segmentation, shared by every request of this process."""
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def digest(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def project_classes(service) -> list[dict]:
    """Paintable classes of a copick project: its objects with labels 1-255."""
    classes = []
    for obj in service.pickable_objects:
        label = getattr(obj, "label", None)
        if label is not None and 0 < int(label) < 256:
            classes.append({"id": int(label), "name": obj.name, "color": list(obj.color or [])})
    return sorted(classes, key=lambda c: c["id"])


class Painting:
    """A painted multilabel segmentation of one reconstruction."""

    def __init__(self, service, run: str, voxel_size: float, tomo_type: str, ref: SegmentationRef, classes, lock=None):
        self.service = service
        self.run = run
        self.voxel_size = voxel_size
        self.tomo_type = tomo_type
        self.ref = ref
        self.labels = {int(c["id"]) for c in classes}
        self.lock = lock or target_lock(id(service), run, round(voxel_size, 3), ref)

    # storage --------------------------------------------------------------------------------------------------

    def _tomogram(self):
        tomogram = self.service.get_tomogram(self.run, self.voxel_size, self.tomo_type)
        if tomogram is None:
            raise AnnotationError("Reconstruction not found in the copick project.", "not_found", 404)
        return zarr.open_group(tomogram.zarr(), mode="r")

    def shape(self) -> list[int]:
        return list(self._tomogram()["0"].shape)

    def grid(self) -> dict:
        """Shape, voxel size and origin (z, y, x; Å) of the reconstruction's full-resolution level."""
        group = self._tomogram()
        ms = (group.attrs.get("multiscales") or [{}])[0]
        units = {a.get("unit", "angstrom") for a in ms.get("axes", []) if a.get("type") == "space"} or {"angstrom"}
        if len(units) != 1 or next(iter(units)) not in UNIT_ANGSTROM:
            raise AnnotationError(f"Unsupported tomogram units {sorted(units)}", "geometry_mismatch")
        per_unit = UNIT_ANGSTROM[next(iter(units))]
        scale, translation = [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]
        for transform in (ms.get("datasets") or [{}])[0].get("coordinateTransformations", []):
            if transform.get("type") == "scale":
                scale = [float(v) for v in transform["scale"][-3:]]
            elif transform.get("type") == "translation":
                translation = [float(v) for v in transform["translation"][-3:]]
        return {
            "shape": list(group["0"].shape),
            "scale_angstrom": [v * per_unit for v in scale],
            "translation_angstrom": [v * per_unit for v in translation],
        }

    def _open(self, ref: SegmentationRef):
        """The segmentation's group; one written by another process since copick listed the run is found too."""
        for attempt in range(2):
            segs = self.service.get_segmentations(
                self.run, ref.name, ref.user_id, ref.session_id, self.voxel_size, seg_types=("multilabel",)
            )
            if segs:
                return zarr.open_group(segs[0].zarr(), mode="r+")
            run = self.service.get_run(self.run)
            if attempt or run is None:
                return None
            run.refresh_segmentations()
            self.service.clear_stores()

    def _group(self, create_shape=None):
        group = self._open(self.ref)
        if group is None and create_shape is not None:
            seg = self.service.get_run(self.run).new_segmentation(
                voxel_size=self.voxel_size,
                name=self.ref.name,
                session_id=self.ref.session_id,
                is_multilabel=True,
                user_id=self.ref.user_id,
                exist_ok=True,
            )
            seg.from_numpy(np.zeros(create_shape, dtype=np.uint8), levels=1, dtype=np.uint8)
            self.service.clear_stores()
            group = zarr.open_group(seg.zarr(), mode="r+")
            group.attrs[META] = {"revision": None, "undo": []}
        return group

    @staticmethod
    def _meta(group) -> dict:
        if META in group.attrs:
            return dict(group.attrs[META])
        # Paintings saved before this format keep their revision; their undo history is not carried over.
        legacy = group.attrs.get("cellcanvas") or {}
        return {"revision": legacy.get("revision"), "undo": []}

    def state(self) -> dict:
        group = self._open(self.ref)
        if group is None:
            return {"exists": False, "revision": None, "can_undo": False, "target": self.ref.__dict__}
        meta = self._meta(group)
        return {
            "exists": True,
            "revision": meta.get("revision"),
            "shape": list(group["0"].shape),
            "dtype": str(group["0"].dtype),
            "can_undo": bool(meta.get("undo")),
            "target": self.ref.__dict__,
        }

    # edits ----------------------------------------------------------------------------------------------------

    def _edit(self, base_revision: Optional[str], change, gesture_id: Optional[str], source: Optional[dict]) -> dict:
        """Apply ``change(before) -> after`` under the target lock as one undoable gesture."""
        shape = self.shape()
        if not self.lock.acquire(blocking=False):
            raise AnnotationError("Another save to this painting is in progress.", "busy")
        try:
            group = self._group(create_shape=shape)
            array = group["0"]
            if list(array.shape) != shape:
                raise AnnotationError("Painting shape differs from the reconstruction.", "geometry_mismatch")
            meta = self._meta(group)
            if base_revision != meta.get("revision"):
                raise AnnotationError("Painting changed since it was loaded; reload it.", "revision_conflict")
            before = np.asarray(array[:])
            after = change(before.copy())
            indices = np.flatnonzero(before.ravel() != after.ravel())
            if not len(indices):
                return {"revision": base_revision, "changed_voxels": 0, "can_undo": bool(meta.get("undo"))}
            history = list(meta.get("undo", []))
            store = group.require_group(UNDO_GROUP)
            # An out-of-band writer invalidates history rather than being silently rolled back.
            if history and store[history[-1]].attrs["digest"] != digest(before):
                history = []
            revision = uuid.uuid4().hex
            entry = store.create_group(revision)
            entry.create_dataset("indices", data=indices)
            entry.create_dataset("before", data=before.ravel()[indices])
            entry.attrs.update(digest=digest(after), gesture=gesture_id or revision, source=source)
            history.append(revision)
            while len({store[k].attrs["gesture"] for k in history}) > MAX_UNDO_GESTURES or len(history) > 128:
                oldest = store[history[0]].attrs["gesture"]
                history = [k for k in history if store[k].attrs["gesture"] != oldest]
            array[:] = after
            meta.update(revision=revision, undo=history)
            group.attrs[META] = meta
            for key in list(store.group_keys()):
                if key not in history:
                    del store[key]
            return {"revision": revision, "changed_voxels": len(indices), "can_undo": True}
        finally:
            self.lock.release()

    def paint(self, base_revision: Optional[str], strokes: list[dict], stroke_id: Optional[str] = None) -> dict:
        """Brush strokes: discs of ``radius`` voxels around points (x, y, z indices) in one plane; 0 erases."""
        allowed = self.labels | {0}
        total = sum(len(s.get("points", [])) for s in strokes)
        if not strokes or total == 0 or total > MAX_STROKE_POINTS:
            raise AnnotationError(f"Send 1-{MAX_STROKE_POINTS} stroke points.", "invalid_request", 400)
        for stroke in strokes:
            if int(stroke.get("label", -1)) not in allowed:
                raise AnnotationError("Stroke label is not a paintable class (0 erases).", "invalid_request", 400)
            if not 0 <= float(stroke.get("radius", 0)) <= MAX_RADIUS_VOXELS:
                raise AnnotationError(f"Brush radius must be 0-{MAX_RADIUS_VOXELS} voxels.", "invalid_request", 400)
            if stroke.get("plane") not in PLANES:
                raise AnnotationError("Stroke plane must be XY, XZ or YZ.", "invalid_request", 400)

        def change(labels):
            for stroke in strokes:
                apply_stroke(labels, stroke)
            return labels

        return self._edit(base_revision, change, stroke_id, None)

    def undo(self, base_revision: Optional[str]) -> dict:
        """Restore one gesture, guarded by revision and the exact current label bytes."""
        if not self.lock.acquire(blocking=False):
            raise AnnotationError("Another save to this painting is in progress.", "busy")
        try:
            group = self._open(self.ref)
            meta = self._meta(group) if group is not None else {}
            if base_revision != meta.get("revision"):
                raise AnnotationError("Painting changed since it was loaded; reload it.", "revision_conflict")
            history = list(meta.get("undo", []))
            if not history:
                raise AnnotationError("Nothing to undo.", "nothing_to_undo")
            store = group[UNDO_GROUP]
            array = group["0"]
            before = np.asarray(array[:])
            if store[history[-1]].attrs["digest"] != digest(before):
                raise AnnotationError("Painting was edited outside this session; undo refused.", "revision_conflict")
            after = before.copy()
            gesture = store[history[-1]].attrs["gesture"]
            source = store[history[-1]].attrs.get("source")
            removed = []
            while history and store[history[-1]].attrs["gesture"] == gesture:
                key = history.pop()
                after.ravel()[store[key]["indices"][:]] = store[key]["before"][:]
                removed.append(key)
            revision = uuid.uuid4().hex
            array[:] = after
            meta.update(revision=revision, undo=history)
            group.attrs[META] = meta
            for key in removed:
                del store[key]
            return {
                "revision": revision,
                "changed_voxels": int((before != after).sum()),
                "can_undo": bool(history),
                "undone": source,
            }
        finally:
            self.lock.release()

    # proposals ------------------------------------------------------------------------------------------------

    def proposal(self, ref: SegmentationRef) -> dict:
        """A proposal's completion record and whether its stored labels still match it."""
        group = self._open(ref)
        if group is None:
            raise AnnotationError(f"Proposal '{ref.name}' not found.", "not_found", 404)
        record = group.attrs.get("proposal")
        if not record or not record.get("complete"):
            raise AnnotationError("This segmentation has no completed-proposal record.", "not_complete")
        current = digest(np.asarray(group["0"][:]))
        return {"ref": ref.__dict__, **record, "current": current == record.get("digest")}

    def accept(
        self,
        base_revision: Optional[str],
        ref: SegmentationRef,
        proposal_label: int,
        label: int,
        proposal_digest: str,
        box: Optional[list[list[int]]] = None,
    ) -> dict:
        """Copy one label of a completed proposal into unknown painting voxels as ``label``."""
        if int(label) not in self.labels:
            raise AnnotationError("Accepted label is not a paintable class.", "invalid_request", 400)
        if ref == self.ref:
            raise AnnotationError("A painting cannot accept itself.", "invalid_request", 400)
        group = self._open(ref)
        if group is None:
            raise AnnotationError(f"Proposal '{ref.name}' not found.", "not_found", 404)
        record = dict(group.attrs.get("proposal") or {})
        if not record.get("complete"):
            raise AnnotationError("This segmentation has no completed-proposal record.", "not_complete")
        proposal = np.asarray(group["0"][:])
        if digest(proposal) != record.get("digest"):
            raise AnnotationError(
                "Proposal labels differ from its completion record; it may be mid-write.", "not_complete"
            )
        if proposal_digest != record["digest"]:
            raise AnnotationError("Proposal changed since it was inspected; inspect it again.", "revision_conflict")
        if list(proposal.shape) != self.shape():
            raise AnnotationError("Proposal shape differs from the reconstruction.", "geometry_mismatch")
        mask = proposal == int(proposal_label)
        if box is not None:  # [[x0, x1], [y0, y1], [z0, z1]] voxel indices, half-open
            window = np.zeros_like(mask)
            window[tuple(slice(int(lo), int(hi)) for lo, hi in box[::-1])] = True
            mask &= window
        if not mask.any():
            raise AnnotationError(f"Proposal has no voxels of label {proposal_label} here.", "invalid_request", 400)
        source = {
            "kind": "accepted_proposal",
            "proposal": ref.__dict__,
            "proposal_label": int(proposal_label),
            "proposal_digest": record["digest"],
            "producer": record.get("producer"),
        }
        kept = {}

        def change(labels):
            take = mask & (labels == 0)
            kept["human"] = int((mask & (labels != 0)).sum())
            labels[take] = int(label)
            return labels

        result = self._edit(base_revision, change, None, source)
        return {**result, "kept_human_voxels": kept.get("human", 0), "source": source}


def record_proposal(group, producer: str, **details) -> dict:
    """Mark a fully written segmentation as a completed proposal (call only after its write finished)."""
    record = {"complete": True, "producer": producer, "digest": digest(np.asarray(group["0"][:])), **details}
    group.attrs["proposal"] = record
    return record


def apply_stroke(array: np.ndarray, stroke: dict) -> int:
    """Paint discs of ``radius`` voxels around each point (x, y, z indices) in the stroke's plane."""
    shape = array.shape
    label = int(stroke["label"])
    radius = float(stroke.get("radius", 0))
    r = int(math.floor(radius))
    points = np.asarray(stroke["points"], dtype=np.int64).reshape(-1, 3)[:, ::-1]  # -> z, y, x
    in_plane = PLANES[stroke["plane"]]
    pad = [r if a in in_plane else 0 for a in range(3)]
    lo = np.maximum(points.min(axis=0) - pad, 0)
    hi = np.minimum(points.max(axis=0) + pad + 1, shape)
    if np.any(lo >= hi):
        return 0
    region = tuple(slice(int(a), int(b)) for a, b in zip(lo, hi, strict=True))
    block = array[region]
    grid = np.indices(block.shape).reshape(3, -1).T + lo
    mask = np.zeros(len(grid), dtype=bool)
    a, b = in_plane
    w = ({0, 1, 2} - set(in_plane)).pop()
    for point in points:
        if not (0 <= point[w] < shape[w]):
            continue
        mask |= (grid[:, w] == point[w]) & ((grid[:, a] - point[a]) ** 2 + (grid[:, b] - point[b]) ** 2 <= radius**2)
    flat = block.reshape(-1).copy()
    changed = int((flat[mask] != label).sum())
    flat[mask] = label
    array[region] = flat.reshape(block.shape)
    return changed

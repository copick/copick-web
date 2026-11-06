"""Painting a copick multilabel segmentation from the browser, and accepting completed proposals into it.

These operations need only a copick project; learning backends (CellCanvas, nnInteractive) are optional.

A painting is a ``uint8`` multilabel segmentation on the reconstruction grid. ``0`` is unknown (never annotated);
positive values are classes, so background is only ever an explicit class. Every change is checked against the
revision the client last saw, and each gesture keeps the voxels it replaced so it can be undone while the stored
labels are exactly what the gesture left behind.

Every edit reads and writes only the storage chunks its gesture touches, so its cost follows the edited region, not
the reconstruction. A gesture records a checksum of each chunk it left behind; a later edit or undo that finds one of
those chunks changed by another writer drops (or refuses) the undo history instead of silently rolling that writer
back. Chunks no gesture touches are never read and an undo never changes them.

A proposal is model output in its own segmentation. It can be accepted into a painting only once its producer has
recorded it as complete (``attrs["proposal"]``, with a checksum and the labels present in each chunk) and only while
the chunks it is accepted from still match that record, so a partial or later in-progress write is never accepted.
Accepting fills only unknown voxels: it never overwrites a human label, and it is undone like any other gesture.
"""

from __future__ import annotations

import hashlib
import itertools
import json
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


Box = tuple[tuple[int, ...], tuple[int, ...]]  # (lo, hi) z, y, x voxel indices, half-open


def chunk_aligned(lo, hi, shape, chunks) -> Box:
    """The smallest region on the chunk grid that contains ``[lo, hi)``, clipped to the array."""
    return (
        tuple(int(a // c * c) for a, c in zip(lo, chunks, strict=True)),
        tuple(int(min(-(-b // c) * c, n)) for b, c, n in zip(hi, chunks, shape, strict=True)),
    )


def block_chunks(origin, block_shape, chunks):
    """``(key, slices)`` of each storage chunk in a chunk-aligned block; slices are relative to the block."""
    ranges = [range(0, n, c) for n, c in zip(block_shape, chunks, strict=True)]
    for start in itertools.product(*ranges):
        key = ".".join(str((o + s) // c) for o, s, c in zip(origin, start, chunks, strict=True))
        yield key, tuple(slice(s, min(s + c, n)) for s, c, n in zip(start, chunks, block_shape, strict=True))


def _box(lo, hi, shape) -> Optional[Box]:
    lo = tuple(max(int(a), 0) for a in lo)
    hi = tuple(min(int(b), n) for b, n in zip(hi, shape, strict=True))
    return (lo, hi) if all(a < b for a, b in zip(lo, hi, strict=True)) else None


def _union(boxes) -> Optional[Box]:
    boxes = [b for b in boxes if b is not None]
    if not boxes:
        return None
    return tuple(np.min([b[0] for b in boxes], axis=0).tolist()), tuple(np.max([b[1] for b in boxes], axis=0).tolist())


def _slices(lo, hi) -> tuple[slice, ...]:
    return tuple(slice(int(a), int(b)) for a, b in zip(lo, hi, strict=True))


def _shift(slices, origin) -> Box:
    return tuple(np.add([s.start for s in slices], origin).tolist()), tuple(
        np.add([s.stop for s in slices], origin).tolist()
    )


def _changed_box(changed: np.ndarray, origin) -> Box:
    where = [np.flatnonzero(changed.any(axis=tuple(b for b in range(3) if b != a))) for a in range(3)]
    return (
        tuple(int(o + w[0]) for o, w in zip(origin, where, strict=True)),
        tuple(int(o + w[-1] + 1) for o, w in zip(origin, where, strict=True)),
    )


def _xyz(lo, hi) -> list[list[int]]:
    """A z, y, x box as ``[[x0, x1], [y0, y1], [z0, z1]]``, the order regions use in requests and responses."""
    return [[int(a), int(b)] for a, b in zip(lo, hi, strict=True)][::-1]


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
        history = self._history(group[UNDO_GROUP], meta) if UNDO_GROUP in group else []
        return {
            "exists": True,
            "revision": meta.get("revision"),
            "shape": list(group["0"].shape),
            "dtype": str(group["0"].dtype),
            "can_undo": bool(history),
            "target": self.ref.__dict__,
        }

    # edits ----------------------------------------------------------------------------------------------------

    def _history(self, store, meta) -> list[str]:
        """Undo entries in order; history from before chunk checksums is not carried over."""
        history = list(meta.get("undo", []))
        while history and "chunks" not in store[history[0]].attrs:
            history.pop(0)
        return history if all("chunks" in store[k].attrs for k in history) else []

    @staticmethod
    def _expected(store, history) -> dict[str, str]:
        """Checksum each chunk should have now: the one recorded by the latest gesture that wrote it."""
        expected = {}
        for key in history:
            expected.update(store[key].attrs["chunks"])
        return expected

    def _edit(
        self,
        base_revision: Optional[str],
        box: Optional[Box],
        change,
        gesture_id: Optional[str],
        source: Optional[dict],
    ) -> dict:
        """Apply ``change(block, origin) -> block`` to the chunks around ``box`` under the target lock as one gesture."""
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
            store = group.require_group(UNDO_GROUP)
            history = self._history(store, meta)
            unchanged = {"revision": base_revision, "changed_voxels": 0, "can_undo": bool(history)}
            box = _box(*box, shape) if box is not None else None
            if box is None:
                return unchanged
            origin, end = chunk_aligned(*box, shape, array.chunks)
            region = _slices(origin, end)
            before = np.asarray(array[region])
            after = change(before.copy(), origin)
            changed = before != after
            if not changed.any():
                return unchanged
            # An out-of-band writer invalidates history rather than being silently rolled back.
            expected = self._expected(store, history)
            parts = list(block_chunks(origin, before.shape, array.chunks))
            if any(key in expected and expected[key] != digest(before[sl]) for key, sl in parts):
                history = []
            touched = [(key, sl) for key, sl in parts if changed[sl].any()]
            indices = np.flatnonzero(changed)
            revision = uuid.uuid4().hex
            entry = store.create_group(revision)
            entry.create_dataset("indices", data=indices, chunks=max(len(indices), 1))
            entry.create_dataset("before", data=before.ravel()[indices], chunks=max(len(indices), 1))
            entry.attrs.update(
                origin=list(origin),
                shape=list(before.shape),
                chunks={key: digest(after[sl]) for key, sl in touched},
                gesture=gesture_id or revision,
                source=source,
            )
            history.append(revision)
            while len({store[k].attrs["gesture"] for k in history}) > MAX_UNDO_GESTURES or len(history) > 128:
                oldest = store[history[0]].attrs["gesture"]
                history = [k for k in history if store[k].attrs["gesture"] != oldest]
            for _, sl in touched:
                array[_slices(*_shift(sl, origin))] = after[sl]
            meta.update(revision=revision, undo=history)
            group.attrs[META] = meta
            for key in list(store.group_keys()):
                if key not in history:
                    del store[key]
            return {
                "revision": revision,
                "changed_voxels": len(indices),
                "can_undo": True,
                "changed_region": _xyz(*_changed_box(changed, origin)),
            }
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

        shape = self.shape()

        def change(block, origin):
            for stroke in strokes:
                apply_stroke(block, stroke, origin, shape)
            return block

        box = _union(stroke_box(stroke, shape) for stroke in strokes)
        return self._edit(base_revision, box, change, stroke_id, None)

    def undo(self, base_revision: Optional[str]) -> dict:
        """Restore one gesture, guarded by revision and the exact current bytes of every chunk it rewrites."""
        if not self.lock.acquire(blocking=False):
            raise AnnotationError("Another save to this painting is in progress.", "busy")
        try:
            group = self._open(self.ref)
            meta = self._meta(group) if group is not None else {}
            if base_revision != meta.get("revision"):
                raise AnnotationError("Painting changed since it was loaded; reload it.", "revision_conflict")
            store = group.require_group(UNDO_GROUP) if group is not None else None
            history = self._history(store, meta) if store is not None else []
            if not history:
                raise AnnotationError("Nothing to undo.", "nothing_to_undo")
            array = group["0"]
            gesture = store[history[-1]].attrs["gesture"]
            source = store[history[-1]].attrs.get("source")
            keys = list(itertools.takewhile(lambda k: store[k].attrs["gesture"] == gesture, reversed(history)))
            boxes = [
                (
                    tuple(store[k].attrs["origin"]),
                    tuple(o + n for o, n in zip(store[k].attrs["origin"], store[k].attrs["shape"], strict=True)),
                )
                for k in keys
            ]
            origin, end = _union(boxes)
            before = np.asarray(array[_slices(origin, end)])
            after = before.copy()
            for key, (lo, hi) in zip(keys, boxes, strict=True):  # newest first
                window = _slices(np.subtract(lo, origin), np.subtract(hi, origin))
                local = after[window].copy()
                parts = dict(block_chunks(lo, local.shape, array.chunks))
                if any(digest(local[parts[k]]) != d for k, d in store[key].attrs["chunks"].items()):
                    # Its chunks were rewritten by another writer: neither this gesture nor older ones can be undone.
                    meta.update(undo=[])
                    group.attrs[META] = meta
                    for stale in list(store.group_keys()):
                        del store[stale]
                    raise AnnotationError(
                        "Painting was edited outside this session; undo refused.", "revision_conflict"
                    )
                local.ravel()[store[key]["indices"][:]] = store[key]["before"][:]
                after[window] = local
            changed = before != after
            revision = uuid.uuid4().hex
            for _, sl in block_chunks(origin, before.shape, array.chunks):
                if changed[sl].any():
                    array[_slices(*_shift(sl, origin))] = after[sl]
            history = history[: len(history) - len(keys)]
            meta.update(revision=revision, undo=history)
            group.attrs[META] = meta
            for key in keys:
                del store[key]
            return {
                "revision": revision,
                "changed_voxels": int(changed.sum()),
                "can_undo": bool(history),
                "undone": source,
                "changed_region": _xyz(*_changed_box(changed, origin)) if changed.any() else None,
            }
        finally:
            self.lock.release()

    # proposals ------------------------------------------------------------------------------------------------

    def _completed(self, ref: SegmentationRef):
        group = self._open(ref)
        if group is None:
            raise AnnotationError(f"Proposal '{ref.name}' not found.", "not_found", 404)
        record = dict(group.attrs.get("proposal") or {})
        if not record.get("complete"):
            raise AnnotationError("This segmentation has no completed-proposal record.", "not_complete")
        return group, record

    def proposal(self, ref: SegmentationRef) -> dict:
        """A proposal's completion record and whether its stored labels still match it."""
        group, record = self._completed(ref)
        array = group["0"]
        if "chunks" in record:
            current = _chunk_record(array) == record["chunks"]
        else:  # recorded before chunk checksums
            current = digest(np.asarray(array[:])) == record.get("digest")
        summary = {k: v for k, v in record.items() if k != "chunks"}
        return {"ref": ref.__dict__, **summary, "current": current}

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
        group, record = self._completed(ref)
        array = group["0"]
        shape = self.shape()
        if list(array.shape) != shape:
            raise AnnotationError("Proposal shape differs from the reconstruction.", "geometry_mismatch")
        window = ((0, 0, 0), tuple(shape))
        if box is not None:  # [[x0, x1], [y0, y1], [z0, z1]] voxel indices, half-open
            window = _box([int(lo) for lo, _ in box[::-1]], [int(hi) for _, hi in box[::-1]], shape)
        mismatch = AnnotationError(
            "Proposal labels differ from its completion record; it may be mid-write.", "not_complete"
        )
        if "chunks" in record:
            # Only the chunks that hold this label inside the window are read, and each must match the record.
            boxes = []
            for key, (_, present) in record["chunks"].items():
                if int(proposal_label) in present:
                    lo = tuple(int(i) * c for i, c in zip(key.split("."), array.chunks, strict=True))
                    boxes.append(_box(lo, np.add(lo, array.chunks), shape))
            region = _union(boxes)
            if region is not None and window is not None:
                region = _box(np.maximum(region[0], window[0]), np.minimum(region[1], window[1]), shape)
            else:
                region = None
            if region is None:
                raise AnnotationError(f"Proposal has no voxels of label {proposal_label} here.", "invalid_request", 400)
            origin, end = chunk_aligned(*region, shape, array.chunks)
            block = np.asarray(array[_slices(origin, end)])
            for key, sl in block_chunks(origin, block.shape, array.chunks):
                if record["chunks"].get(key, [None])[0] != digest(block[sl]):
                    raise mismatch
        else:  # recorded before chunk checksums
            origin, block = (0, 0, 0), np.asarray(array[:])
            if digest(block) != record.get("digest"):
                raise mismatch
        if proposal_digest != record["digest"]:
            raise AnnotationError("Proposal changed since it was inspected; inspect it again.", "revision_conflict")
        mask = block == int(proposal_label)
        if window is None:
            mask[:] = False
        else:
            inside = np.zeros_like(mask)
            inside[_slices(np.subtract(window[0], origin).clip(0), np.subtract(window[1], origin).clip(0))] = True
            mask &= inside
        if not mask.any():
            raise AnnotationError(f"Proposal has no voxels of label {proposal_label} here.", "invalid_request", 400)
        lo, hi = _changed_box(mask, origin)
        mask = mask[_slices(np.subtract(lo, origin), np.subtract(hi, origin))]
        source = {
            "kind": "accepted_proposal",
            "proposal": ref.__dict__,
            "proposal_label": int(proposal_label),
            "proposal_digest": record["digest"],
            "producer": record.get("producer"),
        }
        kept = {}

        def change(labels, at):
            view = labels[_slices(np.subtract(lo, at), np.subtract(hi, at))]
            kept["human"] = int((mask & (view != 0)).sum())
            view[mask & (view == 0)] = int(label)
            return labels

        result = self._edit(base_revision, (lo, hi), change, None, source)
        return {**result, "kept_human_voxels": kept.get("human", 0), "source": source}


def _chunk_record(array) -> dict[str, list]:
    """Per storage chunk: a checksum of its labels and the nonzero labels it holds. Reads one chunk at a time."""
    chunks = {}
    for key, sl in block_chunks((0, 0, 0), array.shape, array.chunks):
        block = np.asarray(array[sl])
        if block.dtype == np.uint8:
            present = np.flatnonzero(np.bincount(block.ravel(), minlength=256)[1:]) + 1
        else:
            present = np.unique(block[block != 0])
        chunks[key] = [digest(block), [int(v) for v in present]]
    return chunks


def record_proposal(group, producer: str, **details) -> dict:
    """Mark a fully written segmentation as a completed proposal (call only after its write finished)."""
    array = group["0"]
    chunks = _chunk_record(array)
    identity = json.dumps({"shape": list(array.shape), "chunks": list(array.chunks), "labels": chunks}, sort_keys=True)
    record = {
        "complete": True,
        "producer": producer,
        "digest": hashlib.sha256(identity.encode()).hexdigest(),
        "chunks": chunks,
        **details,
    }
    group.attrs["proposal"] = record
    return record


def stroke_box(stroke: dict, shape) -> Optional[Box]:
    """The voxels a stroke can touch: its points padded by the radius in its plane, clipped to the array."""
    r = int(math.floor(float(stroke.get("radius", 0))))
    points = np.asarray(stroke["points"], dtype=np.int64).reshape(-1, 3)[:, ::-1]  # -> z, y, x
    if not len(points):
        return None
    in_plane = PLANES[stroke["plane"]]
    pad = np.array([r if a in in_plane else 0 for a in range(3)])
    return _box(points.min(axis=0) - pad, points.max(axis=0) + pad + 1, shape)


def apply_stroke(array: np.ndarray, stroke: dict, origin=(0, 0, 0), shape=None) -> int:
    """Paint discs of ``radius`` voxels around each point (x, y, z indices) in the stroke's plane.

    ``array`` may be a block of a larger volume of ``shape`` starting at ``origin`` (z, y, x); points stay in the
    volume's coordinates and only the part of the stroke inside the block is painted.
    """
    shape = tuple(shape or array.shape)
    origin = np.asarray(origin, dtype=np.int64)
    label = int(stroke["label"])
    radius = float(stroke.get("radius", 0))
    box = stroke_box(stroke, shape)
    if box is None:
        return 0
    box = _box(np.maximum(box[0], origin), np.minimum(box[1], origin + array.shape), shape)
    if box is None:
        return 0
    lo, hi = np.asarray(box[0]), np.asarray(box[1])
    points = np.asarray(stroke["points"], dtype=np.int64).reshape(-1, 3)[:, ::-1]  # -> z, y, x
    in_plane = PLANES[stroke["plane"]]
    region = _slices(lo - origin, hi - origin)
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

"""Painting edits read and write only the storage chunks a gesture touches, and keep their out-of-band guards.

The demo volume is 32^3; these paintings and proposals are stored in 8^3 chunks so one gesture spans a few of 64.
"""

from collections.abc import MutableMapping

import numpy as np
import pytest
import zarr
from copick.util.ome import segmentation_pyramid, write_ome_zarr_3d

from copick_web.app.services import annotations
from copick_web.app.services.annotations import (
    AnnotationError,
    Painting,
    SegmentationRef,
    apply_stroke,
    record_proposal,
)

from .fixtures.make_demo_project import RUN, SHAPE, VOXEL_SIZE

CHUNK = (8, 8, 8)
PAINTING = SegmentationRef("painting", "alice", "1")
PROPOSAL = SegmentationRef("model-proposal", "model", "1")
CLASSES = [{"id": 1}, {"id": 2}, {"id": 3}]


class Recording(MutableMapping):
    """A zarr store that records which chunk keys of array ``0`` are read and written."""

    def __init__(self, store, log):
        self.store, self.log = store, log

    def _chunk(self, key):
        return key.startswith("0/") and not key.rsplit("/", 1)[-1].startswith(".")

    def __getitem__(self, key):
        if self._chunk(key):
            self.log["read"].add(key)
        return self.store[key]

    def __setitem__(self, key, value):
        if self._chunk(key):
            self.log["written"].add(key)
        self.store[key] = value

    def __delitem__(self, key):
        del self.store[key]

    def __iter__(self):
        return iter(self.store)

    def __len__(self):
        return len(self.store)

    def __contains__(self, key):
        return key in self.store


def create(service, ref, array):
    seg = service.get_run(RUN).new_segmentation(
        VOXEL_SIZE, ref.name, ref.session_id, is_multilabel=True, user_id=ref.user_id, exist_ok=True
    )
    write_ome_zarr_3d(seg.zarr(), segmentation_pyramid(array.astype(np.uint8), VOXEL_SIZE, 1, dtype=np.uint8), CHUNK)
    service.clear_stores()
    return zarr.open_group(seg.zarr(), mode="r+")


@pytest.fixture
def log(monkeypatch):
    log = {"read": set(), "written": set()}
    real = zarr.open_group

    def open_group(store, mode="r", **kwargs):
        return real(Recording(store, log), mode=mode, **kwargs)

    monkeypatch.setattr(annotations.zarr, "open_group", open_group)
    return log


def taken(log):
    """Chunk keys read and written since the last call."""
    seen = (set(log["read"]), set(log["written"]))
    log["read"].clear(), log["written"].clear()
    return seen


def keys(*chunks):
    return {"0/" + "/".join(map(str, c)) for c in chunks}


def stroke(label, points, radius=1.0, plane="XY"):
    return {"label": label, "radius": radius, "plane": plane, "points": points}


def test_a_stroke_reads_and_writes_only_the_chunks_it_touches(service, log):
    group = create(service, PAINTING, np.zeros(SHAPE, np.uint8))
    painting = Painting(service, RUN, VOXEL_SIZE, "wbp", PAINTING, CLASSES)
    strokes = [stroke(2, [[6, 9, 3], [9, 9, 3]], radius=1)]  # x 5-10, y 8-10 at z 3: chunks (0, 1, 0) and (0, 1, 1)
    taken(log)
    saved = painting.paint(None, strokes)
    read, written = taken(log)
    expected = np.zeros(SHAPE, np.uint8)
    for s in strokes:
        apply_stroke(expected, s)
    np.testing.assert_array_equal(group["0"][:], expected)
    assert saved["changed_voxels"] == int((expected != 0).sum())
    assert saved["changed_region"] == [[5, 11], [8, 11], [3, 4]]
    assert read == written == keys((0, 1, 0), (0, 1, 1))

    taken(log)
    undone = painting.undo(saved["revision"])
    read, written = taken(log)
    assert not group["0"][:].any() and undone["changed_voxels"] == saved["changed_voxels"]
    assert read == written == keys((0, 1, 0), (0, 1, 1))


def test_undo_keeps_other_writers_elsewhere_and_refuses_them_in_its_chunks(service):
    group = create(service, PAINTING, np.zeros(SHAPE, np.uint8))
    painting = Painting(service, RUN, VOXEL_SIZE, "wbp", PAINTING, CLASSES)
    first = painting.paint(None, [stroke(1, [[2, 2, 2]], radius=0)])
    second = painting.paint(first["revision"], [stroke(2, [[20, 20, 20]], radius=0)])
    group["0"][30, 30, 30] = 3  # another writer, in a chunk no gesture touched
    undone = painting.undo(second["revision"])
    assert group["0"][20, 20, 20] == 0 and group["0"][30, 30, 30] == 3 and undone["can_undo"]
    group["0"][3, 3, 3] = 3  # another writer, in the chunk the first gesture left behind
    with pytest.raises(AnnotationError) as refused:
        painting.undo(undone["revision"])
    assert refused.value.code == "revision_conflict"
    assert group["0"][2, 2, 2] == 1 and group["0"][3, 3, 3] == 3
    assert not painting.state()["can_undo"]  # refused history is dropped, not retried forever


def test_a_stroke_over_another_writers_chunk_drops_older_history(service):
    group = create(service, PAINTING, np.zeros(SHAPE, np.uint8))
    painting = Painting(service, RUN, VOXEL_SIZE, "wbp", PAINTING, CLASSES)
    first = painting.paint(None, [stroke(1, [[2, 2, 2]], radius=0)])
    group["0"][3, 3, 3] = 3
    second = painting.paint(first["revision"], [stroke(2, [[4, 4, 2]], radius=0)])
    undone = painting.undo(second["revision"])
    assert not undone["can_undo"] and group["0"][2, 2, 2] == 1 and group["0"][3, 3, 3] == 3


def test_a_gesture_saved_in_parts_is_undone_together_across_chunks(service):
    group = create(service, PAINTING, np.zeros(SHAPE, np.uint8))
    painting = Painting(service, RUN, VOXEL_SIZE, "wbp", PAINTING, CLASSES)
    revision = None
    for x in (2, 12, 22):
        revision = painting.paint(revision, [stroke(1, [[x, 4, 4]], radius=0)], stroke_id="g")["revision"]
    revision = painting.paint(revision, [stroke(2, [[12, 4, 4]], radius=0)], stroke_id="h")["revision"]
    revision = painting.undo(revision)["revision"]
    assert group["0"][4, 4, 12] == 1
    undone = painting.undo(revision)
    assert undone["changed_voxels"] == 3 and not undone["can_undo"] and not group["0"][:].any()


def test_history_from_before_chunk_checksums_is_not_carried_over(service):
    group = create(service, PAINTING, np.zeros(SHAPE, np.uint8))
    store = group.require_group(annotations.UNDO_GROUP)
    old = store.create_group("old")
    old.create_dataset("indices", data=np.array([0]))
    old.create_dataset("before", data=np.array([0], np.uint8))
    old.attrs.update(digest="x", gesture="old", source=None)
    group.attrs[annotations.META] = {"revision": "old", "undo": ["old"]}
    painting = Painting(service, RUN, VOXEL_SIZE, "wbp", PAINTING, CLASSES)
    assert not painting.state()["can_undo"]
    saved = painting.paint("old", [stroke(1, [[2, 2, 2]], radius=0)])
    undone = painting.undo(saved["revision"])
    assert not undone["can_undo"] and "old" not in store


def test_accepting_reads_only_chunks_holding_the_label(service, log):
    create(service, PAINTING, np.zeros(SHAPE, np.uint8))
    output = np.zeros(SHAPE, np.uint8)
    output[4, 9:12, 9:12] = 1  # chunk (0, 1, 1)
    output[20, 20, 20] = 2  # another label elsewhere
    proposal = create(service, PROPOSAL, output)
    record = record_proposal(proposal, "test-model")
    assert record["chunks"]["0.1.1"][1] == [1] and record["chunks"]["2.2.2"][1] == [2]
    painting = Painting(service, RUN, VOXEL_SIZE, "wbp", PAINTING, CLASSES)
    assert painting.proposal(PROPOSAL)["current"] and "chunks" not in painting.proposal(PROPOSAL)

    proposal["0"][20, 20, 21] = 2  # a later write in a chunk this acceptance does not use
    assert not painting.proposal(PROPOSAL)["current"]
    taken(log)
    done = painting.accept(None, PROPOSAL, 1, 3, record["digest"])
    read, written = taken(log)
    assert done["changed_voxels"] == 9 and done["changed_region"] == [[9, 12], [9, 12], [4, 5]]
    assert read == written == keys((0, 1, 1))  # the proposal's and the painting's chunk (0, 1, 1)

    proposal["0"][4, 15, 15] = 1  # a later write in a chunk it does use
    with pytest.raises(AnnotationError) as refused:
        painting.accept(done["revision"], PROPOSAL, 1, 3, record["digest"])
    assert refused.value.code == "not_complete"

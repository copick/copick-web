"""API behaviour on the demo project: new types, pick identity and the old-copick fallbacks."""

from __future__ import annotations

import json

import numpy as np
import pytest

from copick_web.app.services import compat

from .fixtures.make_demo_project import PICKS, RUN, VOXEL_SIZE

needs_filaments = pytest.mark.skipif(not compat.HAS_FILAMENTS, reason="copick without filaments")
needs_seg_types = pytest.mark.skipif(not compat.HAS_SEG_TYPES, reason="copick without typed segmentations")

PICKS_URL = f"/api/runs/{RUN}/picks/ribosome/alice/1"


def test_config_exposes_features(client):
    body = client.get("/api/config").json()
    assert body["features"] == compat.features()


def test_objects_report_filament_spec(client):
    objects = {o["name"]: o for o in client.get("/api/objects").json()}
    assert objects["microtubule"]["is_filament"] is True
    assert objects["microtubule"]["filament"]["polar"] is True
    assert objects["ribosome"]["is_filament"] is False
    assert objects["ribosome"]["filament"] is None


def test_pick_points_carry_transformations(client):
    body = client.get(PICKS_URL).json()
    assert len(body["points"]) == len(PICKS)
    for point, (location, shift, instance_id, score) in zip(body["points"], PICKS):
        assert (point["x"], point["y"], point["z"]) == pytest.approx(location)
        assert np.asarray(point["transformation"])[:3, 3] == pytest.approx(shift)
        assert point["instance_id"] == instance_id
        assert point["score"] == pytest.approx(score)


def test_picks_summary_counts_instances(client):
    summary = next(p for p in client.get(f"/api/runs/{RUN}/picks").json() if p["object_name"] == "ribosome")
    assert summary["instance_count"] == 3
    assert summary["is_filament"] is False


def test_saving_picks_keeps_transformations(client, service):
    """Regression: update_picks used to drop every transformation (orientations and shifts)."""
    points = client.get(PICKS_URL).json()["points"]
    new_point = {"x": 10.0, "y": 20.0, "z": 30.0, "instance_id": 7, "score": 1.0}
    response = client.put(PICKS_URL, json={"points": points + [new_point]})
    assert response.status_code == 200, response.text

    stored = service.get_pick(RUN, "ribosome", "alice", "1")
    stored.load()
    assert len(stored.points) == len(PICKS) + 1
    for point, (_, shift, _, _) in zip(stored.points, PICKS):
        assert np.asarray(point.transformation)[:3, 3] == pytest.approx(shift)
    assert np.asarray(stored.points[-1].transformation) == pytest.approx(np.eye(4))
    assert stored.points[-1].instance_id == 7
    centre = compat.full_position(stored.points[0])
    location, shift = PICKS[0][0], PICKS[0][1]
    assert centre == pytest.approx(tuple(a + b for a, b in zip(location, shift)))


def test_saving_picks_rejects_bad_transformations(client):
    point = {"x": 1.0, "y": 2.0, "z": 3.0, "transformation": [[1, 0, 0], [0, 1, 0], [0, 0, 1]]}
    assert client.put(PICKS_URL, json={"points": [point]}).status_code == 400


def test_tool_picks_stay_read_only(client):
    assert client.put(f"/api/runs/{RUN}/picks/ribosome/alice/0", json={"points": []}).status_code == 403


@needs_seg_types
def test_segmentations_list_types_and_typed_urls(client):
    segs = client.get(f"/api/runs/{RUN}/segmentations").json()
    by_type = {s["segmentation_type"]: s for s in segs}
    assert set(by_type) == {"binary", "instance", "panoptic"}
    assert by_type["instance"]["is_instance"] and not by_type["instance"]["is_panoptic"]
    assert by_type["panoptic"]["channels"] == ["label", "instance"]
    assert by_type["binary"]["channels"] is None
    # The binary and the instance segmentation share name, user, session and voxel size: the type disambiguates.
    assert by_type["binary"]["zarr_url"] != by_type["instance"]["zarr_url"]
    assert "/zarr/segmentation/instance/" in by_type["instance"]["zarr_url"]

    only = client.get(f"/api/runs/{RUN}/segmentations", params={"segmentation_type": "instance"}).json()
    assert [s["segmentation_type"] for s in only] == ["instance"]


def _array_meta(client, base: str) -> dict:
    """Array metadata of a store's level 0 as ``{"dtype", "shape"}``, for Zarr v2 (.zarray) or v3 (zarr.json)."""
    v3 = client.get(f"{base}/0/zarr.json")
    if v3.status_code == 200:
        meta = json.loads(v3.content)
        return {"dtype": meta["data_type"], "shape": meta["shape"]}
    meta = json.loads(client.get(f"{base}/0/.zarray").content)
    return {"dtype": {"|u1": "uint8", "<u2": "uint16"}.get(meta["dtype"], meta["dtype"]), "shape": meta["shape"]}


@needs_seg_types
def test_typed_proxy_serves_the_right_store(client):
    """Regression: the store lookup was ambiguous once a binary and an instance segmentation shared a key."""
    base = f"/zarr/segmentation/{{}}/{RUN}/ribosome/alice/1/{VOXEL_SIZE}"
    binary = _array_meta(client, base.format("binary"))
    instance = _array_meta(client, base.format("instance"))
    assert binary["dtype"] == "uint8"
    assert instance["dtype"] == "uint16"

    legacy = _array_meta(client, f"/zarr/seg/{RUN}/ribosome/alice/1/{VOXEL_SIZE}")
    assert legacy == binary  # the legacy alias serves binary/multilabel only

    panoptic = _array_meta(client, f"/zarr/segmentation/panoptic/{RUN}/cell/alice/1/{VOXEL_SIZE}")
    assert panoptic["shape"][0] == 2
    assert client.get(f"/zarr/segmentation/bogus/{RUN}/cell/alice/1/{VOXEL_SIZE}/.zattrs").status_code == 404
    assert client.get(f"/zarr/segmentation/binary/{RUN}/cell/alice/1/{VOXEL_SIZE}/.zattrs").status_code == 404


@needs_seg_types
def test_instances_endpoint_measures_centroids(client):
    url = f"/api/runs/{RUN}/segmentations/instance/ribosome/alice/1/{VOXEL_SIZE}/instances"
    body = client.get(url, params={"level": 0}).json()
    assert body["level"] == 0
    by_id = {i["instance_id"]: i for i in body["instances"]}
    assert set(by_id) == {1, 2, 3}
    assert by_id[1]["voxel_count"] == 64
    assert by_id[1]["centroid"] == pytest.approx((35.0, 35.0, 35.0))  # voxels 2..5 at 10 Å, (x, y, z)
    assert by_id[3]["centroid"] == pytest.approx((55.0, 235.0, 215.0))

    coarse = client.get(url).json()  # level 1 by default
    assert coarse["level"] == 1 and {i["instance_id"] for i in coarse["instances"]} == {1, 2, 3}

    assert client.get(url.replace("/instance/", "/binary/")).status_code == 400
    assert client.get(url.replace("ribosome", "membrane")).status_code == 404


@needs_seg_types
def test_panoptic_instances_carry_labels(client):
    url = f"/api/runs/{RUN}/segmentations/panoptic/cell/alice/1/{VOXEL_SIZE}/instances"
    segments = client.get(url, params={"level": 0}).json()["instances"]
    pairs = {(s["label"], s["instance_id"]) for s in segments}
    assert pairs == {(1, 1), (1, 2), (1, 3), (2, 0)}


@needs_filaments
def test_filaments_list_and_detail(client):
    sets = client.get(f"/api/runs/{RUN}/filaments").json()
    assert len(sets) == 1
    assert sets[0]["object_name"] == "microtubule"
    assert sets[0]["filament_count"] == 2
    assert sets[0]["instance_ids"] == [1, 2]

    detail = client.get(f"/api/runs/{RUN}/filaments/microtubule/alice/1").json()
    first = detail["filaments"][0]
    assert first["instance_id"] == 1
    assert first["points"][0] == pytest.approx([20.0, 20.0, 20.0])
    assert first["radius"] == 125.0
    assert detail["filaments"][1]["radius"] is None
    assert client.get(f"/api/runs/{RUN}/filaments/microtubule/bob/1").status_code == 404


# --- An older copick -------------------------------------------------------------------------------------------------


def test_old_copick_turns_features_off(client, old_copick):
    assert client.get("/api/config").json()["features"] == {
        "filaments": False,
        "segmentation_types": False,
        "pick_identity": False,
    }


def test_old_copick_has_no_filaments(client, old_copick):
    assert client.get(f"/api/runs/{RUN}/filaments").json() == []
    assert client.get(f"/api/runs/{RUN}/filaments/microtubule/alice/1").status_code == 501


def test_old_copick_still_serves_picks_and_objects(client, old_copick):
    assert client.get(PICKS_URL).status_code == 200
    objects = {o["name"]: o for o in client.get("/api/objects").json()}
    # Read straight from metadata["copick"]["filament"], so older clients still see filament objects.
    assert objects["microtubule"]["is_filament"] is True
    segs = client.get(f"/api/runs/{RUN}/segmentations").json()
    assert all(s["segmentation_type"] in compat.SEGMENTATION_TYPES for s in segs)


def _decode_surface(body: bytes):
    n, channels = np.frombuffer(body[:8], dtype="<u4")
    voxel_size = float(np.frombuffer(body[8:12], dtype="<f4")[0])
    level = int(np.frombuffer(body[12:16], dtype="<u4")[0])
    offset = 16
    positions = np.frombuffer(body[offset : offset + 12 * n], dtype="<f4").reshape(n, 3)
    offset += 12 * n
    values = np.frombuffer(body[offset : offset + 4 * n * channels], dtype="<u4").reshape(n, channels)
    offset += 4 * n * channels
    normals = np.frombuffer(body[offset:], dtype=np.int8).reshape(n, 3)
    return positions, values, normals, voxel_size, level


def test_boundary_voxels_of_a_cube_across_slabs():
    from copick_web.app.services.copick_service import _boundary_voxels

    vol = np.zeros((8, 8, 8), dtype=np.uint16)
    vol[1:5, 2:6, 3:7] = 7
    vol[6:, :, :] = 9  # touches the volume edge: the edge counts as background
    for slab in (2, 3, 32):
        zyx, values, normals = _boundary_voxels(vol, panoptic=False, slab=slab)
        cube = values == 7
        assert cube.sum() == 64 - 8  # a 4^3 cube minus its 2^3 interior
        corner = np.flatnonzero((zyx == (1, 2, 3)).all(axis=1))[0]
        assert tuple(normals[corner]) == (-1, -1, -1)  # (x, y, z): three exposed faces
        assert (values == 9).sum() == 2 * 64  # both z slices are on the boundary (neighbour 0 or edge)


@needs_seg_types
def test_surface_endpoint_returns_boundary_points(client):
    url = f"/api/runs/{RUN}/segmentations/instance/ribosome/alice/1/{VOXEL_SIZE}/surface"
    response = client.get(url)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/octet-stream"
    positions, values, normals, voxel_size, level = _decode_surface(response.content)
    assert level == 0 and voxel_size == pytest.approx(VOXEL_SIZE)
    assert values.shape[1] == 1
    counts = {int(v): int((values[:, 0] == v).sum()) for v in np.unique(values)}
    assert counts == {1: 56, 2: 56, 3: 4 * 8 * 4 - 2 * 6 * 2}
    cube1 = positions[values[:, 0] == 1]
    assert cube1.min(axis=0) == pytest.approx((20.0, 20.0, 20.0))  # voxels 2..5 at 10 Å
    assert cube1.max(axis=0) == pytest.approx((50.0, 50.0, 50.0))
    assert np.abs(normals).sum(axis=1).min() >= 1

    thinned = _decode_surface(client.get(url, params={"max_points": 50}).content)
    assert len(thinned[0]) <= 50 and thinned[4] == 1  # moved to the coarser level, then thinned

    assert client.get(url.replace("/instance/", "/bogus/")).status_code == 404
    assert client.get(url.replace("ribosome", "membrane")).status_code == 404


@needs_seg_types
def test_panoptic_surface_carries_label_and_instance(client):
    url = f"/api/runs/{RUN}/segmentations/panoptic/cell/alice/1/{VOXEL_SIZE}/surface"
    _, values, _, _, _ = _decode_surface(client.get(url).content)
    assert values.shape[1] == 2
    assert {tuple(map(int, v)) for v in np.unique(values, axis=0)} == {(1, 1), (1, 2), (1, 3), (2, 0)}


def test_binary_surface_works_without_typed_segmentations(client):
    url = f"/api/runs/{RUN}/segmentations/binary/ribosome/alice/1/{VOXEL_SIZE}/surface"
    positions, values, _, _, _ = _decode_surface(client.get(url).content)
    assert len(positions) == 56 + 56 + 104 and set(np.unique(values)) == {1}


def test_run_info_reports_paths_tomograms_and_contents(client, demo_config):
    info = client.get(f"/api/runs/{RUN}/info").json()
    assert info["name"] == RUN and info["backend"] == "CopickRootFSSpec"
    assert info["overlay_path"].endswith(f"ExperimentRuns/{RUN}") and info["portal"] is None
    assert info["counts"]["picks"] >= 1 and info["counts"]["segmentations"] >= 1
    vs = info["voxel_spacings"][0]
    assert vs["voxel_size"] == VOXEL_SIZE and vs["overlay_path"].endswith(f"VoxelSpacing{VOXEL_SIZE:.3f}")
    tomo = vs["tomograms"][0]
    assert tomo["path"].endswith(f"{tomo['tomo_type']}.zarr") and tomo["portal"] is None
    assert len(tomo["zarr"]["shape"]) == 3 and tomo["zarr"]["levels"] >= 1
    # nothing from the configuration's storage options
    assert "fs_args" not in json.dumps(info)
    assert client.get("/api/runs/nope/info").status_code == 404


def test_portal_dataset_id_from_paths():
    from copick_web.app.services.run_info import _dataset_id_from_path

    assert _dataset_id_from_path("s3://cryoet-data-portal-public/10514/Position_11/x.zarr") == 10514
    assert _dataset_id_from_path("https://files.cryoetdataportal.cziscience.com/10006/run/x.zarr") == 10006
    assert _dataset_id_from_path("/local/path/10514/x") is None

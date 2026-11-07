"""CellCanvas adapter: geometry binding, painting, receipts and success-only publication against a simulated core.

The simulated core follows ``cellcanvas_service``'s HTTP contract; the real two-environment roundtrip is
``scripts/cellcanvas_roundtrip.py``.
"""

import json
import uuid

import httpx
import numpy as np
import pytest
import zarr
from fastapi.testclient import TestClient

from copick_web.app.main import create_app
from copick_web.app.services.cellcanvas import load_bindings

from .conftest import PROJECT, serving
from .fixtures.make_demo_project import RUN, SHAPE, VOXEL_SIZE

BASE = f"/api/projects/{PROJECT}/cellcanvas/bindings"


class FakeCore:
    """In-memory core dataset: labels/prediction arrays, receipts, prediction versions."""

    def __init__(self, shape=SHAPE, scale=VOXEL_SIZE, units="angstrom"):
        self.shape, self.scale, self.units = list(shape), scale, units
        self.service_id = uuid.uuid4().hex
        self.labels = np.zeros(shape, "i4")
        self.prediction = np.zeros(shape, "i4")
        self.jobs, self.version, self.status = {}, 0, "unknown"
        self.revision = self.model_revision = None
        self.trained = False
        self.predict_outcome = "succeeded"  # or "failed" / "running"
        self.posts = []
        self.bodies = []
        self.region = None  # slices of the latest prediction version, or None for the volume

    def describe(self):
        return {
            "service_id": self.service_id,
            "image": {"shape": [1, *self.shape]},
            "painting": {"shape": self.shape, "revision": self.revision},
            "prediction": {"shape": self.shape, "status": self.status, "version": self.version},
            "features": {"axis": 0, "shapes": [[2, *self.shape]]},
            "spatial_transform": {"scale": [self.scale] * 3, "translation": [0, 0, 0], "units": [self.units] * 3},
            "trained": self.trained,
            "model_painting_revision": self.model_revision,
            "busy": False,
        }

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.split("/datasets/demo", 1)[1]
        body = json.loads(request.content) if request.content else {}
        if path == "":
            return httpx.Response(200, json=self.describe())
        if path == "/painting":
            assert body["service_id"] == self.service_id and body["shape"] == self.shape
            self.labels[...] = 0
            self.labels.reshape(-1)[body["indices"]] = body["values"]
            self.revision = body["revision"]
            return httpx.Response(200, json={"painting_revision": self.revision})
        if path in ("/train", "/predict"):
            self.posts.append(path)
            self.bodies.append(body)
            if body["service_id"] != self.service_id:
                return httpx.Response(409, json={"error": "changed", "code": "service_changed"})
            op = uuid.UUID(body["operation_id"]).hex
            if op not in self.jobs:
                self.jobs[op] = self._run(path[1:], op, body.get("region"))
            return httpx.Response(202, json=self.jobs[op])
        if path.startswith("/operations/"):
            op = path.rsplit("/", 1)[1]
            return (
                httpx.Response(200, json=self.jobs[op])
                if op in self.jobs
                else httpx.Response(404, json={"error": "Operation not found.", "code": "not_found"})
            )
        if path == "/prediction":
            if self.status != "ready" or int(request.url.params["version"]) != self.version:
                return httpx.Response(409, json={"error": "not ready", "code": "not_ready"})
            data = self.prediction if self.region is None else self.prediction[self.region]
            region = {} if self.region is None else {"X-Region": ",".join(f"{r.start}:{r.stop}" for r in self.region)}
            return httpx.Response(
                200,
                content=np.ascontiguousarray(data).tobytes(),
                headers={
                    **region,
                    "X-Shape": ",".join(map(str, data.shape)),
                    "X-Dtype": "int32",
                    "X-Prediction-Version": str(self.version),
                    "X-Painting-Revision": self.model_revision,
                },
            )
        raise AssertionError(path)

    def _run(self, kind, op, region=None):
        job = {"id": op, "operation": kind, "state": "succeeded", "error": None, "result": None}
        if kind == "train":
            self.trained, self.model_revision = True, self.revision
            job["result"] = {"status": "success"}
            return job
        if self.predict_outcome == "running":
            job["state"] = "running"
            return job
        # Predict "paints" every voxel with the class at the label nearest along x, as a deterministic stand-in;
        # a region prediction writes only the region.
        self.region = (
            None if region is None else tuple(slice(*region.get(a, [0, n])) for a, n in zip("zyx", SHAPE, strict=True))
        )
        stand_in = np.ones(SHAPE, "i4")
        stand_in[..., SHAPE[2] // 2 :] = 2
        where = self.region or (slice(None),) * 3
        self.prediction[where] = stand_in[where]
        self.status = "writing"
        if self.predict_outcome == "failed":
            self.prediction[0, 0, 0] = 7  # partial write
            self.status = "failed"
            return dict(job, state="failed", error={"message": "interrupted", "code": "core_error"})
        self.version += 1
        self.status = "ready"
        job["result"] = {"status": "success", "prediction_version": self.version}
        return job


@pytest.fixture
def core():
    return FakeCore()


@pytest.fixture
def make_app(tmp_path, core):
    def make(**overrides):
        binding = {
            "id": "ts1",
            "project_id": PROJECT,
            "run": RUN,
            "voxel_size": VOXEL_SIZE,
            "tomo_type": "wbp",
            "service_url": "http://127.0.0.1:9",
            "dataset": "demo",
            "classes": [{"id": 1, "name": "background"}, {"id": 2, "name": "membrane"}],
            "painting": {"name": "cellcanvas-painting", "user_id": "cellcanvas", "session_id": "1"},
            "prediction": {"name": "cellcanvas-prediction", "user_id": "cellcanvas", "session_id": "1"},
            "features": {"model": "synthetic-fixture", "provenance": "test"},
        }
        binding.update(overrides)
        path = tmp_path / "bindings.json"
        path.write_text(json.dumps({"bindings": [binding]}))
        app = create_app(allow_empty=True, cellcanvas_bindings=path)
        app.state.cellcanvas_client_factory = lambda: httpx.Client(transport=httpx.MockTransport(core))
        return app

    return make


@pytest.fixture
def client(make_app, service):
    app = make_app()
    with serving(app, service):
        yield TestClient(app, raise_server_exceptions=True)


def stroke(label, points, radius=1.0, plane="XY"):
    return {"label": label, "radius": radius, "plane": plane, "points": points}


def painting_array(service):
    seg = service.get_segmentations(RUN, "cellcanvas-painting", "cellcanvas", "1", VOXEL_SIZE)[0]
    return np.asarray(zarr.open_group(seg.zarr(), mode="r")["0"][:])


def prediction_group(service):
    segs = service.get_segmentations(RUN, "cellcanvas-prediction", "cellcanvas", "1", VOXEL_SIZE)
    return zarr.open_group(segs[0].zarr(), mode="r") if segs else None


def test_binding_loader_rejects_unsafe_or_ambiguous_files(tmp_path):
    def write(**binding):
        base = {
            "id": "a",
            "run": "r",
            "voxel_size": 10,
            "tomo_type": "t",
            "service_url": "http://127.0.0.1:1",
            "dataset": "d",
            "classes": [{"id": 1, "name": "bg"}],
            "painting": {"name": "p", "user_id": "u", "session_id": "1"},
            "prediction": {"name": "q", "user_id": "u", "session_id": "1"},
        }
        path = tmp_path / "b.json"
        path.write_text(json.dumps({"bindings": [dict(base, **binding)]}))
        return path

    assert load_bindings(write())[0].class_ids == {1}
    for bad in (
        {"service_url": "http://example.org:1"},
        {"service_url": "file:///tmp"},
        {"classes": [{"id": 0, "name": "unknown"}]},
        {"classes": [{"id": 1, "name": "a"}, {"id": 1, "name": "b"}]},
        {"prediction": {"name": "p", "user_id": "u", "session_id": "1"}},
    ):
        with pytest.raises(ValueError):
            load_bindings(write(**bad))


def test_status_reports_geometry_agreement_and_mismatch(make_app, service, core):
    app = make_app()
    with serving(app, service):
        c = TestClient(app)
        listed = c.get(f"/api/projects/{PROJECT}/cellcanvas/bindings", params={"run": RUN}).json()["bindings"]
        assert [b["id"] for b in listed] == ["ts1"]
        assert c.get(f"/api/projects/{PROJECT}/cellcanvas/bindings", params={"run": "other"}).json() == {"bindings": []}
        status = c.get(f"{BASE}/ts1").json()
        assert status["check"]["ok"], status["check"]["problems"]
        assert status["check"]["copick"]["shape"] == list(SHAPE)
        assert status["check"]["copick"]["scale_angstrom"] == [VOXEL_SIZE] * 3
        assert {k: status["painting"][k] for k in ("exists", "revision", "can_undo")} == {
            "exists": False,
            "revision": None,
            "can_undo": False,
        }
        core.scale, core.shape = 1.0, [32, 32, 31]
        problems = c.get(f"{BASE}/ts1").json()["check"]["problems"]
        assert any("voxel size" in p for p in problems) and any("shape" in p for p in problems)
        core.scale, core.shape, core.units = 1.0, list(SHAPE), "nanometer"  # 1 nm = 10 Å: equivalent
        assert c.get(f"{BASE}/ts1").json()["check"]["ok"]


def test_painting_saves_classes_erases_to_unknown_and_checks_revision(client, service):
    first = client.post(
        f"{BASE}/ts1/painting",
        json={
            "base_revision": None,
            "strokes": [stroke(2, [[10, 12, 5]], radius=2), stroke(1, [[20, 20, 5], [22, 20, 5]], radius=0)],
        },
    )
    assert first.status_code == 200, first.text
    labels = painting_array(service)
    assert labels.dtype == np.uint8
    # x, y, z = 10, 12, 5 -> labels[z, y, x]; a radius-2 disc in the XY plane at z = 5 only.
    assert labels[5, 12, 10] == 2 and labels[5, 12, 12] == 2 and labels[5, 14, 10] == 2
    assert labels[4, 12, 10] == 0 and labels[6, 12, 10] == 0 and labels[5, 14, 12] == 0
    assert labels[5, 20, 20] == labels[5, 20, 22] == 1 and labels[5, 20, 21] == 0
    assert int((labels == 2).sum()) == 13 and int((labels == 1).sum()) == 2
    # A stale base revision is refused and changes nothing.
    stale = client.post(f"{BASE}/ts1/painting", json={"base_revision": None, "strokes": [stroke(1, [[0, 0, 0]])]})
    assert stale.status_code == 409 and stale.json()["code"] == "revision_conflict"
    revision = first.json()["revision"]
    erase = client.post(
        f"{BASE}/ts1/painting",
        json={"base_revision": revision, "strokes": [stroke(0, [[10, 12, 5]], radius=0, plane="XZ")]},
    )
    assert erase.status_code == 200
    labels = painting_array(service)
    assert labels[5, 12, 10] == 0 and int((labels == 2).sum()) == 12
    # Unbound labels, oversized brushes and bad planes are refused.
    for bad in (stroke(3, [[1, 1, 1]]), stroke(1, [[1, 1, 1]], radius=100), stroke(1, [[1, 1, 1]], plane="3D")):
        response = client.post(
            f"{BASE}/ts1/painting", json={"base_revision": erase.json()["revision"], "strokes": [bad]}
        )
        assert response.status_code == 400


def test_train_predict_publish_roundtrip_with_receipts(client, service, core):
    saved = client.post(
        f"{BASE}/ts1/painting", json={"strokes": [stroke(1, [[3, 3, 3]], radius=1), stroke(2, [[28, 28, 3]], radius=1)]}
    ).json()
    train_id = str(uuid.uuid4())
    trained = client.post(f"{BASE}/ts1/train", json={"operation_id": train_id})
    assert trained.status_code == 200, trained.text
    assert trained.json()["last"]["state"] == "succeeded"
    assert trained.json()["last"]["painting_revision"] == saved["revision"] == core.revision
    np.testing.assert_array_equal(core.labels, painting_array(service))  # identical labels, unknown kept 0
    # Retrying the same operation ID does not resubmit.
    again = client.post(f"{BASE}/ts1/train", json={"operation_id": train_id})
    assert again.status_code == 200 and core.posts == ["/train"]
    predicted = client.post(f"{BASE}/ts1/predict", json={"operation_id": str(uuid.uuid4())}).json()
    publication = predicted["last"]["publication"]
    assert publication["complete"] and publication["prediction_version"] == 1
    assert publication["painting_revision"] == saved["revision"]
    group = prediction_group(service)
    np.testing.assert_array_equal(group["0"][:], core.prediction)
    assert group.attrs["cellcanvas"]["features"]["model"] == "synthetic-fixture"
    ms = group.attrs["multiscales"][0]["datasets"][0]["coordinateTransformations"]
    assert ms[0]["scale"] == [VOXEL_SIZE] * 3
    # The published prediction is served by the existing segmentation proxy, not cached.
    proxied = client.get(
        f"/zarr/{PROJECT}/segmentation/multilabel/{RUN}/cellcanvas-prediction/cellcanvas/1/{VOXEL_SIZE}/.zattrs"
    )
    assert proxied.status_code == 200 and proxied.headers["cache-control"] == "no-store"
    assert proxied.json()["cellcanvas"]["operation_id"] == publication["operation_id"]
    # Republishing a newer version swaps the store in place; no staging directory remains.
    core.prediction[...] = 2
    client.post(f"{BASE}/ts1/predict", json={"operation_id": str(uuid.uuid4())})
    assert prediction_group(service).attrs["cellcanvas"]["prediction_version"] == 2
    assert int(prediction_group(service)["0"][:].min()) == 1  # the fake writes 1 | 2 again
    parent = service.get_segmentations(RUN, "cellcanvas-prediction")[0].zarr()
    parent = (getattr(parent, "root", None) or parent.path).rsplit("/", 1)[0]
    import os

    assert not [n for n in os.listdir(parent) if n.startswith(".cellcanvas-")]


def test_failed_prediction_keeps_previous_publication(client, service, core):
    client.post(f"{BASE}/ts1/painting", json={"strokes": [stroke(1, [[3, 3, 3]]), stroke(2, [[28, 28, 3]])]})
    client.post(f"{BASE}/ts1/train", json={"operation_id": str(uuid.uuid4())})
    first = client.post(f"{BASE}/ts1/predict", json={"operation_id": str(uuid.uuid4())}).json()
    before = prediction_group(service)["0"][:]
    core.predict_outcome = "failed"
    failed = client.post(f"{BASE}/ts1/predict", json={"operation_id": str(uuid.uuid4())}).json()
    assert failed["last"]["state"] == "failed" and "publication" not in failed["last"]
    assert core.prediction[0, 0, 0] == 7  # the core store was partially written
    group = prediction_group(service)
    np.testing.assert_array_equal(group["0"][:], before)
    assert group.attrs["cellcanvas"]["operation_id"] == first["last"]["publication"]["operation_id"]


def test_failed_first_prediction_publishes_nothing(client, service, core):
    client.post(f"{BASE}/ts1/painting", json={"strokes": [stroke(1, [[3, 3, 3]])]})
    client.post(f"{BASE}/ts1/train", json={"operation_id": str(uuid.uuid4())})
    core.predict_outcome = "failed"
    client.post(f"{BASE}/ts1/predict", json={"operation_id": str(uuid.uuid4())})
    assert prediction_group(service) is None


def test_pending_receipt_is_reconciled_not_resubmitted(client, service, core):
    client.post(f"{BASE}/ts1/painting", json={"strokes": [stroke(1, [[3, 3, 3]])]})
    client.post(f"{BASE}/ts1/train", json={"operation_id": str(uuid.uuid4())})
    core.predict_outcome = "running"
    op = str(uuid.uuid4())
    running = client.post(f"{BASE}/ts1/predict", json={"operation_id": op}).json()
    assert running["pending"]["state"] == "running"
    other = client.post(f"{BASE}/ts1/predict", json={"operation_id": str(uuid.uuid4())})
    assert other.status_code == 409 and other.json()["code"] == "operation_pending"
    # A lost response is retried with the same ID: still one submission.
    assert client.post(f"{BASE}/ts1/predict", json={"operation_id": op}).json()["pending"]["state"] == "running"
    assert core.posts.count("/predict") == 1
    # The page reloads: status still reports the same pending receipt.
    assert client.get(f"{BASE}/ts1").json()["operation"]["pending"]["id"] == uuid.UUID(op).hex
    # The service restarts: the receipt is reported lost and nothing is published.
    core.service_id = uuid.uuid4().hex
    lost = client.get(f"{BASE}/ts1/operation").json()
    assert lost["pending"] is None and lost["last"]["state"] == "lost"
    assert lost["last"]["error"]["code"] == "service_changed"
    assert prediction_group(service) is None


def test_train_refuses_without_painting_or_with_unbound_labels(client, service, core):
    response = client.post(f"{BASE}/ts1/train", json={"operation_id": str(uuid.uuid4())})
    assert response.status_code == 409 and response.json()["code"] == "no_painting"
    client.post(f"{BASE}/ts1/painting", json={"strokes": [stroke(1, [[3, 3, 3]])]})
    seg = service.get_segmentations(RUN, "cellcanvas-painting", "cellcanvas", "1", VOXEL_SIZE)[0]
    zarr.open_group(seg.zarr(), mode="r+")["0"][0, 0, 0] = 9  # another tool wrote an unbound label
    response = client.post(f"{BASE}/ts1/train", json={"operation_id": str(uuid.uuid4())})
    assert response.status_code == 409 and response.json()["code"] == "invalid_painting"
    assert core.posts == []


def test_read_only_refuses_writes(make_app, service, tmp_path):
    app = make_app()
    app.state.read_only = True
    with serving(app, service):
        c = TestClient(app)
        assert c.post(f"{BASE}/ts1/painting", json={"strokes": [stroke(1, [[3, 3, 3]])]}).status_code == 403
        assert c.post(f"{BASE}/ts1/undo", json={"base_revision": None}).status_code == 403
        assert c.post(f"{BASE}/ts1/train", json={"operation_id": str(uuid.uuid4())}).status_code == 403
        assert c.get(f"{BASE}/ts1").status_code == 200


def test_binding_by_config_works_under_a_host_mount(tmp_path, demo_config, core):
    """BioNotate-style embedding: the binding names the copick config; routes answer under the host's prefix."""
    from .test_embed import MOUNT, mounted

    path = tmp_path / "mounted-bindings.json"
    path.write_text(
        json.dumps(
            {
                "bindings": [
                    {
                        "id": "ts1",
                        "config": str(demo_config),
                        "run": RUN,
                        "voxel_size": VOXEL_SIZE,
                        "tomo_type": "wbp",
                        "service_url": "http://localhost:9",
                        "dataset": "demo",
                        "classes": [{"id": 1, "name": "background"}],
                        "painting": {"name": "p", "user_id": "cellcanvas", "session_id": "1"},
                        "prediction": {"name": "q", "user_id": "cellcanvas", "session_id": "1"},
                    }
                ]
            }
        )
    )
    copick_app = create_app(configs=[demo_config], cellcanvas_bindings=path)
    copick_app.state.cellcanvas_client_factory = lambda: httpx.Client(transport=httpx.MockTransport(core))
    with TestClient(mounted(copick_app)) as host:
        pid = host.get(f"{MOUNT}/api/projects").json()[0]["id"]
        listed = host.get(f"{MOUNT}/api/projects/{pid}/cellcanvas/bindings").json()["bindings"]
        assert [b["id"] for b in listed] == ["ts1"]
        assert host.get(f"{MOUNT}/api/projects/{pid}/cellcanvas/bindings/ts1").json()["check"]["ok"]
        saved = host.post(
            f"{MOUNT}/api/projects/{pid}/cellcanvas/bindings/ts1/painting", json={"strokes": [stroke(1, [[1, 1, 1]])]}
        )
        assert saved.status_code == 200
        # Another project's ID does not see this binding.
        assert host.get(f"{MOUNT}/api/projects/other/cellcanvas/bindings").status_code in (200, 404)


def test_undo_overlap_erase_reload_and_conflicts(make_app, service):
    app = make_app()
    with serving(app, service):
        client = TestClient(app)
        revision = None
        snapshots = []
        for label in (1, 2, 0):
            result = client.post(
                f"{BASE}/ts1/painting",
                json={"base_revision": revision, "strokes": [stroke(label, [[4, 5, 6]], radius=0)]},
            )
            assert result.status_code == 200, result.text
            revision = result.json()["revision"]
            snapshots.append(painting_array(service))
        assert client.post(f"{BASE}/ts1/undo", json={"base_revision": "stale"}).status_code == 409
        np.testing.assert_array_equal(painting_array(service), snapshots[-1])
    # Reload the application: history is persisted with the segmentation, not in browser/server memory.
    app = make_app()
    with serving(app, service):
        client = TestClient(app)
        assert client.get(f"{BASE}/ts1").json()["painting"]["can_undo"]
        for expected in (snapshots[1], snapshots[0], np.zeros_like(snapshots[0])):
            result = client.post(f"{BASE}/ts1/undo", json={"base_revision": revision})
            assert result.status_code == 200, result.text
            revision = result.json()["revision"]
            np.testing.assert_array_equal(painting_array(service), expected)
        assert not result.json()["can_undo"]
        assert client.post(f"{BASE}/ts1/undo", json={"base_revision": revision}).json()["code"] == "nothing_to_undo"


def test_undo_groups_chunks_and_refuses_out_of_band_changes(client, service):
    revision = None
    for x in (3, 4):
        result = client.post(
            f"{BASE}/ts1/painting",
            json={"base_revision": revision, "stroke_id": "one-gesture", "strokes": [stroke(2, [[x, 5, 6]], radius=0)]},
        ).json()
        revision = result["revision"]
    result = client.post(f"{BASE}/ts1/undo", json={"base_revision": revision}).json()
    assert result["changed_voxels"] == 2 and not result["can_undo"]
    assert not painting_array(service).any()
    result = client.post(
        f"{BASE}/ts1/painting",
        json={"base_revision": result["revision"], "strokes": [stroke(1, [[3, 5, 6]], radius=0)]},
    ).json()
    revision = result["revision"]
    # No-op strokes do not hide the most recent meaningful edit.
    same = client.post(
        f"{BASE}/ts1/painting", json={"base_revision": revision, "strokes": [stroke(1, [[3, 5, 6]], radius=0)]}
    ).json()
    assert same["revision"] == revision and same["changed_voxels"] == 0
    seg = service.get_segmentations(RUN, "cellcanvas-painting", "cellcanvas", "1", VOXEL_SIZE)[0]
    group = zarr.open_group(seg.zarr(), mode="r+")
    group["0"][0, 0, 0] = 2  # A writer that does not participate in revision tracking.
    before = painting_array(service)
    result = client.post(f"{BASE}/ts1/undo", json={"base_revision": revision})
    assert result.status_code == 409 and result.json()["code"] == "revision_conflict"
    np.testing.assert_array_equal(painting_array(service), before)


def test_undo_retains_twenty_gestures(client, service):
    revision = None
    for i in range(22):
        result = client.post(
            f"{BASE}/ts1/painting",
            json={"base_revision": revision, "strokes": [stroke(1 + i % 2, [[3, 5, 6]], radius=0)]},
        ).json()
        revision = result["revision"]
    for _ in range(20):
        response = client.post(f"{BASE}/ts1/undo", json={"base_revision": revision})
        assert response.status_code == 200
        result = response.json()
        revision = result["revision"]
    assert not result["can_undo"]
    assert painting_array(service)[6, 5, 3] == 2


def test_published_prediction_is_a_proposal_accepted_into_unknown_voxels_only(client, service, core):
    saved = client.post(
        f"{BASE}/ts1/painting", json={"strokes": [stroke(1, [[3, 3, 3]], radius=1), stroke(2, [[28, 28, 3]], radius=1)]}
    ).json()
    client.post(f"{BASE}/ts1/train", json={"operation_id": str(uuid.uuid4())})
    predicted = client.post(f"{BASE}/ts1/predict", json={"operation_id": str(uuid.uuid4())}).json()
    record = predicted["last"]["publication"]["proposal"]
    assert record["producer"] == "cellcanvas" and record["complete"]
    proposal = {"name": "cellcanvas-prediction", "user_id": "cellcanvas", "session_id": "1"}
    body = {
        "base_revision": saved["revision"],
        "proposal": proposal,
        "proposal_label": 2,
        "proposal_digest": record["digest"],
        "label": 2,
        "box": [[0, 32], [0, 32], [3, 4]],  # one z slice
    }
    accepted = client.post(f"{BASE}/ts1/accept", json=body)
    assert accepted.status_code == 200, accepted.text
    painted = painting_array(service)
    assert accepted.json()["kept_human_voxels"] == 5  # the human class-2 stroke is kept as painted
    assert painted[3, 3, 3] == 1  # the human background label left of the class boundary is untouched
    assert (painted[3, :, 16:] == 2).all()
    assert painted[5, 20, 20] == 0  # outside the box stays unknown
    # A label outside the binding's classes is refused even though the project defines it.
    refused = client.post(f"{BASE}/ts1/accept", json={**body, "base_revision": accepted.json()["revision"], "label": 3})
    assert refused.status_code == 400


def chunk_files(group):
    """Written chunk keys of the prediction's level 0 (unwritten chunks read as 0)."""
    import os

    root = group.store.path if hasattr(group.store, "path") else group.store.dir_path()
    level = os.path.join(root, "0")
    return {
        os.path.relpath(os.path.join(d, f), level).replace(os.sep, ".")
        for d, _, files in os.walk(level)
        for f in files
        if not f.startswith(".")
    }


def test_region_prediction_publishes_only_its_chunks_and_accumulates_per_model(client, service, core, monkeypatch):
    import copick_web.app.services.cellcanvas as cc

    monkeypatch.setattr(cc, "PREDICTION_CHUNKS", (8, 8, 8))  # 4 x 4 x 4 chunks on the 32^3 fixture
    client.post(f"{BASE}/ts1/painting", json={"strokes": [stroke(1, [[3, 3, 3]]), stroke(2, [[28, 28, 3]])]})
    client.post(f"{BASE}/ts1/train", json={"operation_id": str(uuid.uuid4())})
    predicted = client.post(f"{BASE}/ts1/predict", json={"operation_id": str(uuid.uuid4()), "region": {"z": [3, 4]}})
    assert predicted.status_code == 200, predicted.text
    assert core.bodies[-1]["region"] == {"z": [3, 4], "y": [0, 32], "x": [0, 32]}
    publication = predicted.json()["last"]["publication"]
    assert publication["complete"] and publication["region"] == {"z": [3, 4], "y": [0, 32], "x": [0, 32]}
    assert publication["changed_region"] == [[0, 32], [0, 32], [0, 8]] and publication["chunks_written"] == 16
    group = prediction_group(service)
    labels = group["0"][:]
    np.testing.assert_array_equal(labels[3], core.prediction[3])
    assert not labels[:3].any() and not labels[4:].any()
    assert chunk_files(group) == {f"0.{y}.{x}" for y in range(4) for x in range(4)}
    # The same model's next region accumulates; the first region and untouched chunks stay as they were.
    second = client.post(f"{BASE}/ts1/predict", json={"operation_id": str(uuid.uuid4()), "region": {"z": [20, 22]}})
    publication = second.json()["last"]["publication"]
    assert publication["chunks_written"] == 16 and len(publication["regions"]) == 2
    labels = prediction_group(service)["0"][:]
    assert labels[3].all() and labels[20:22].all() and not labels[4:20].any()
    assert len(chunk_files(prediction_group(service))) == 32
    # Inspecting and accepting read the chunks that hold labels; the record is the region-updated one.
    proposal = {"name": "cellcanvas-prediction", "user_id": "cellcanvas", "session_id": "1"}
    inspected = client.get(
        f"/api/projects/{PROJECT}/painting/proposal",
        params={
            "run": RUN,
            "voxel_size": VOXEL_SIZE,
            "tomo_type": "wbp",
            "name": "cellcanvas-painting",
            "user_id": "cellcanvas",
            "session_id": "1",
            "proposal_name": proposal["name"],
            "proposal_user_id": proposal["user_id"],
            "proposal_session_id": proposal["session_id"],
        },
    )
    assert inspected.status_code == 200, inspected.text
    assert inspected.json()["current"] and inspected.json()["digest"] == publication["proposal"]["digest"]
    # A newer model clears the older model's chunks before writing its region.
    saved = client.post(
        f"{BASE}/ts1/painting", json={"base_revision": core.revision, "strokes": [stroke(1, [[3, 3, 12]])]}
    ).json()
    client.post(f"{BASE}/ts1/train", json={"operation_id": str(uuid.uuid4())})
    third = client.post(f"{BASE}/ts1/predict", json={"operation_id": str(uuid.uuid4()), "region": {"z": [12, 13]}})
    publication = third.json()["last"]["publication"]
    assert publication["painting_revision"] == saved["revision"] and publication["regions"] == [publication["region"]]
    labels = prediction_group(service)["0"][:]
    assert labels[12].all() and not np.delete(labels, 12, axis=0).any()
    assert publication["chunks_written"] == 48  # z chunk 1 written, z chunks 0 and 2 cleared


def test_region_publication_accepts_into_unknown_voxels_and_undoes_exactly(client, service, core):
    saved = client.post(
        f"{BASE}/ts1/painting", json={"strokes": [stroke(1, [[3, 3, 3]], radius=1), stroke(2, [[28, 28, 3]], radius=1)]}
    ).json()
    client.post(f"{BASE}/ts1/train", json={"operation_id": str(uuid.uuid4())})
    predicted = client.post(
        f"{BASE}/ts1/predict", json={"operation_id": str(uuid.uuid4()), "region": {"z": [2, 5]}}
    ).json()
    record = predicted["last"]["publication"]["proposal"]
    before = painting_array(service)
    body = {
        "base_revision": saved["revision"],
        "proposal": {"name": "cellcanvas-prediction", "user_id": "cellcanvas", "session_id": "1"},
        "proposal_label": 2,
        "proposal_digest": record["digest"],
        "label": 2,
        "box": [[0, 32], [0, 32], [0, 32]],  # wider than the predicted region
    }
    accepted = client.post(f"{BASE}/ts1/accept", json=body)
    assert accepted.status_code == 200, accepted.text
    painted = painting_array(service)
    changed = painted != before
    assert (before[changed] == 0).all() and (painted[changed] == 2).all()  # only unknown voxels, as class 2
    assert changed[2:5].any() and not changed[:2].any() and not changed[5:].any()  # only inside the region
    assert painted[3, 3, 3] == 1 and accepted.json()["kept_human_voxels"] == 5
    undone = client.post(f"{BASE}/ts1/undo", json={"base_revision": accepted.json()["revision"]})
    assert undone.status_code == 200 and undone.json()["undone"]["kind"] == "accepted_proposal"
    np.testing.assert_array_equal(painting_array(service), before)


def test_interrupted_region_publication_is_refused_then_completed_by_reconcile(client, service, core, monkeypatch):
    import copick_web.app.services.cellcanvas as cc

    client.post(f"{BASE}/ts1/painting", json={"strokes": [stroke(1, [[3, 3, 3]]), stroke(2, [[28, 28, 3]])]})
    client.post(f"{BASE}/ts1/train", json={"operation_id": str(uuid.uuid4())})
    real = cc._chunk_entry

    def crash(block):
        raise OSError("disk went away")

    monkeypatch.setattr(cc, "_chunk_entry", crash)
    with pytest.raises(OSError):
        client.post(f"{BASE}/ts1/predict", json={"operation_id": str(uuid.uuid4()), "region": {"z": [3, 4]}})
    group = prediction_group(service)
    assert group.attrs["cellcanvas"]["complete"] is False and group.attrs["proposal"]["complete"] is False
    monkeypatch.setattr(cc, "_chunk_entry", real)
    resolved = client.get(f"{BASE}/ts1/operation").json()
    assert resolved["last"]["state"] == "succeeded" and resolved["published"]["complete"]
    np.testing.assert_array_equal(prediction_group(service)["0"][3], core.prediction[3])


def test_region_requests_are_validated(client, service, core):
    client.post(f"{BASE}/ts1/painting", json={"strokes": [stroke(1, [[3, 3, 3]]), stroke(2, [[28, 28, 3]])]})
    bad = client.post(f"{BASE}/ts1/train", json={"operation_id": str(uuid.uuid4()), "region": {"z": [0, 1]}})
    assert bad.status_code == 400
    client.post(f"{BASE}/ts1/train", json={"operation_id": str(uuid.uuid4())})
    for region in ({"z": [4, 4]}, {"z": [0, 33]}, {"t": [0, 1]}, {}):
        refused = client.post(f"{BASE}/ts1/predict", json={"operation_id": str(uuid.uuid4()), "region": region})
        assert refused.status_code == 400, region
    # A region spanning the whole volume is a whole-volume prediction (no region sent to the core).
    whole = client.post(f"{BASE}/ts1/predict", json={"operation_id": str(uuid.uuid4()), "region": {"z": [0, 32]}})
    assert whole.status_code == 200 and "region" not in core.bodies[-1]
    assert "region" not in whole.json()["last"]["publication"]


def test_concurrent_reconciles_publish_a_region_once(client, service, core):
    import threading

    client.post(f"{BASE}/ts1/painting", json={"strokes": [stroke(1, [[3, 3, 3]]), stroke(2, [[28, 28, 3]])]})
    client.post(f"{BASE}/ts1/train", json={"operation_id": str(uuid.uuid4())})
    core.predict_outcome = "running"
    op = uuid.uuid4()
    client.post(f"{BASE}/ts1/predict", json={"operation_id": str(op), "region": {"z": [3, 4]}})
    # The core finishes; two polls (e.g. the submit response and the 1 s poll) reconcile the receipt at once.
    core.region = (slice(3, 4), slice(0, 32), slice(0, 32))
    core.prediction[3] = 2
    core.version, core.status = core.version + 1, "ready"
    core.jobs[op.hex].update(state="succeeded", result={"status": "success", "prediction_version": core.version})
    threads = [threading.Thread(target=client.get, args=(f"{BASE}/ts1/operation",)) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    meta = prediction_group(service).attrs["cellcanvas"]
    assert meta["complete"] and meta["regions"] == [{"z": [3, 4], "y": [0, 32], "x": [0, 32]}]

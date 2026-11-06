"""Backend-independent painting, undo and proposal acceptance, and nnInteractive prompts published as proposals.

The nnInteractive server here is simulated at its HTTP boundary (its routes write into the same copick project);
the roundtrip against a running ``nninteractive-server`` is in the integration report, not in this public suite.
"""

import json
from contextlib import contextmanager

import httpx
import numpy as np
import pytest
import zarr
from fastapi.testclient import TestClient

from copick_web.app.dependencies import get_registry
from copick_web.app.main import create_app
from copick_web.app.services.annotations import record_proposal
from copick_web.app.services.project_registry import ProjectRegistry

from .conftest import PROJECT, serving
from .fixtures.make_demo_project import RUN, SHAPE, VOXEL_SIZE

BASE = f"/api/projects/{PROJECT}"
PAINTING = {"name": "painting", "user_id": "alice", "session_id": "1"}
PROPOSAL = {"name": "model-proposal", "user_id": "model", "session_id": "1"}
TARGET = {"run": RUN, "voxel_size": VOXEL_SIZE, "tomo_type": "wbp", "painting": PAINTING}
QUERY = {"run": RUN, "voxel_size": VOXEL_SIZE, "tomo_type": "wbp", **PAINTING}
PROPOSAL_QUERY = {**QUERY, **{f"proposal_{k}": v for k, v in PROPOSAL.items()}}


@contextmanager
def app_client(service, **options):
    app = create_app(allow_empty=True, **options)
    with serving(app, service):
        yield app, TestClient(app, raise_server_exceptions=True)


@pytest.fixture
def client(service):
    with app_client(service) as (_, c):
        yield c


def stroke(label, points, radius=1.0, plane="XY"):
    return {"label": label, "radius": radius, "plane": plane, "points": points}


def labels(service, ref):
    seg = service.get_segmentations(RUN, ref["name"], ref["user_id"], ref["session_id"], VOXEL_SIZE)[0]
    return np.asarray(zarr.open_group(seg.zarr(), mode="r")["0"][:])


def write_proposal(service, array, complete=True):
    run = service.get_run(RUN)
    seg = run.new_segmentation(VOXEL_SIZE, PROPOSAL["name"], "1", is_multilabel=True, user_id="model", exist_ok=True)
    seg.from_numpy(array.astype(np.uint8), levels=1, dtype=np.uint8)
    service.clear_stores()
    group = zarr.open_group(seg.zarr(), mode="r+")
    if complete:
        record_proposal(group, "test-model", label=1)
    return group


def test_painting_works_without_any_backend(client, service):
    backends = client.get(f"{BASE}/backends").json()
    assert backends == {"painting": True, "cellcanvas": False, "nninteractive": {"available": False}}
    state = client.get(f"{BASE}/painting", params=QUERY).json()
    assert state["exists"] is False and [c["id"] for c in state["classes"]] == [1, 2, 3]

    r = client.post(
        f"{BASE}/painting/strokes", json={**TARGET, "base_revision": None, "strokes": [stroke(2, [[5, 5, 3]])]}
    )
    first = r.json()
    assert r.status_code == 200 and first["changed_voxels"] == 5 and first["can_undo"]
    painted = labels(service, PAINTING)
    assert painted[3, 5, 5] == 2 and painted.sum() == 10  # unpainted voxels stay unknown (0)

    stale = client.post(
        f"{BASE}/painting/strokes", json={**TARGET, "base_revision": None, "strokes": [stroke(1, [[9, 9, 3]])]}
    )
    assert stale.status_code == 409 and stale.json()["code"] == "revision_conflict"
    assert stale.json()["detail"] == "Annotation operation refused"  # server-side messages stay in the log
    bad = client.post(
        f"{BASE}/painting/strokes",
        json={**TARGET, "base_revision": first["revision"], "strokes": [stroke(9, [[1, 1, 1]])]},
    )
    assert bad.status_code == 400

    erase = client.post(
        f"{BASE}/painting/strokes",
        json={**TARGET, "base_revision": first["revision"], "strokes": [stroke(0, [[5, 5, 3]], radius=0)]},
    ).json()
    assert labels(service, PAINTING)[3, 5, 5] == 0
    undone = client.post(f"{BASE}/painting/undo", json={**TARGET, "base_revision": erase["revision"]}).json()
    assert labels(service, PAINTING)[3, 5, 5] == 2 and undone["can_undo"]


def test_read_only_app_refuses_edits(service):
    with app_client(service, read_only=True) as (_, c):
        r = c.post(f"{BASE}/painting/strokes", json={**TARGET, "strokes": [stroke(2, [[5, 5, 3]])]})
        assert r.status_code == 403
        assert c.get(f"{BASE}/painting", params=QUERY).status_code == 200


def test_accepting_requires_a_current_completed_proposal_and_keeps_human_labels(client, service):
    painted = client.post(
        f"{BASE}/painting/strokes", json={**TARGET, "strokes": [stroke(3, [[10, 10, 4]], radius=0)]}
    ).json()
    output = np.zeros(SHAPE, np.uint8)
    output[4, 8:13, 8:13] = 1  # overlaps the human label at (z4, y10, x10)
    write_proposal(service, output, complete=False)

    inspect = client.get(f"{BASE}/painting/proposal", params=PROPOSAL_QUERY)
    assert inspect.status_code == 409 and inspect.json()["code"] == "not_complete"

    group = write_proposal(service, output)
    record = client.get(f"{BASE}/painting/proposal", params=PROPOSAL_QUERY).json()
    assert record["current"] and record["producer"] == "test-model"
    accept = {
        **TARGET,
        "base_revision": painted["revision"],
        "proposal": PROPOSAL,
        "proposal_label": 1,
        "proposal_digest": record["digest"],
        "label": 2,
    }

    group["0"][0, 0, 0] = 1  # a later write that has not been recorded as complete
    r = client.post(f"{BASE}/painting/accept", json=accept)
    assert r.status_code == 409 and r.json()["code"] == "not_complete"
    group["0"][0, 0, 0] = 0

    r = client.post(f"{BASE}/painting/accept", json={**accept, "proposal_digest": "0" * 64})
    assert r.status_code == 409 and r.json()["code"] == "revision_conflict"

    done = client.post(f"{BASE}/painting/accept", json=accept).json()
    after = labels(service, PAINTING)
    assert done["changed_voxels"] == 24 and done["kept_human_voxels"] == 1
    assert after[4, 10, 10] == 3 and after[4, 9, 9] == 2 and after[4, 0, 0] == 0
    assert done["source"]["proposal_digest"] == record["digest"]

    undone = client.post(f"{BASE}/painting/undo", json={**TARGET, "base_revision": done["revision"]}).json()
    assert undone["undone"]["kind"] == "accepted_proposal"
    restored = labels(service, PAINTING)
    assert restored[4, 9, 9] == 0 and restored[4, 10, 10] == 3


class FakeNNInteractive:
    """The nnInteractive server's HTTP routes used here; it publishes into the same copick project."""

    def __init__(self, service, shape=SHAPE):
        self.service, self.shape = service, list(shape)
        self.buffer = np.zeros(shape, np.uint8)
        self.fail_publish_midway = False
        self.requests = []

    def _seg(self, name, user_id, session_id):
        segs = self.service.get_segmentations(RUN, name, user_id, session_id, VOXEL_SIZE, seg_types=("multilabel",))
        return segs[0] if segs else None

    def _revision(self, name, user_id, session_id):
        self.service.clear_stores()
        seg = self._seg(name, user_id, session_id)
        return None if seg is None else str(np.asarray(zarr.open_group(seg.zarr())["0"][:]).sum())

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path, body = request.url.path, json.loads(request.content) if request.content else {}
        self.requests.append((request.method, path, body))
        if path == "/health":
            return httpx.Response(200, json={"status": "ok"})
        if path == "/sessions":
            return httpx.Response(200, json={"session_id": "s1", "image_shape": self.shape, "supports_undo": True})
        if path == "/sessions/s1/copick/scribbles":
            painted = labels(self.service, body["segmentation"])
            (z0, z1), (y0, y1), (x0, x1) = body["region"]
            self.buffer[z0:z1, y0:y1, x0:x1] = painted[z0:z1, y0:y1, x0:x1] == body["label"]
            return httpx.Response(200, headers={"X-Region": json.dumps(body["region"])})
        if path == "/sessions/s1/point":
            z, y, x = map(int, body["coordinates"])
            self.buffer[z, y, x] = int(body["include"])
            return httpx.Response(200, headers={"X-Region": json.dumps([[z, z + 1], [y, y + 1], [x, x + 1]])})
        if path == "/sessions/s1/copick/revision":
            q = request.url.params
            return httpx.Response(200, json={"revision": self._revision(q["name"], q["user_id"], q["seg_session_id"])})
        if path == "/sessions/s1/copick/publish":
            ref = body["segmentation"]
            if self._revision(**ref) != body["expected_revision"]:
                return httpx.Response(409, json={"detail": "stale"})
            out = np.where(self.buffer > 0, body["label"], 0).astype(np.uint8)
            if self.fail_publish_midway:
                out[: SHAPE[0] // 2] = 0  # half the chunks written, then the process dies
            seg = self.service.get_run(RUN).new_segmentation(
                VOXEL_SIZE, ref["name"], ref["session_id"], is_multilabel=True, user_id=ref["user_id"], exist_ok=True
            )
            seg.from_numpy(out, levels=1, dtype=np.uint8)
            if self.fail_publish_midway:
                return httpx.Response(500, json={"detail": "worker died"})
            return httpx.Response(200, json={"revision": self._revision(**ref), "written_voxels": int((out > 0).sum())})
        if request.method == "DELETE":
            return httpx.Response(204)
        raise AssertionError(path)


@contextmanager
def nn_client(service, fake):
    with app_client(service, nninteractive_url="http://nninteractive.test") as (app, c):
        app.state.nninteractive._client_factory = lambda: httpx.Client(transport=httpx.MockTransport(fake))
        registry = ProjectRegistry()
        registry.local_config_path = lambda pid: "/projects/demo/copick.json"  # nnInteractive opens the same file
        app.dependency_overrides[get_registry] = lambda: registry
        yield c


def test_nninteractive_prompt_from_painting_is_published_as_an_acceptable_proposal(service):
    fake = FakeNNInteractive(service)
    with nn_client(service, fake) as c:
        assert c.get(f"{BASE}/backends").json()["nninteractive"]["available"] is True
        painted = c.post(f"{BASE}/painting/strokes", json={**TARGET, "strokes": [stroke(2, [[6, 6, 4]])]}).json()
        session = c.post(f"{BASE}/nninteractive/sessions", json=TARGET).json()
        assert session == {"session_id": "s1", "shape": [32, 32, 32], "supports_undo": True}
        prompt = {**TARGET, "proposal": PROPOSAL, "proposal_label": 1, "label": 2, "box": [[0, 16], [0, 16], [0, 8]]}
        r = c.post(f"{BASE}/nninteractive/sessions/s1/prompt", json=prompt)
        result = r.json()
        assert r.status_code == 200, result
        assert result["changed_region"] == [[0, 16], [0, 16], [0, 8]]  # x, y, z order
        assert fake.requests[-4][2]["region"] == [[0, 8], [0, 16], [0, 16]]  # z, y, x for the server
        assert result["proposal"]["producer"] == "nninteractive" and result["proposal"]["prompt"]["label"] == 2
        assert labels(service, PAINTING)[4, 6, 6] == 2  # the painting itself is never written by the model

        point = c.post(f"{BASE}/nninteractive/sessions/s1/prompt", json={**prompt, "label": None, "point": [20, 20, 4]})
        digest = point.json()["proposal"]["digest"]
        accepted = c.post(
            f"{BASE}/painting/accept",
            json={
                **TARGET,
                "base_revision": painted["revision"],
                "proposal": PROPOSAL,
                "proposal_label": 1,
                "proposal_digest": digest,
                "label": 2,
            },
        ).json()
        assert accepted["changed_voxels"] == 1 and labels(service, PAINTING)[4, 20, 20] == 2


def test_interrupted_nninteractive_publication_is_never_acceptable(service):
    fake = FakeNNInteractive(service)
    with nn_client(service, fake) as c:
        c.post(f"{BASE}/painting/strokes", json={**TARGET, "strokes": [stroke(2, [[6, 6, 4]])]})
        c.post(f"{BASE}/nninteractive/sessions", json=TARGET)
        prompt = {**TARGET, "proposal": PROPOSAL, "proposal_label": 1, "point": [6, 6, 20]}
        first = c.post(f"{BASE}/nninteractive/sessions/s1/prompt", json=prompt).json()
        fake.fail_publish_midway = True
        r = c.post(f"{BASE}/nninteractive/sessions/s1/prompt", json={**prompt, "point": [7, 7, 4]})
        assert r.status_code == 502
        # Rewriting the segmentation dropped the earlier record; the partial labels have none of their own.
        inspect = c.get(f"{BASE}/painting/proposal", params=PROPOSAL_QUERY)
        assert inspect.status_code == 409 and inspect.json()["code"] == "not_complete"
        r = c.post(
            f"{BASE}/painting/accept",
            json={
                **TARGET,
                "proposal": PROPOSAL,
                "proposal_label": 1,
                "proposal_digest": first["proposal"]["digest"],
                "label": 2,
            },
        )
        assert r.status_code == 409 and r.json()["code"] == "not_complete"


def test_nninteractive_session_on_another_grid_is_refused(service):
    fake = FakeNNInteractive(service, shape=(16, 16, 16))
    with nn_client(service, fake) as c:
        r = c.post(f"{BASE}/nninteractive/sessions", json=TARGET)
        assert r.status_code == 409 and r.json()["code"] == "geometry_mismatch"
        assert fake.requests[-1][0] == "DELETE"
        r = c.post(
            f"{BASE}/nninteractive/sessions/s1/prompt",
            json={**TARGET, "proposal": PROPOSAL, "proposal_label": 1, "point": [1, 1, 1]},
        )
        assert r.status_code == 404 and r.json()["code"] == "session_lost"

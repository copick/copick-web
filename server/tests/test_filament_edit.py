"""Saving and deleting filament sets (the browser filament editor's server side)."""

from __future__ import annotations

import numpy as np
import pytest

from copick_web.app.services import compat

from .fixtures.make_demo_project import RUN

pytestmark = pytest.mark.skipif(not compat.HAS_FILAMENTS, reason="copick without filaments")

BASE = f"/api/runs/{RUN}/filaments/microtubule"


def _curve(cps, kind="catmull-rom", step=10.0, **extra):
    return {"kind": kind, "control_points": cps, "step": step, "alpha": 0.5 if kind == "catmull-rom" else None, **extra}


def test_detail_reports_curves_and_metadata(client):
    body = client.get(f"{BASE}/alice/1").json()
    assert body["filaments"] and all("curve" in f and "metadata" in f for f in body["filaments"])


def test_save_regenerates_points_from_curves(client, service):
    cps = [[0, 0, 0], [100, 50, 0], [200, 0, 0]]
    payload = {
        "filaments": [
            {"instance_id": 1, "curve": _curve(cps), "polarity_known": True, "score": 0.8, "metadata": {"k": 1}},
            {"instance_id": 4, "points": [[0, 300, 0], [0, 300, 100]]},
        ],
        "voxel_spacing": 10.0,
    }
    response = client.put(f"{BASE}/bob/7", json=payload)
    assert response.status_code == 200, response.text
    by_id = {f["instance_id"]: f for f in response.json()["filaments"]["filaments"]}
    assert set(by_id) == {1, 4}
    f1 = by_id[1]
    assert np.allclose(f1["points"][0], cps[0]) and np.allclose(f1["points"][-1], cps[-1])
    assert f1["curve"]["kind"] == "catmull-rom" and f1["polarity_known"] and f1["metadata"] == {"k": 1}
    assert by_id[4]["points"] == [[0, 300, 0], [0, 300, 100]] and by_id[4]["curve"] is None

    stored = service.get_filament_set(RUN, "microtubule", "bob", "7")
    assert sorted(int(f.instance_id) for f in stored.filaments) == [1, 4]
    assert next(f for f in stored.filaments if f.instance_id == 1).curve_is_current()
    # listed like any other set
    assert any(s["user_id"] == "bob" for s in client.get(f"/api/runs/{RUN}/filaments").json())


def test_save_replaces_the_set_and_writes_sampled_picks(client, service):
    cps = [[0, 0, 0], [400, 0, 0]]
    first = client.put(f"{BASE}/bob/7", json={"filaments": [{"instance_id": 2, "curve": _curve(cps)}]})
    assert first.status_code == 200
    response = client.put(
        f"{BASE}/bob/7",
        json={"filaments": [{"instance_id": 3, "curve": _curve(cps, kind="linear")}], "pick_spacing": 100.0},
    )
    assert response.status_code == 200, response.text
    assert [f["instance_id"] for f in response.json()["filaments"]["filaments"]] == [3]  # replaced, not merged
    assert response.json()["n_picks"] == 5  # 0, 100, ..., 400 Å
    picks = client.get(f"/api/runs/{RUN}/picks/microtubule/bob/7").json()
    assert len(picks["points"]) == 5 and {p["instance_id"] for p in picks["points"]} == {3}


def test_bspline_curves_are_accepted(client):
    t = np.linspace(0, 1, 6)
    cps = np.stack([t * 300, 40 * np.sin(3 * t), np.zeros_like(t)], 1).tolist()
    knots = [0, 0, 0, 0, 1 / 3, 2 / 3, 1, 1, 1, 1]
    curve = _curve(cps, kind="bspline", degree=3, knots=knots)
    response = client.put(f"{BASE}/bob/8", json={"filaments": [{"instance_id": 1, "curve": curve}]})
    assert response.status_code == 200, response.text
    assert response.json()["filaments"]["filaments"][0]["curve"]["kind"] == "bspline"


@pytest.mark.parametrize(
    "path, payload, status",
    [
        (f"{BASE}/bob/0", {"filaments": []}, 403),
        (f"{BASE}/bad user/1", {"filaments": []}, 422),
        (f"/api/runs/{RUN}/filaments/nope/bob/1", {"filaments": []}, 422),
        (f"{BASE}/bob/1", {"filaments": [{"instance_id": 1, "points": [[0, 0, 0]]}]}, 422),
        (f"{BASE}/bob/1", {"filaments": [{"instance_id": 1, "curve": _curve([[0, 0, 0]])}]}, 422),
        (
            f"{BASE}/bob/1",
            {"filaments": [{"instance_id": 1, "points": [[0, 0, 0], [1, 0, 0]]}] * 2},
            422,
        ),
        (f"{BASE}/bob/1", {"filaments": [], "pick_spacing": -5}, 422),
    ],
)
def test_invalid_saves_are_refused(client, path, payload, status):
    response = client.put(path, json=payload)
    assert response.status_code == status, response.text


def test_delete(client):
    client.put(f"{BASE}/bob/9", json={"filaments": [{"instance_id": 1, "points": [[0, 0, 0], [9, 0, 0]]}]})
    assert client.delete(f"{BASE}/bob/9").status_code == 200
    assert client.get(f"{BASE}/bob/9").status_code == 404
    assert client.delete(f"{BASE}/bob/9").status_code == 404
    assert client.delete(f"{BASE}/alice/0").status_code == 403


def test_old_copick_cannot_save(client, old_copick):
    assert client.put(f"{BASE}/bob/1", json={"filaments": []}).status_code == 501

"""Reloading the project: runs, tomograms and annotations written by other tools show up without a restart."""

from __future__ import annotations

import copick
import numpy as np

from copick_web.app.services.thumbnails import Thumbnail

from .fixtures.make_demo_project import RUN, VOXEL_SIZE


def _picks(client, run=RUN):
    return {(p["object_name"], p["user_id"], p["session_id"]) for p in client.get(f"/api/runs/{run}/picks").json()}


def test_reload_shows_annotations_and_runs_added_by_other_tools(client, demo_config):
    # as the app does: list the runs (copick caches the runs from here on), then a run's annotations
    runs_before = {r["name"] for r in client.get("/api/runs").json()}
    assert ("ribosome", "bob", "7") not in _picks(client)

    other = copick.from_file(str(demo_config))  # another tool writing to the project
    picks = other.get_run(RUN).new_picks(object_name="ribosome", session_id="7", user_id="bob")
    picks.from_numpy(np.array([[100.0, 100.0, 100.0]]))
    run = other.new_run("TS_002")
    run.new_voxel_spacing(VOXEL_SIZE).new_tomogram("wbp").from_numpy(np.zeros((8, 8, 8), dtype=np.float32))

    # copick keeps what it has listed, so the server does not see them yet
    assert ("ribosome", "bob", "7") not in _picks(client)
    assert {r["name"] for r in client.get("/api/runs").json()} == runs_before

    response = client.post("/api/reload")
    assert response.status_code == 200, response.text
    assert response.json() == {"runs": len(runs_before) + 1}
    assert ("ribosome", "bob", "7") in _picks(client)
    assert {r["name"] for r in client.get("/api/runs").json()} == runs_before | {"TS_002"}
    assert client.get("/api/runs/TS_002").status_code == 200


def test_reload_clears_derived_caches(client, service):
    service.thumbnails.put((RUN, None, None, 256), Thumbnail(b"old", "wbp", VOXEL_SIZE))
    service._measurements.put(("surface", "x"), {"old": True})
    assert client.post("/api/reload").status_code == 200
    assert len(service.thumbnails) == 0 and len(service._measurements) == 0


def test_reload_keeps_the_project_if_the_config_is_broken(client, service, demo_config):
    root = service.root
    good = demo_config.read_text()
    demo_config.write_text("{ not json")
    try:
        response = client.post("/api/reload")
        assert response.status_code == 500
        assert "Could not reload the project" in response.json()["detail"]
        assert service.root is root
        assert client.get(f"/api/runs/{RUN}").status_code == 200
    finally:
        demo_config.write_text(good)
    assert client.post("/api/reload").status_code == 200
    assert service.root is not root

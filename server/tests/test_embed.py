"""Embedding: ``create_app`` mounted into a host application, and the read-only mode."""

from __future__ import annotations

from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from copick_web.app import main
from copick_web.app.dependencies import READ_ONLY_DETAIL

from .fixtures.make_demo_project import PICKS, RUN, VOXEL_SIZE, build

MOUNT = "/copick-web"
INDEX = "<!doctype html><title>copick-web test client</title>"

#: Values of the path parameters of the routes that change project data, on the demo project.
PATH_VALUES = {"run_name": RUN, "object_name": "ribosome", "user_id": "alice", "session_id": "1", "name": "ribosome"}


@pytest.fixture
def built_client(tmp_path, monkeypatch):
    """A stand-in for the built client, so apps created from here on serve it."""
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text(INDEX)
    monkeypatch.setattr(main, "static_dir", static)
    return static


def mounted(copick_app: FastAPI) -> FastAPI:
    """A host application that mounts ``copick_app`` and runs its lifespan from its own, as Starlette does not."""

    @asynccontextmanager
    async def lifespan(host: FastAPI):
        async with copick_app.router.lifespan_context(copick_app):
            yield

    host = FastAPI(lifespan=lifespan)
    host.mount(MOUNT, copick_app)
    return host


@pytest.fixture
def embedded(demo_config, built_client):
    """``(client of the host, project id, copick app)``: a read-only copick-web mounted at MOUNT, the demo project
    registered once the app has started."""
    copick_app = main.create_app(allow_empty=True, read_only=True)
    with TestClient(mounted(copick_app), raise_server_exceptions=False) as client:
        pid = copick_app.state.registry.register_local(str(demo_config))
        yield client, pid, copick_app


def test_projects_runs_and_stores_through_the_mount(embedded):
    client, pid, _ = embedded
    projects = client.get(f"{MOUNT}/api/projects")
    assert projects.status_code == 200
    assert [p["id"] for p in projects.json()] == [pid]

    runs = client.get(f"{MOUNT}/api/projects/{pid}/runs")
    assert runs.status_code == 200
    assert RUN in {r["name"] for r in runs.json()}

    tomo = client.get(f"{MOUNT}/api/projects/{pid}/runs/{RUN}/voxel_spacings/{VOXEL_SIZE}/tomograms/wbp")
    assert tomo.status_code == 200
    store = f"{MOUNT}/{tomo.json()['zarr_url']}/0"  # relative to the app root; level 0's array metadata, v2 or v3
    assert 200 in (client.get(f"{store}/.zarray").status_code, client.get(f"{store}/zarr.json").status_code)


def test_client_routes_serve_the_index_through_the_mount(embedded):
    client, pid, _ = embedded
    for path in (f"{MOUNT}/projects/{pid}/", f"{MOUNT}/projects/{pid}/runs/{RUN}", f"{MOUNT}/"):
        response = client.get(path)
        assert response.status_code == 200, path
        assert response.text == INDEX


def test_register_before_start_is_idempotent(demo_config):
    copick_app = main.create_app(allow_empty=True)
    pid = copick_app.state.registry.register_local(str(demo_config))
    assert copick_app.state.registry.register_local(str(demo_config)) == pid
    with TestClient(mounted(copick_app)) as client:
        assert [p["id"] for p in client.get(f"{MOUNT}/api/projects").json()] == [pid]


def test_a_config_that_takes_an_id_over_is_the_one_served(tmp_path):
    """Two configs with the same parent directory and file name share an id: the later one is served, not the
    project already opened from the earlier one."""
    first, second = build(tmp_path / "a" / "project"), build(tmp_path / "b" / "project")
    registry = main.create_app(allow_empty=True).state.registry
    pid = registry.register_local(str(first))
    assert registry.get_service(pid).config_file.path == first.resolve()
    assert registry.register_local(str(second)) == pid
    assert registry.get_service(pid).config_file.path == second.resolve()


def test_routes_work_without_the_lifespan(demo_config):
    """A host that forgets to run the lifespan still serves the projects it registered."""
    copick_app = main.create_app(allow_empty=True)
    pid = copick_app.state.registry.register_local(str(demo_config))
    client = TestClient(mounted(copick_app))  # not entered: no lifespan
    assert client.get(f"{MOUNT}/api/projects/{pid}/runs").status_code == 200


def test_configs_are_registered_when_the_app_starts(demo_config):
    copick_app = main.create_app(configs=[demo_config])
    assert copick_app.state.registry.list_projects() == []
    with TestClient(copick_app) as client:
        assert len(client.get("/api/projects").json()) == 1


def test_apps_in_one_process_are_independent(demo_config):
    first, second = main.create_app(allow_empty=True), main.create_app(allow_empty=True, read_only=True)
    first.state.registry.register_local(str(demo_config))
    assert TestClient(first).get("/api/projects").json() != []
    assert TestClient(second).get("/api/projects").json() == []
    assert first.state.read_only is False and second.state.read_only is True


def test_starting_without_a_project_source_needs_allow_empty():
    with pytest.raises(RuntimeError, match="No project source configured"):
        with TestClient(main.create_app()):
            pass
    with TestClient(main.create_app(allow_empty=True)) as client:
        assert client.get("/api/projects").json() == []


def test_the_client_learns_it_is_read_only(embedded):
    client, pid, _ = embedded
    assert client.get(f"{MOUNT}/api/projects/{pid}/config").json()["read_only"] is True
    assert client.get(f"{MOUNT}/api/projects/{pid}/object-types").json()["editable"] is False


def _mutating_routes(app: FastAPI) -> list[tuple[str, str]]:
    """``(method, path)`` of every route that is not a read, from the app's OpenAPI schema."""
    return sorted(
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
        if method not in ("get", "head", "options")
    )


def test_every_mutating_route_is_refused_when_read_only(embedded):
    """Every route that is not a read, found from the app itself, so a new one cannot slip past the guard."""
    client, pid, copick_app = embedded
    routes = _mutating_routes(copick_app)
    assert (
        "PUT",
        "/api/projects/{project_id}/runs/{run_name}/filaments/{object_name}/{user_id}/{session_id}",
    ) in routes
    assert len(routes) >= 9  # picks POST/PUT/DELETE, filaments PUT/DELETE, object types POST/PUT/DELETE, reload

    for method, path in routes:
        url = MOUNT + path.format(project_id=pid, **PATH_VALUES)
        response = client.request(method, url, json={}, params={"version": "0"})
        if path.endswith("/reload"):
            assert response.status_code == 200, (method, path, response.text)  # re-reads, writes nothing
        else:
            assert response.status_code == 403, (method, path, response.text)
            assert response.json()["detail"] == READ_ONLY_DETAIL

    # nothing was written
    picks = client.get(f"{MOUNT}/api/projects/{pid}/runs/{RUN}/picks/ribosome/alice/1")
    assert picks.status_code == 200 and len(picks.json()["points"]) == len(PICKS)
    names = {o["name"] for o in client.get(f"{MOUNT}/api/projects/{pid}/object-types").json()["objects"]}
    assert "ribosome" in names


def test_changes_are_allowed_through_the_mount_unless_read_only(demo_config, built_client):
    copick_app = main.create_app(allow_empty=True)
    with TestClient(mounted(copick_app)) as client:
        pid = copick_app.state.registry.register_local(str(demo_config))
        assert client.get(f"{MOUNT}/api/projects/{pid}/config").json()["read_only"] is False
        url = f"{MOUNT}/api/projects/{pid}/runs/{RUN}/picks/ribosome/alice/1"
        response = client.put(url, json={"points": [{"x": 1.0, "y": 2.0, "z": 3.0}]})
        assert response.status_code == 200, response.text
        assert len(client.get(url).json()["points"]) == 1


def test_cli_read_only(monkeypatch, demo_config):
    from click.testing import CliRunner

    from copick_web import cli

    served = {}
    monkeypatch.setattr(cli.uvicorn, "run", lambda app, host, port: served.update(app=app))
    monkeypatch.setenv("BASE_PATH", "")  # restored after the test (the CLI sets it for the app)
    result = CliRunner().invoke(cli.main, [str(demo_config), "--no-browser", "--read-only"])
    assert result.exit_code == 0, result.output
    assert served["app"].state.read_only is True

    result = CliRunner().invoke(cli.main, [str(demo_config), "--no-browser"], env={"READ_ONLY": "true"})
    assert result.exit_code == 0, result.output
    assert served["app"].state.read_only is True

    result = CliRunner().invoke(cli.main, [str(demo_config), "--no-browser"], env={"READ_ONLY": None})
    assert result.exit_code == 0, result.output
    assert served["app"].state.read_only is False

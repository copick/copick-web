"""Serving under a URL prefix (e.g. Open OnDemand's /node/<host>/<port> or /rnode/<host>/<port>), set at runtime."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from copick_web.app.main import app as production_app

from .conftest import serving
from .fixtures.make_demo_project import RUN, VOXEL_SIZE

PREFIX = "/node/gpu-17/8123"


@pytest.fixture
def prefixed(service, monkeypatch):
    """The production app as started with ``--base-path PREFIX``."""
    monkeypatch.setattr(production_app, "root_path", PREFIX)
    with serving(production_app, service):
        yield TestClient(production_app, raise_server_exceptions=False)


@pytest.mark.parametrize("prefix", [PREFIX, ""], ids=["proxy forwards the prefix", "proxy strips the prefix"])
def test_routes_with_or_without_the_prefix(prefixed, prefix):
    assert prefixed.get(f"{prefix}/api/projects/demo/runs").status_code == 200
    tomo = prefixed.get(f"{prefix}/api/projects/demo/runs/{RUN}/voxel_spacings/{VOXEL_SIZE}/tomograms/wbp").json()
    store = f"{prefix}/{tomo['zarr_url']}/0"  # level 0's array metadata, Zarr v2 or v3
    assert 200 in (prefixed.get(f"{store}/.zarray").status_code, prefixed.get(f"{store}/zarr.json").status_code)


def test_store_urls_are_relative_to_the_app_root(client):
    """No prefix and no leading slash: the client resolves them against the page it was loaded from."""
    tomo = client.get(f"/api/projects/demo/runs/{RUN}/voxel_spacings/{VOXEL_SIZE}/tomograms/wbp").json()
    assert tomo["zarr_url"] == f"zarr/demo/tomo/{RUN}/{VOXEL_SIZE}/wbp"
    for seg in client.get(f"/api/projects/demo/runs/{RUN}/segmentations").json():
        assert seg["zarr_url"].startswith("zarr/demo/segmentation/")


def test_cli_normalises_the_base_path(monkeypatch, demo_config):
    from click.testing import CliRunner

    from copick_web import cli

    seen = {}
    monkeypatch.setattr(cli.uvicorn, "run", lambda app, host, port: seen.update(host=host, port=port))
    monkeypatch.setenv("BASE_PATH", "")  # restored after the test (the CLI sets it for the app)
    monkeypatch.setenv("COPICK_CONFIG_PATH", "")
    result = CliRunner().invoke(cli.main, [str(demo_config), "--no-browser", "--base-path", "node/gpu-17/8123/"])
    assert result.exit_code == 0, result.output
    assert "http://127.0.0.1:8000/node/gpu-17/8123/" in result.output
    assert os.environ["BASE_PATH"] == "/node/gpu-17/8123"


def test_the_app_root_without_its_slash_redirects_relatively(prefixed):
    """Not to an absolute URL naming the Host the backend saw, which may not be the proxy's."""
    response = prefixed.get(PREFIX, params={"a": "1"}, headers={"Host": "gpu-17:8123"}, follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == "8123/?a=1"

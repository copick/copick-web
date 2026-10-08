"""Shared fixtures: a tiny demo project, a service bound to it, and a test client of the production app."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from copick_web.app.main import app as production_app
from copick_web.app.services.copick_service import CopickService, get_copick_service

from .fixtures.make_demo_project import build


@pytest.fixture
def demo_config(tmp_path: Path) -> Path:
    """Path to the config of a freshly built demo project (written under ``tmp_path``)."""
    return build(tmp_path / "project")


@pytest.fixture
def service(demo_config: Path) -> CopickService:
    return CopickService(str(demo_config))


@pytest.fixture
def client(service: CopickService):
    """A client of the production app, without its lifespan, bound to the demo project."""
    production_app.dependency_overrides[get_copick_service] = lambda: service
    try:
        yield TestClient(production_app, raise_server_exceptions=False)
    finally:
        production_app.dependency_overrides.pop(get_copick_service, None)


@pytest.fixture
def old_copick(monkeypatch):
    """Simulate a copick that predates filaments, typed segmentations and pick identity."""
    from copick import models

    monkeypatch.delattr(models.CopickRun, "get_filaments")
    monkeypatch.delattr(models.CopickSegmentation, "segmentation_type")
    monkeypatch.delattr(models.CopickPicks, "full_positions")
    monkeypatch.delattr(models.PickableObject, "filament")

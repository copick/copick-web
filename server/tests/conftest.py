"""Shared fixtures: a tiny demo project, a service bound to it, and a test client of the production app."""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from copick_web.app.dependencies import get_copick_service, get_project_meta, get_registry
from copick_web.app.main import app as production_app
from copick_web.app.models import ProjectSummaryResponse
from copick_web.app.services.copick_service import CopickService
from copick_web.app.services.project_registry import ProjectRegistry

from .fixtures.make_demo_project import build

#: Project id the test apps serve the demo project under (``/api/projects/demo/...``).
PROJECT = "demo"


@contextmanager
def serving(app, service: CopickService):
    """Route the app's project-scoped requests to ``service``, as local project ``PROJECT``."""
    registry = ProjectRegistry()
    overrides = {
        get_copick_service: lambda: service,
        get_project_meta: lambda: ProjectSummaryResponse(id=PROJECT, source="local"),
        get_registry: lambda: registry,
    }
    app.dependency_overrides.update(overrides)
    try:
        yield
    finally:
        for dependency in overrides:
            app.dependency_overrides.pop(dependency, None)


@pytest.fixture
def demo_config(tmp_path: Path) -> Path:
    """Path to the config of a freshly built demo project (written under ``tmp_path``)."""
    return build(tmp_path / "project")


@pytest.fixture
def service(demo_config: Path) -> CopickService:
    return CopickService.from_config_path(str(demo_config))


@pytest.fixture
def client(service: CopickService):
    """A client of the production app, without its lifespan, bound to the demo project."""
    with serving(production_app, service):
        yield TestClient(production_app, raise_server_exceptions=False)


@pytest.fixture
def old_copick(monkeypatch):
    """Simulate a copick that predates filaments, typed segmentations and pick identity."""
    from copick import models

    monkeypatch.delattr(models.CopickRun, "get_filaments")
    monkeypatch.delattr(models.CopickSegmentation, "segmentation_type")
    monkeypatch.delattr(models.CopickPicks, "full_positions")
    monkeypatch.delattr(models.PickableObject, "filament")

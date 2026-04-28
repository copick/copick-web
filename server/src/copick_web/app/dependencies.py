"""FastAPI dependency injection for project-scoped routes."""

from fastapi import HTTPException, Path

from .models import ProjectSummaryResponse
from .services.copick_service import CopickService
from .services.project_registry import ProjectRegistry, get_project_registry
from .services.registry_client import RegistryError


def get_registry() -> ProjectRegistry:
    """Dependency: the application's ``ProjectRegistry``."""
    return get_project_registry()


def get_copick_service(project_id: str = Path(...)) -> CopickService:
    """Dependency: resolve the ``CopickService`` for the path's ``project_id``."""
    registry = get_project_registry()
    try:
        return registry.get_service(project_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    except RegistryError as e:
        raise HTTPException(status_code=502, detail=str(e))


def get_project_meta(project_id: str = Path(...)) -> ProjectSummaryResponse:
    """Dependency: resolve the ``ProjectSummaryResponse`` for the path's ``project_id``.

    Used by routes that need to branch on ``source`` (local vs. registry) — e.g.
    zarr URL construction, where registry projects skip the server-side proxy
    and point the browser at ``data_url`` directly.
    """
    registry = get_project_registry()
    try:
        return registry.get_metadata(project_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")

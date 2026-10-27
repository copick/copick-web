"""FastAPI dependency injection for project-scoped routes.

Each app built by ``create_app`` keeps its own ``ProjectRegistry`` and read-only flag on ``app.state``, so several
apps in one process (e.g. mounted into a host application) stay independent. The module-level registry is only a
fallback for an app assembled from the routers without ``create_app``.
"""

from fastapi import Depends, HTTPException, Path, Request

from .models import ProjectSummaryResponse
from .services.copick_service import CopickService
from .services.project_registry import ProjectRegistry, get_project_registry
from .services.registry_client import RegistryError

#: Answer of every route that would change project data when the app is read-only.
READ_ONLY_DETAIL = "This copick-web server is read-only: projects can be viewed here but not changed."


def get_registry(request: Request) -> ProjectRegistry:
    """Dependency: the ``ProjectRegistry`` of the app serving the request."""
    registry = getattr(request.app.state, "registry", None)
    return registry if registry is not None else get_project_registry()


def is_read_only(request: Request) -> bool:
    """Whether the app serving the request refuses changes to project data."""
    return bool(getattr(request.app.state, "read_only", False))


def require_writable(request: Request) -> None:
    """Dependency of every route that changes project data: 403 when the app is read-only.

    Declared in the route decorator (``dependencies=WRITES``), so it runs before the route's own parameters are
    resolved: a read-only app refuses the request whatever its body or project.
    """
    if is_read_only(request):
        raise HTTPException(status_code=403, detail=READ_ONLY_DETAIL)


#: ``dependencies=`` of a route that changes project data.
WRITES = [Depends(require_writable)]


def get_copick_service(project_id: str = Path(...), registry: ProjectRegistry = Depends(get_registry)) -> CopickService:
    """Dependency: resolve the ``CopickService`` for the path's ``project_id``."""
    try:
        return registry.get_service(project_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found") from None
    except RegistryError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


def get_project_meta(
    project_id: str = Path(...), registry: ProjectRegistry = Depends(get_registry)
) -> ProjectSummaryResponse:
    """Dependency: resolve the ``ProjectSummaryResponse`` for the path's ``project_id``.

    Used by routes that need to branch on ``source`` (local vs. registry) — e.g.
    zarr URL construction, where registry projects skip the server-side proxy
    and point the browser at ``data_url`` directly.
    """
    try:
        return registry.get_metadata(project_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found") from None

"""Project listing and lifecycle routes."""

from fastapi import APIRouter, Depends, HTTPException

from ..dependencies import get_registry
from ..models import ProjectSummaryResponse
from ..services.project_registry import ProjectRegistry

router = APIRouter(prefix="/api", tags=["projects"])


@router.get("/projects", response_model=list[ProjectSummaryResponse])
def list_projects(registry: ProjectRegistry = Depends(get_registry)) -> list[ProjectSummaryResponse]:
    """List all known projects (registry + local), with locals winning collisions."""
    return registry.list_projects()


@router.post("/projects/{project_id}/reload", status_code=204)
def reload_project(project_id: str, registry: ProjectRegistry = Depends(get_registry)) -> None:
    """Drop the cached ``CopickService`` for a project so the next request rebuilds it.

    Useful when an underlying SSH connection has died and
    the cached service is hanging on a dead socket.
    """
    try:
        registry.get_metadata(project_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    registry.evict_service(project_id)

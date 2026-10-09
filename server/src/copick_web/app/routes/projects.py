"""Project listing routes."""

from fastapi import APIRouter, Depends

from ..dependencies import get_registry
from ..models import ProjectSummaryResponse
from ..services.project_registry import ProjectRegistry

router = APIRouter(prefix="/api", tags=["projects"])


@router.get("/projects", response_model=list[ProjectSummaryResponse])
def list_projects(registry: ProjectRegistry = Depends(get_registry)) -> list[ProjectSummaryResponse]:
    """List all known projects (registry + local), with locals winning collisions."""
    return registry.list_projects()

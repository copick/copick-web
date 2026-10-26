"""Mesh routes.

Meshes are copick's run-level triangle meshes, stored as GLB files with vertices in Angstrom (x, y, z). The viewer
draws them in its 3D pane; they are read-only here.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response

from ..dependencies import get_copick_service
from ..models import MeshSummaryResponse
from ..services.copick_service import CopickService

router = APIRouter(prefix="/api/projects/{project_id}", tags=["meshes"])
ServiceDependency = Annotated[CopickService, Depends(get_copick_service)]

_GREY = (100, 100, 100, 255)


def _color(service: CopickService, object_name: str) -> tuple[int, int, int, int]:
    obj = service.get_pickable_object(object_name)
    return tuple(obj.color) if obj else _GREY


@router.get("/runs/{run_name}/meshes", response_model=list[MeshSummaryResponse])
def list_meshes(run_name: str, service: ServiceDependency) -> list[MeshSummaryResponse]:
    """List the meshes of a run."""
    if not service.get_run(run_name):
        raise HTTPException(status_code=404, detail=f"Run '{run_name}' not found")
    return [
        MeshSummaryResponse(
            object_name=mesh.pickable_object_name,
            user_id=mesh.user_id,
            session_id=mesh.session_id,
            color=_color(service, mesh.pickable_object_name),
        )
        for mesh in service.get_meshes(run_name)
    ]


@router.get("/runs/{run_name}/meshes/{object_name}/{user_id}/{session_id}.glb")
def get_mesh(
    run_name: str,
    object_name: str,
    user_id: str,
    session_id: str,
    service: ServiceDependency,
) -> Response:
    """The GLB file of one mesh, as stored. Not cached by the browser, so a reload shows a rewritten mesh."""
    data = service.read_mesh(run_name, object_name, user_id, session_id)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"Mesh not found for object '{object_name}', user '{user_id}', session '{session_id}'",
        )
    return Response(content=data, media_type="model/gltf-binary", headers={"Cache-Control": "no-cache"})

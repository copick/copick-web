"""Painting, undo and proposal acceptance on any copick reconstruction, plus the optional backends of a project.

Classes are the project's objects (labels 1-255); 0 is unknown and erases. A CellCanvas binding paints the same way
through its own routes, restricted to its classes.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..dependencies import WRITES, get_copick_service, get_registry
from ..services.annotations import MAX_STROKE_POINTS, AnnotationError, Painting, SegmentationRef, project_classes
from ..services.copick_service import CopickService
from ..services.project_registry import ProjectRegistry

router = APIRouter(prefix="/api/projects/{project_id}", tags=["annotations"])


class Segmentation(BaseModel):
    name: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.\-]+$")
    user_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.\-]+$")
    session_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.\-]+$")

    def ref(self) -> SegmentationRef:
        return SegmentationRef(self.name, self.user_id, self.session_id)


class Target(BaseModel):
    """A painted segmentation of one reconstruction."""

    run: str
    voxel_size: float
    tomo_type: str
    painting: Segmentation


class Stroke(BaseModel):
    label: int
    radius: float = 0
    plane: str
    points: list[list[int]] = Field(max_length=MAX_STROKE_POINTS)


class PaintRequest(Target):
    base_revision: Optional[str] = None
    stroke_id: Optional[str] = Field(default=None, max_length=64)
    strokes: list[Stroke] = Field(min_length=1, max_length=64)


class UndoRequest(Target):
    base_revision: Optional[str] = None


class AcceptRequest(Target):
    base_revision: Optional[str] = None
    proposal: Segmentation
    proposal_label: int
    proposal_digest: str
    label: int
    box: Optional[list[list[int]]] = Field(default=None, min_length=3, max_length=3)


def painting(target: Target, service: CopickService) -> Painting:
    return Painting(
        service, target.run, target.voxel_size, target.tomo_type, target.painting.ref(), project_classes(service)
    )


async def call(function, *args, **kwargs):
    try:
        return await run_in_threadpool(function, *args, **kwargs)
    except AnnotationError as error:
        return JSONResponse({"detail": str(error), "code": error.code}, status_code=error.status)


@router.get("/backends")
async def backends(project_id: str, request: Request, registry: ProjectRegistry = Depends(get_registry)):
    """Which optional backends this app offers for the project (controls are shown only for these)."""
    from .cellcanvas import get_bindings

    nninteractive = getattr(request.app.state, "nninteractive", None)
    local = registry.local_config_path(project_id) is not None
    return {
        "painting": True,
        "cellcanvas": bool(get_bindings(project_id, request, registry)),
        "nninteractive": (
            (await run_in_threadpool(nninteractive.available)) | {"needs_local_project": not local}
            if nninteractive
            else {"available": False}
        ),
    }


def query_target(run: str, voxel_size: float, tomo_type: str, name: str, user_id: str, session_id: str) -> Target:
    """A target named by query parameters, for reads."""
    return Target(
        run=run,
        voxel_size=voxel_size,
        tomo_type=tomo_type,
        painting=Segmentation(name=name, user_id=user_id, session_id=session_id),
    )


@router.get("/painting")
async def state(target: Target = Depends(query_target), service: CopickService = Depends(get_copick_service)):
    """Revision and undo availability of a painting, and the paintable classes."""
    p = painting(target, service)

    def run():
        return {**p.state(), "classes": project_classes(service)}

    return await call(run)


@router.post("/painting/strokes", dependencies=WRITES)
async def paint(body: PaintRequest, service: CopickService = Depends(get_copick_service)):
    return await call(
        painting(body, service).paint, body.base_revision, [s.model_dump() for s in body.strokes], body.stroke_id
    )


@router.post("/painting/undo", dependencies=WRITES)
async def undo(body: UndoRequest, service: CopickService = Depends(get_copick_service)):
    return await call(painting(body, service).undo, body.base_revision)


@router.get("/painting/proposal")
async def inspect_proposal(
    proposal_name: str,
    proposal_user_id: str,
    proposal_session_id: str,
    target: Target = Depends(query_target),
    service: CopickService = Depends(get_copick_service),
):
    """Completion record of a proposal; ``digest`` is what ``accept`` must name."""
    ref = Segmentation(name=proposal_name, user_id=proposal_user_id, session_id=proposal_session_id).ref()
    return await call(painting(target, service).proposal, ref)


@router.post("/painting/accept", dependencies=WRITES)
async def accept(body: AcceptRequest, service: CopickService = Depends(get_copick_service)):
    """Copy one label of a completed proposal into the painting's unknown voxels (one undoable gesture)."""
    return await call(
        painting(body, service).accept,
        body.base_revision,
        body.proposal.ref(),
        body.proposal_label,
        body.label,
        body.proposal_digest,
        body.box,
    )

"""Prompted segmentation with nnInteractive into a proposal segmentation (see ``services.nninteractive``).

Absent unless the app is configured with an nnInteractive server URL; ``GET .../backends`` tells the client.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field

from ..dependencies import WRITES, get_copick_service, get_registry
from ..services.copick_service import CopickService
from ..services.nninteractive import NNInteractive
from ..services.project_registry import ProjectRegistry
from .annotations import Segmentation, Target, call, painting

router = APIRouter(prefix="/api/projects/{project_id}/nninteractive", tags=["nninteractive"])


def get_nninteractive(request: Request) -> NNInteractive:
    backend = getattr(request.app.state, "nninteractive", None)
    if backend is None:
        raise HTTPException(status_code=404, detail="No nnInteractive server is configured")
    return backend


class PromptRequest(Target):
    proposal: Segmentation
    proposal_label: int = Field(ge=1, le=255)
    label: Optional[int] = None
    box: Optional[list[list[int]]] = Field(default=None, min_length=3, max_length=3)
    point: Optional[list[int]] = Field(default=None, min_length=3, max_length=3)
    include: bool = True


class UndoRequest(Target):
    proposal: Segmentation
    proposal_label: int = Field(ge=1, le=255)


@router.post("/sessions", dependencies=WRITES)
async def open_session(
    project_id: str,
    target: Target,
    service: CopickService = Depends(get_copick_service),
    registry: ProjectRegistry = Depends(get_registry),
    backend: NNInteractive = Depends(get_nninteractive),
):
    """Start a session on the target's reconstruction (resolution level 0)."""
    return await call(backend.open, project_id, registry.local_config_path(project_id), painting(target, service))


@router.post("/sessions/{session_id}/prompt", dependencies=WRITES)
async def prompt(
    project_id: str,
    session_id: str,
    body: PromptRequest,
    service: CopickService = Depends(get_copick_service),
    backend: NNInteractive = Depends(get_nninteractive),
):
    """A painted-label or point prompt; the current object is then published as a completed proposal."""
    return await call(
        backend.prompt,
        session_id,
        project_id,
        painting(body, service),
        body.proposal.ref(),
        body.proposal_label,
        label=body.label,
        box=body.box,
        point=body.point,
        include=body.include,
    )


@router.post("/sessions/{session_id}/undo", dependencies=WRITES)
async def undo(
    project_id: str,
    session_id: str,
    body: UndoRequest,
    service: CopickService = Depends(get_copick_service),
    backend: NNInteractive = Depends(get_nninteractive),
):
    return await call(
        backend.undo, session_id, project_id, painting(body, service), body.proposal.ref(), body.proposal_label
    )


@router.delete("/sessions/{session_id}", status_code=204, dependencies=WRITES)
async def close_session(project_id: str, session_id: str, backend: NNInteractive = Depends(get_nninteractive)):
    await call(backend.close, session_id, project_id)

"""CellCanvas learning routes: binding status, semantic painting, train/predict receipts and published refresh.

The browser names a server-side binding by ID; service URLs and stores come from the binding file
(``CELLCANVAS_BINDINGS`` or ``create_app(cellcanvas_bindings=...)``). Without one, the binding list is empty.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..dependencies import WRITES, get_copick_service, get_registry
from ..services.cellcanvas import MAX_STROKE_POINTS, Binding, CellCanvasError, open_session
from ..services.copick_service import CopickService
from ..services.project_registry import ProjectRegistry

router = APIRouter(prefix="/api/projects/{project_id}/cellcanvas", tags=["cellcanvas"])


def get_bindings(project_id: str, request: Request, registry: ProjectRegistry = Depends(get_registry)) -> list[Binding]:
    """Bindings of this project, matched by project ID or local config file."""
    bindings = getattr(request.app.state, "cellcanvas_bindings", None) or []
    config = registry.local_config_path(project_id)
    return [b for b in bindings if b.project_id == project_id or (config is not None and b.config == config)]


def get_client_factory(request: Request):
    return getattr(request.app.state, "cellcanvas_client_factory", None)


def _session(binding_id: str, bindings, service, client_factory):
    for binding in bindings:
        if binding.id == binding_id:
            return open_session(binding, service, client_factory)
    raise HTTPException(status_code=404, detail=f"CellCanvas binding '{binding_id}' not found")


async def _call(function, *args):
    try:
        return await run_in_threadpool(function, *args)
    except CellCanvasError as error:
        return JSONResponse({"detail": str(error), "code": error.code}, status_code=error.status)


class Stroke(BaseModel):
    label: int
    radius: float = 0
    plane: str
    points: list[list[int]] = Field(max_length=MAX_STROKE_POINTS)


class PaintRequest(BaseModel):
    base_revision: Optional[str] = None
    strokes: list[Stroke] = Field(min_length=1, max_length=64)


class OperationRequest(BaseModel):
    operation_id: str


@router.get("/bindings")
def list_bindings(
    run: Optional[str] = None,
    voxel_size: Optional[float] = None,
    tomo_type: Optional[str] = None,
    bindings: list[Binding] = Depends(get_bindings),
):
    """Bindings of the project, optionally for one opened reconstruction."""
    selected = [
        b.public()
        for b in bindings
        if (run is None or b.run == run)
        and (voxel_size is None or abs(b.voxel_size - voxel_size) < 1e-3)
        and (tomo_type is None or b.tomo_type == tomo_type)
    ]
    return {"bindings": selected}


@router.get("/bindings/{binding_id}")
async def binding_status(
    binding_id: str,
    bindings: list[Binding] = Depends(get_bindings),
    service: CopickService = Depends(get_copick_service),
    client_factory=Depends(get_client_factory),
):
    """Geometry check, core state, painting revision, pending receipt and published prediction."""
    session = _session(binding_id, bindings, service, client_factory)

    def status():
        check = session.check()
        return {
            "binding": session.binding.public(),
            "check": {k: check[k] for k in ("ok", "problems", "copick")},
            "core": check["core"],
            "painting": session.painting_state(),
            "operation": session.reconcile(),
        }

    return await _call(status)


@router.post("/bindings/{binding_id}/painting", dependencies=WRITES)
async def paint(
    binding_id: str,
    body: PaintRequest,
    bindings: list[Binding] = Depends(get_bindings),
    service: CopickService = Depends(get_copick_service),
    client_factory=Depends(get_client_factory),
):
    """Save brush strokes into the copick painting segmentation (optimistic revision check)."""
    session = _session(binding_id, bindings, service, client_factory)
    return await _call(session.paint, body.base_revision, [s.model_dump() for s in body.strokes])


@router.post("/bindings/{binding_id}/{kind}", dependencies=WRITES)
async def submit(
    binding_id: str,
    kind: str,
    body: OperationRequest,
    bindings: list[Binding] = Depends(get_bindings),
    service: CopickService = Depends(get_copick_service),
    client_factory=Depends(get_client_factory),
):
    """Submit train (after syncing painting) or predict under a client-chosen operation ID; retries are idempotent."""
    if kind not in ("train", "predict"):
        raise HTTPException(status_code=404, detail="Unknown operation")
    session = _session(binding_id, bindings, service, client_factory)
    return await _call(session.submit, kind, body.operation_id)


@router.get("/bindings/{binding_id}/operation")
async def operation(
    binding_id: str,
    bindings: list[Binding] = Depends(get_bindings),
    service: CopickService = Depends(get_copick_service),
    client_factory=Depends(get_client_factory),
):
    """Reconcile the pending receipt; a successful prediction is published before it is reported."""
    session = _session(binding_id, bindings, service, client_factory)
    return await _call(session.reconcile)

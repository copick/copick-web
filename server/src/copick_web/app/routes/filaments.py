"""Filaments routes.

Filaments are ordered centreline polylines in Angstrom (copick's run-level Filaments entity), optionally with the
editable curve they were regenerated from. Saving sends curves; copick regenerates the points (the browser editor's
preview uses a port of the same algorithm). On a copick without filaments the list is empty and the other routes
answer 501. Tool output (session "0") is read-only.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from ..dependencies import get_copick_service
from ..models import (
    FilamentCurveModel,
    FilamentResponse,
    FilamentsDetailResponse,
    FilamentsSummaryResponse,
    SaveFilamentsRequest,
    SaveFilamentsResponse,
)
from ..services import compat
from ..services.copick_service import CopickService
from ..validation import validate_copick_name

router = APIRouter(prefix="/api/projects/{project_id}", tags=["filaments"])

_GREY = (100, 100, 100, 255)


def _color(service: CopickService, object_name: str) -> tuple[int, int, int, int]:
    obj = service.get_pickable_object(object_name)
    return tuple(obj.color) if obj else _GREY


@router.get("/runs/{run_name}/filaments", response_model=list[FilamentsSummaryResponse])
def list_filaments(
    run_name: str, service: CopickService = Depends(get_copick_service)
) -> list[FilamentsSummaryResponse]:
    """List the filament sets of a run."""
    if not service.get_run(run_name):
        raise HTTPException(status_code=404, detail=f"Run '{run_name}' not found")
    result = []
    for fset in service.get_filaments(run_name):
        filaments = fset.filaments or []
        result.append(
            FilamentsSummaryResponse(
                object_name=fset.pickable_object_name,
                user_id=fset.user_id,
                session_id=fset.session_id,
                filament_count=len(filaments),
                color=_color(service, fset.pickable_object_name),
                instance_ids=[int(f.instance_id) for f in filaments],
            )
        )
    return result


@router.get(
    "/runs/{run_name}/filaments/{object_name}/{user_id}/{session_id}",
    response_model=FilamentsDetailResponse,
)
def get_filaments(
    run_name: str,
    object_name: str,
    user_id: str,
    session_id: str,
    service: CopickService = Depends(get_copick_service),
) -> FilamentsDetailResponse:
    """Get one filament set with every centreline."""
    if not compat.has_filaments():
        raise HTTPException(status_code=501, detail="The installed copick does not support filaments")
    fset = service.get_filament_set(run_name, object_name, user_id, session_id)
    if fset is None:
        raise HTTPException(
            status_code=404,
            detail=f"Filaments not found for object '{object_name}', user '{user_id}', session '{session_id}'",
        )
    return _detail(service, object_name, user_id, session_id, fset)


def _curve(filament) -> Optional[FilamentCurveModel]:
    curve = getattr(filament, "curve", None)
    return FilamentCurveModel(**curve.model_dump()) if curve is not None else None


def _detail(service: CopickService, object_name: str, user_id: str, session_id: str, fset) -> FilamentsDetailResponse:
    return FilamentsDetailResponse(
        object_name=object_name,
        user_id=user_id,
        session_id=session_id,
        color=_color(service, object_name),
        voxel_spacing=getattr(getattr(fset, "meta", None), "voxel_spacing", None),
        filaments=[
            FilamentResponse(
                instance_id=int(f.instance_id),
                points=[tuple(float(c) for c in p) for p in f.points],
                polarity_known=bool(f.polarity_known),
                score=float(f.score),
                radius=f.radius,
                curve_kind=compat.filament_curve_kind(f),
                curve=_curve(f),
                metadata=dict(getattr(f, "metadata", None) or {}),
            )
            for f in fset.filaments or []
        ],
    )


def _check_writable(object_name: str, user_id: str, session_id: str) -> None:
    if not compat.has_filaments():
        raise HTTPException(status_code=501, detail="The installed copick does not support filaments")
    if session_id == "0":
        raise HTTPException(status_code=403, detail="Tool filaments (session_id='0') are read-only")
    for label, value in (("object", object_name), ("user", user_id), ("session", session_id)):
        ok, _sanitized, message = validate_copick_name(value)
        if not ok:
            raise HTTPException(status_code=422, detail=f"Invalid {label} name: {message}")


@router.put(
    "/runs/{run_name}/filaments/{object_name}/{user_id}/{session_id}",
    response_model=SaveFilamentsResponse,
)
def save_filaments(
    run_name: str,
    object_name: str,
    user_id: str,
    session_id: str,
    request: SaveFilamentsRequest,
    service: CopickService = Depends(get_copick_service),
) -> SaveFilamentsResponse:
    """Replace a filament set (created if missing). With ``pick_spacing``, the sampled picks replace the whole picks set
    of the same object, user and session."""
    _check_writable(object_name, user_id, session_id)
    if request.pick_spacing is not None and request.pick_spacing <= 0:
        raise HTTPException(status_code=422, detail="The pick spacing must be positive")
    try:
        fset, n_picks = service.save_filaments(
            run_name,
            object_name,
            user_id,
            session_id,
            [f.model_dump() for f in request.filaments],
            voxel_spacing=request.voxel_spacing,
            pick_spacing=request.pick_spacing,
        )
    except ValidationError as e:
        messages = [str(err.get("msg", "")).removeprefix("Value error, ") for err in e.errors()]
        raise HTTPException(status_code=422, detail="; ".join(m for m in messages if m) or str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return SaveFilamentsResponse(filaments=_detail(service, object_name, user_id, session_id, fset), n_picks=n_picks)


@router.delete("/runs/{run_name}/filaments/{object_name}/{user_id}/{session_id}")
def delete_filaments(
    run_name: str,
    object_name: str,
    user_id: str,
    session_id: str,
    service: CopickService = Depends(get_copick_service),
) -> dict:
    """Delete a filament set."""
    _check_writable(object_name, user_id, session_id)
    if not service.delete_filaments(run_name, object_name, user_id, session_id):
        raise HTTPException(status_code=404, detail="Filaments not found")
    return {"deleted": True}

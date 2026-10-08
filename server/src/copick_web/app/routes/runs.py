"""Runs, tomograms, picks, and segmentations routes."""

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ..models import (
    CreatePicksRequest,
    CreatePicksResponse,
    PicksDetailResponse,
    PicksSummaryResponse,
    PointResponse,
    RunDetailResponse,
    RunSummaryResponse,
    SegmentationSummaryResponse,
    TomogramResponse,
    TomogramSummaryResponse,
    UpdatePicksRequest,
    VoxelSpacingSummaryResponse,
)
from ..services.copick_service import CopickService, get_copick_service
from ..validation import validate_copick_name

router = APIRouter(prefix="/api", tags=["runs"])
ServiceDependency = Annotated[CopickService, Depends(get_copick_service)]


@router.get("/runs", response_model=list[RunSummaryResponse])
def get_runs(service: ServiceDependency) -> list[RunSummaryResponse]:
    """Get all runs."""
    return [RunSummaryResponse(name=name) for name in service.get_runs()]


@router.get("/runs/{run_name}", response_model=RunDetailResponse)
def get_run(run_name: str, service: ServiceDependency) -> RunDetailResponse:
    """Get run details including voxel spacings and tomograms."""
    run = service.get_run(run_name)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run '{run_name}' not found")

    voxel_spacings = []
    for vs in run.voxel_spacings:
        tomograms = [TomogramSummaryResponse(tomo_type=t.tomo_type) for t in vs.tomograms]
        voxel_spacings.append(VoxelSpacingSummaryResponse(voxel_size=vs.voxel_size, tomograms=tomograms))

    return RunDetailResponse(name=run.name, voxel_spacings=voxel_spacings)


@router.get("/runs/{run_name}/voxel_spacings/{voxel_size}/tomograms/{tomo_type}", response_model=TomogramResponse)
def get_tomogram(
    run_name: str,
    voxel_size: float,
    tomo_type: str,
    request: Request,
    service: ServiceDependency,
) -> TomogramResponse:
    """Get tomogram details with zarr URL."""
    tomo = service.get_tomogram(run_name, voxel_size, tomo_type)
    if not tomo:
        raise HTTPException(
            status_code=404,
            detail=f"Tomogram '{tomo_type}' not found for run '{run_name}' at voxel size {voxel_size}",
        )

    # Return proxy URL for the zarr store
    root_path = request.scope.get("root_path", "")
    zarr_url = f"{root_path}/zarr/tomo/{run_name}/{voxel_size}/{tomo_type}"
    return TomogramResponse(tomo_type=tomo_type, zarr_url=zarr_url)


# --- Picks endpoints ---


@router.get("/runs/{run_name}/picks", response_model=list[PicksSummaryResponse])
def get_picks(
    run_name: str,
    service: ServiceDependency,
    object_name: Annotated[Optional[str], Query()] = None,
    user_id: Annotated[Optional[str], Query()] = None,
    session_id: Annotated[Optional[str], Query()] = None,
) -> list[PicksSummaryResponse]:
    """Get all picks for a run with optional filtering."""
    run = service.get_run(run_name)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run '{run_name}' not found")

    picks = service.get_picks(run_name, object_name, user_id, session_id)

    result = []
    for pick in picks:
        # Get color from pickable object
        obj = service.get_pickable_object(pick.pickable_object_name)
        color = obj.color if obj else (100, 100, 100, 255)

        result.append(
            PicksSummaryResponse(
                object_name=pick.pickable_object_name,
                user_id=pick.user_id,
                session_id=pick.session_id,
                point_count=len(pick.points),
                color=color,
            )
        )

    return result


@router.get("/runs/{run_name}/picks/{object_name}/{user_id}/{session_id}", response_model=PicksDetailResponse)
def get_pick_points(
    run_name: str,
    object_name: str,
    user_id: str,
    session_id: str,
    service: ServiceDependency,
) -> PicksDetailResponse:
    """Get detailed picks with all points."""
    pick = service.get_pick(run_name, object_name, user_id, session_id)
    if not pick:
        raise HTTPException(
            status_code=404,
            detail=f"Picks not found for object '{object_name}', user '{user_id}', session '{session_id}'",
        )

    # Get color from pickable object
    obj = service.get_pickable_object(object_name)
    color = obj.color if obj else (100, 100, 100, 255)

    points = [
        PointResponse(
            x=pt.location.x,
            y=pt.location.y,
            z=pt.location.z,
            instance_id=pt.instance_id,
            score=pt.score,
        )
        for pt in pick.points
    ]

    return PicksDetailResponse(
        object_name=object_name,
        user_id=user_id,
        session_id=session_id,
        color=color,
        points=points,
    )


# --- Picks mutation endpoints ---


@router.post("/runs/{run_name}/picks", response_model=CreatePicksResponse, status_code=201)
def create_picks(
    run_name: str,
    request: CreatePicksRequest,
    service: ServiceDependency,
) -> CreatePicksResponse:
    """Create a new empty picks collection."""
    # Validate all name fields using copick rules
    for field_name, value in [
        ("object_name", request.object_name),
        ("user_id", request.user_id),
        ("session_id", request.session_id),
    ]:
        is_valid, _, error_msg = validate_copick_name(value)
        if not is_valid:
            raise HTTPException(status_code=400, detail=f"Invalid {field_name}: {error_msg}")

    try:
        service.create_picks(
            run_name,
            request.object_name,
            request.user_id,
            request.session_id,
        )
        obj = service.get_pickable_object(request.object_name)
        color = obj.color if obj else (100, 100, 100, 255)

        return CreatePicksResponse(
            object_name=request.object_name,
            user_id=request.user_id,
            session_id=request.session_id,
            color=color,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.put("/runs/{run_name}/picks/{object_name}/{user_id}/{session_id}", response_model=PicksDetailResponse)
def update_picks(
    run_name: str,
    object_name: str,
    user_id: str,
    session_id: str,
    request: UpdatePicksRequest,
    service: ServiceDependency,
) -> PicksDetailResponse:
    """Update picks with new points."""
    # Check if picks are editable (session_id != "0")
    if session_id == "0":
        raise HTTPException(status_code=403, detail="Tool picks (session_id='0') are read-only")

    try:
        pick = service.update_picks(
            run_name,
            object_name,
            user_id,
            session_id,
            [p.model_dump() for p in request.points],
        )
        obj = service.get_pickable_object(object_name)
        color = obj.color if obj else (100, 100, 100, 255)

        return PicksDetailResponse(
            object_name=object_name,
            user_id=user_id,
            session_id=session_id,
            color=color,
            points=[
                PointResponse(
                    x=pt.location.x,
                    y=pt.location.y,
                    z=pt.location.z,
                    instance_id=pt.instance_id,
                    score=pt.score,
                )
                for pt in pick.points
            ],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.delete("/runs/{run_name}/picks/{object_name}/{user_id}/{session_id}", status_code=204)
def delete_picks(
    run_name: str,
    object_name: str,
    user_id: str,
    session_id: str,
    service: ServiceDependency,
):
    """Delete a picks collection."""
    # Check if picks are editable (session_id != "0")
    if session_id == "0":
        raise HTTPException(status_code=403, detail="Tool picks (session_id='0') are read-only")

    try:
        service.delete_picks_collection(run_name, object_name, user_id, session_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


# --- Segmentations endpoints ---


@router.get("/runs/{run_name}/segmentations", response_model=list[SegmentationSummaryResponse])
def get_segmentations(
    run_name: str,
    request: Request,
    service: ServiceDependency,
    name: Annotated[Optional[str], Query()] = None,
    user_id: Annotated[Optional[str], Query()] = None,
    session_id: Annotated[Optional[str], Query()] = None,
    voxel_size: Annotated[Optional[float], Query()] = None,
) -> list[SegmentationSummaryResponse]:
    """Get all segmentations for a run with optional filtering."""
    run = service.get_run(run_name)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run '{run_name}' not found")

    segs = service.get_segmentations(run_name, name, user_id, session_id, voxel_size)
    root_path = request.scope.get("root_path", "")

    result = []
    for seg in segs:
        # Get color from pickable object if it exists
        obj = service.get_pickable_object(seg.name)
        color = obj.color if obj else None

        # Build proxy URL for the zarr store
        zarr_url = f"{root_path}/zarr/seg/{run_name}/{seg.name}/{seg.user_id}/{seg.session_id}/{seg.voxel_size}"

        result.append(
            SegmentationSummaryResponse(
                name=seg.name,
                user_id=seg.user_id,
                session_id=seg.session_id,
                voxel_size=seg.voxel_size,
                is_multilabel=seg.is_multilabel,
                zarr_url=zarr_url,
                color=color,
            )
        )

    return result

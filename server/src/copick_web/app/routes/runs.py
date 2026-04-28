"""Runs, tomograms, picks, and segmentations routes."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ..dependencies import get_copick_service, get_project_meta
from ..models import (
    CreatePicksRequest,
    CreatePicksResponse,
    PicksDetailResponse,
    PicksSummaryResponse,
    PointResponse,
    ProjectSummaryResponse,
    RunDetailResponse,
    RunSummaryResponse,
    SegmentationSummaryResponse,
    TomogramResponse,
    TomogramSummaryResponse,
    UpdatePicksRequest,
    VoxelSpacingSummaryResponse,
)
from ..services.copick_service import CopickService
from ..services.zarr_urls import build_segmentation_zarr_url, build_tomogram_zarr_url
from ..validation import validate_copick_name

router = APIRouter(prefix="/api/projects/{project_id}", tags=["runs"])


@router.get("/runs", response_model=list[RunSummaryResponse])
def get_runs(service: CopickService = Depends(get_copick_service)) -> list[RunSummaryResponse]:
    """Get all runs."""
    return [RunSummaryResponse(name=name) for name in service.get_runs()]


@router.get("/runs/{run_name}", response_model=RunDetailResponse)
def get_run(run_name: str, service: CopickService = Depends(get_copick_service)) -> RunDetailResponse:
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
    service: CopickService = Depends(get_copick_service),
    meta: ProjectSummaryResponse = Depends(get_project_meta),
) -> TomogramResponse:
    """Get tomogram details with zarr URL."""
    tomo = service.get_tomogram(run_name, voxel_size, tomo_type)
    if not tomo:
        raise HTTPException(
            status_code=404,
            detail=f"Tomogram '{tomo_type}' not found for run '{run_name}' at voxel size {voxel_size}",
        )

    zarr_url = build_tomogram_zarr_url(
        meta=meta,
        root_path=request.scope.get("root_path", ""),
        run_name=run_name,
        voxel_size=voxel_size,
        tomo_type=tomo_type,
    )
    return TomogramResponse(tomo_type=tomo_type, zarr_url=zarr_url)


# --- Picks endpoints ---


@router.get("/runs/{run_name}/picks", response_model=list[PicksSummaryResponse])
def get_picks(
    run_name: str,
    object_name: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
    service: CopickService = Depends(get_copick_service),
) -> list[PicksSummaryResponse]:
    """Get all picks for a run with optional filtering."""
    run = service.get_run(run_name)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run '{run_name}' not found")

    picks = service.get_picks(run_name, object_name, user_id, session_id)

    result = []
    for pick in picks:
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
    service: CopickService = Depends(get_copick_service),
) -> PicksDetailResponse:
    """Get detailed picks with all points."""
    pick = service.get_pick(run_name, object_name, user_id, session_id)
    if not pick:
        raise HTTPException(
            status_code=404,
            detail=f"Picks not found for object '{object_name}', user '{user_id}', session '{session_id}'",
        )

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
    service: CopickService = Depends(get_copick_service),
) -> CreatePicksResponse:
    """Create a new empty picks collection."""
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
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/runs/{run_name}/picks/{object_name}/{user_id}/{session_id}", response_model=PicksDetailResponse)
def update_picks(
    run_name: str,
    object_name: str,
    user_id: str,
    session_id: str,
    request: UpdatePicksRequest,
    service: CopickService = Depends(get_copick_service),
) -> PicksDetailResponse:
    """Update picks with new points."""
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
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/runs/{run_name}/picks/{object_name}/{user_id}/{session_id}", status_code=204)
def delete_picks(
    run_name: str,
    object_name: str,
    user_id: str,
    session_id: str,
    service: CopickService = Depends(get_copick_service),
):
    """Delete a picks collection."""
    if session_id == "0":
        raise HTTPException(status_code=403, detail="Tool picks (session_id='0') are read-only")

    try:
        service.delete_picks_collection(run_name, object_name, user_id, session_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# --- Segmentations endpoints ---


@router.get("/runs/{run_name}/segmentations", response_model=list[SegmentationSummaryResponse])
def get_segmentations(
    run_name: str,
    request: Request,
    name: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
    voxel_size: Optional[float] = Query(None),
    service: CopickService = Depends(get_copick_service),
    meta: ProjectSummaryResponse = Depends(get_project_meta),
) -> list[SegmentationSummaryResponse]:
    """Get all segmentations for a run with optional filtering."""
    run = service.get_run(run_name)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run '{run_name}' not found")

    segs = service.get_segmentations(run_name, name, user_id, session_id, voxel_size)
    root_path = request.scope.get("root_path", "")

    result = []
    for seg in segs:
        obj = service.get_pickable_object(seg.name)
        color = obj.color if obj else None

        zarr_url = build_segmentation_zarr_url(
            meta=meta,
            root_path=root_path,
            run_name=run_name,
            seg_name=seg.name,
            user_id=seg.user_id,
            session_id=seg.session_id,
            voxel_size=seg.voxel_size,
            is_multilabel=seg.is_multilabel,
        )

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

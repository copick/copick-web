"""Runs, tomograms, picks, and segmentations routes."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from ..dependencies import get_copick_service, get_project_meta
from ..models import (
    CreatePicksRequest,
    CreatePicksResponse,
    InstanceResponse,
    InstancesResponse,
    PicksDetailResponse,
    PicksSummaryResponse,
    PointResponse,
    ProjectSummaryResponse,
    RunDetailResponse,
    RunInfoResponse,
    RunSummaryResponse,
    SegmentationSummaryResponse,
    TomogramResponse,
    TomogramSummaryResponse,
    UpdatePicksRequest,
    VoxelSpacingSummaryResponse,
)
from ..services import compat
from ..services.copick_service import (
    DEFAULT_SURFACE_POINTS,
    CopickService,
    encode_surface_points,
)
from ..services.copick_service import _open_level as open_level
from ..services.run_info import run_info
from ..services.thumbnails import thumbnail
from ..services.zarr_urls import segmentation_zarr_url, tomogram_zarr_url
from ..validation import validate_copick_name

router = APIRouter(prefix="/api/projects/{project_id}", tags=["runs"])


def _point_response(pt) -> PointResponse:
    return PointResponse(
        x=pt.location.x,
        y=pt.location.y,
        z=pt.location.z,
        instance_id=pt.instance_id,
        score=pt.score,
        transformation=compat.point_transformation(pt),
    )


def _is_filament_object(service: CopickService, object_name: str) -> bool:
    obj = service.get_pickable_object(object_name)
    return obj is not None and compat.filament_spec(obj) is not None


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


@router.get("/runs/{run_name}/thumbnail")
def get_run_thumbnail(
    run_name: str,
    size: int = Query(256, ge=32, le=1024),
    voxel_size: Optional[float] = Query(None),
    tomo_type: Optional[str] = Query(None),
    service: CopickService = Depends(get_copick_service),
) -> Response:
    """PNG of the central XY slice of a run's tomogram (the given one, else denoised / wbp at the coarsest voxel
    spacing). The tomogram used is reported in ``X-Copick-Tomo-Type`` and ``X-Copick-Voxel-Size``."""
    result = thumbnail(service, service.thumbnails, run_name, size, open_level, voxel_size, tomo_type)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No tomogram in run '{run_name}'")
    return Response(
        content=result.png,
        media_type="image/png",
        headers={
            "X-Copick-Tomo-Type": result.tomo_type,
            "X-Copick-Voxel-Size": f"{result.voxel_size:g}",
            "Access-Control-Expose-Headers": "X-Copick-Tomo-Type, X-Copick-Voxel-Size",
            "Cache-Control": "private, max-age=3600",
        },
    )


@router.get("/runs/{run_name}/info", response_model=RunInfoResponse)
def get_run_info(run_name: str, service: CopickService = Depends(get_copick_service)) -> RunInfoResponse:
    """Paths, CryoET Data Portal links and metadata, and contents of a run and its tomograms."""
    run = service.get_run(run_name)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run '{run_name}' not found")
    return RunInfoResponse(**run_info(service, run, open_level))


@router.get("/runs/{run_name}/voxel_spacings/{voxel_size}/tomograms/{tomo_type}", response_model=TomogramResponse)
def get_tomogram(
    run_name: str,
    voxel_size: float,
    tomo_type: str,
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

    zarr_url = tomogram_zarr_url(meta, service.root, run_name, voxel_size, tomo)
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

        points = pick.points or []
        result.append(
            PicksSummaryResponse(
                object_name=pick.pickable_object_name,
                user_id=pick.user_id,
                session_id=pick.session_id,
                point_count=len(points),
                color=color,
                is_filament=_is_filament_object(service, pick.pickable_object_name),
                instance_count=compat.instance_count(points),
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

    points = [_point_response(pt) for pt in pick.points or []]

    return PicksDetailResponse(
        object_name=object_name,
        user_id=user_id,
        session_id=session_id,
        color=color,
        points=points,
        is_filament=_is_filament_object(service, object_name),
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
        raise HTTPException(status_code=400, detail=str(e)) from e


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
            points=[_point_response(pt) for pt in pick.points],
            is_filament=_is_filament_object(service, object_name),
        )
    except ValueError as e:
        status = 404 if "not found" in str(e) else 400
        raise HTTPException(status_code=status, detail=str(e)) from e


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
        raise HTTPException(status_code=404, detail=str(e)) from e


# --- Segmentations endpoints ---


@router.get("/runs/{run_name}/segmentations", response_model=list[SegmentationSummaryResponse])
def get_segmentations(
    run_name: str,
    name: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
    voxel_size: Optional[float] = Query(None),
    segmentation_type: Optional[list[str]] = Query(None),
    service: CopickService = Depends(get_copick_service),
    meta: ProjectSummaryResponse = Depends(get_project_meta),
) -> list[SegmentationSummaryResponse]:
    """Get all segmentations for a run with optional filtering (``segmentation_type`` may repeat)."""
    run = service.get_run(run_name)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run '{run_name}' not found")

    segs = service.get_segmentations(run_name, name, user_id, session_id, voxel_size, seg_types=segmentation_type)

    result = []
    for seg in segs:
        obj = service.get_pickable_object(seg.name)
        color = obj.color if obj else None
        kind = compat.seg_type(seg)

        result.append(
            SegmentationSummaryResponse(
                name=seg.name,
                user_id=seg.user_id,
                session_id=seg.session_id,
                voxel_size=seg.voxel_size,
                is_multilabel=seg.is_multilabel,
                zarr_url=segmentation_zarr_url(meta, service.root, run_name, seg),
                color=color,
                segmentation_type=kind,
                is_instance=kind == "instance",
                is_panoptic=kind == "panoptic",
                channels=compat.seg_channels(seg),
            )
        )

    return result


@router.get(
    "/runs/{run_name}/segmentations/{seg_type}/{name}/{user_id}/{session_id}/{voxel_size}/instances",
    response_model=InstancesResponse,
)
def get_segmentation_instances(
    run_name: str,
    seg_type: str,
    name: str,
    user_id: str,
    session_id: str,
    voxel_size: float,
    level: int = Query(1, ge=0),
    service: CopickService = Depends(get_copick_service),
) -> InstancesResponse:
    """Voxel counts and centroids (Angstrom) of the instances of an instance or panoptic segmentation."""
    if seg_type not in ("instance", "panoptic"):
        raise HTTPException(status_code=400, detail="Instances exist only in instance and panoptic segmentations")
    result = service.get_instances(run_name, seg_type, name, user_id, session_id, voxel_size, level)
    if result is None:
        raise HTTPException(status_code=404, detail=f"{seg_type} segmentation '{name}' not found for run '{run_name}'")
    return InstancesResponse(
        segmentation_type=seg_type,
        level=result["level"],
        voxel_size=result["voxel_size"],
        instances=[InstanceResponse(**inst) for inst in result["instances"]],
    )


@router.get("/runs/{run_name}/segmentations/{seg_type}/{name}/{user_id}/{session_id}/{voxel_size}/surface")
def get_segmentation_surface(
    run_name: str,
    seg_type: str,
    name: str,
    user_id: str,
    session_id: str,
    voxel_size: float,
    max_points: int = Query(DEFAULT_SURFACE_POINTS, ge=1, le=2_000_000),
    service: CopickService = Depends(get_copick_service),
) -> Response:
    """Boundary voxels of a segmentation as a binary point cloud, for the 3D view.

    The body is little-endian: a 16-byte header (uint32 point count N, uint32 channel count C, float32 voxel size in
    Angstrom, uint32 pyramid level), float32 positions ``[N*3]`` (x, y, z Angstrom), uint32 values ``[N*C]`` (labels;
    label and instance for panoptic) and int8 outward normals ``[N*3]``.
    """
    if seg_type not in compat.SEGMENTATION_TYPES:
        raise HTTPException(status_code=404, detail=f"Unknown segmentation type '{seg_type}'")
    result = service.get_surface_points(run_name, seg_type, name, user_id, session_id, voxel_size, max_points)
    if result is None:
        raise HTTPException(status_code=404, detail=f"{seg_type} segmentation '{name}' not found for run '{run_name}'")
    return Response(content=encode_surface_points(result), media_type="application/octet-stream")

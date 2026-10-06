"""Runs, tomograms, picks, and segmentations routes."""

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from ..models import (
    CreatePicksRequest,
    CreatePicksResponse,
    InstanceResponse,
    InstancesResponse,
    PicksDetailResponse,
    PicksSummaryResponse,
    PointResponse,
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
    get_copick_service,
)
from ..services.copick_service import _open_level as open_level
from ..services.run_info import run_info
from ..services.thumbnails import thumbnail
from ..validation import validate_copick_name

router = APIRouter(prefix="/api", tags=["runs"])
ServiceDependency = Annotated[CopickService, Depends(get_copick_service)]


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


def segmentation_zarr_url(root_path: str, run_name: str, seg) -> str:
    """The proxy URL of a segmentation store; the type is part of the path because it is part of the identity."""
    return (
        f"{root_path}/zarr/segmentation/{compat.seg_type(seg)}/{run_name}/{seg.name}/{seg.user_id}/"
        f"{seg.session_id}/{seg.voxel_size}"
    )


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


@router.get("/runs/{run_name}/thumbnail")
def get_run_thumbnail(
    run_name: str,
    service: ServiceDependency,
    size: Annotated[int, Query(ge=32, le=1024)] = 256,
    voxel_size: Annotated[Optional[float], Query()] = None,
    tomo_type: Annotated[Optional[str], Query()] = None,
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
def get_run_info(run_name: str, service: ServiceDependency) -> RunInfoResponse:
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
    segmentation_type: Annotated[Optional[list[str]], Query()] = None,
) -> list[SegmentationSummaryResponse]:
    """Get all segmentations for a run with optional filtering (``segmentation_type`` may repeat)."""
    run = service.get_run(run_name)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run '{run_name}' not found")

    segs = service.get_segmentations(run_name, name, user_id, session_id, voxel_size, seg_types=segmentation_type)
    root_path = request.scope.get("root_path", "")

    result = []
    for seg in segs:
        # Get color from pickable object if it exists
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
                zarr_url=segmentation_zarr_url(root_path, run_name, seg),
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
    service: ServiceDependency,
    level: Annotated[int, Query(ge=0)] = 1,
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
    service: ServiceDependency,
    max_points: Annotated[int, Query(ge=1, le=2_000_000)] = DEFAULT_SURFACE_POINTS,
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

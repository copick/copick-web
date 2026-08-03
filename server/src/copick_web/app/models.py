"""Pydantic response models for the API."""

from typing import Literal, Optional

from pydantic import BaseModel


class ProjectSummaryResponse(BaseModel):
    """Summary of a project tracked by the project registry."""

    id: str
    source: Literal["registry", "local"]
    # Registry-derived fields (all optional — locals don't have them).
    session_name: Optional[str] = None
    run_name: Optional[str] = None
    cluster_id: Optional[str] = None
    scope: Optional[str] = None
    status: Optional[str] = None
    created_at: Optional[str] = None
    proc_run_id: Optional[int] = None
    config_url: Optional[str] = None
    data_url: Optional[str] = None
    root_url: Optional[str] = None
    # Pulled from copick config when service is materialized; nullable so listing stays cheap.
    name: Optional[str] = None
    description: Optional[str] = None


class ConfigResponse(BaseModel):
    """Project configuration response."""

    name: Optional[str]
    description: Optional[str]
    version: Optional[str]
    user_id: Optional[str]
    session_id: Optional[str]


class PickableObjectResponse(BaseModel):
    """Pickable object metadata."""

    name: str
    is_particle: bool
    label: Optional[int]
    color: tuple[int, int, int, int]
    radius: Optional[float]


class RunSummaryResponse(BaseModel):
    """Summary of a run."""

    name: str


class TomogramSummaryResponse(BaseModel):
    """Summary of a tomogram."""

    tomo_type: str


class VoxelSpacingSummaryResponse(BaseModel):
    """Summary of a voxel spacing with its tomograms."""

    voxel_size: float
    tomograms: list[TomogramSummaryResponse]


class RunDetailResponse(BaseModel):
    """Detailed run information including voxel spacings."""

    name: str
    voxel_spacings: list[VoxelSpacingSummaryResponse]


class TomogramResponse(BaseModel):
    """Tomogram with zarr URL."""

    tomo_type: str
    zarr_url: str


class PointResponse(BaseModel):
    """A single pick point."""

    x: float
    y: float
    z: float
    instance_id: Optional[int]
    score: Optional[float]


class PicksSummaryResponse(BaseModel):
    """Summary of a picks collection."""

    object_name: str
    user_id: str
    session_id: str
    point_count: int
    color: tuple[int, int, int, int]


class PicksDetailResponse(BaseModel):
    """Detailed picks with all points."""

    object_name: str
    user_id: str
    session_id: str
    color: tuple[int, int, int, int]
    points: list[PointResponse]


class SegmentationSummaryResponse(BaseModel):
    """Summary of a segmentation."""

    name: str
    user_id: str
    session_id: str
    voxel_size: float
    is_multilabel: bool
    zarr_url: str
    color: Optional[tuple[int, int, int, int]]


# --- Request models for picks mutations ---


class CreatePicksRequest(BaseModel):
    """Request to create a new picks collection."""

    object_name: str
    user_id: str
    session_id: str


class PointRequest(BaseModel):
    """Point for create/update operations."""

    x: float
    y: float
    z: float
    instance_id: Optional[int] = None
    score: Optional[float] = 1.0


class UpdatePicksRequest(BaseModel):
    """Request to update picks points."""

    points: list[PointRequest]


class CreatePicksResponse(BaseModel):
    """Response after creating picks."""

    object_name: str
    user_id: str
    session_id: str
    color: tuple[int, int, int, int]

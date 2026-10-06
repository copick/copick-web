"""Pydantic response models for the API."""

from typing import Any, Literal, Optional

from pydantic import BaseModel

SegmentationType = Literal["binary", "multilabel", "instance", "panoptic"]


class FeaturesResponse(BaseModel):
    """Optional features of the installed copick (see services/compat.py)."""

    filaments: bool = False
    segmentation_types: bool = False
    pick_identity: bool = False


class ConfigResponse(BaseModel):
    """Project configuration response."""

    name: Optional[str]
    description: Optional[str]
    version: Optional[str]
    user_id: Optional[str]
    session_id: Optional[str]
    features: FeaturesResponse = FeaturesResponse()


class PickableObjectResponse(BaseModel):
    """Pickable object metadata."""

    name: str
    is_particle: bool
    label: Optional[int]
    color: tuple[int, int, int, int]
    radius: Optional[float]
    is_filament: bool = False
    filament: Optional[dict[str, Any]] = None


class FilamentSpecModel(BaseModel):
    """Filament declaration of an object (copick ``FilamentSpec``)."""

    polar: Optional[bool] = None
    helical_rise_a: Optional[float] = None
    helical_twist_deg: Optional[float] = None


class ObjectTypeFields(BaseModel):
    """The editable fields of a pickable object type."""

    name: str
    is_particle: bool = True
    label: Optional[int] = None
    color: tuple[int, int, int, int]
    radius: Optional[float] = None
    map_threshold: Optional[float] = None
    emdb_id: Optional[str] = None
    pdb_id: Optional[str] = None
    identifier: Optional[str] = None
    #: None: not a filament.
    filament: Optional[FilamentSpecModel] = None


class ObjectTypeRequest(ObjectTypeFields):
    """Create or update an object type; ``version`` is the object list version the change was made against."""

    version: str


class ObjectTypesResponse(BaseModel):
    """The configuration's object types, for editing."""

    version: str
    editable: bool
    config_file: Optional[str]
    suggested_label: int
    objects: list[ObjectTypeFields]


class ReloadResponse(BaseModel):
    """The project after it was re-opened from its configuration file."""

    runs: int


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


class ZarrInfo(BaseModel):
    shape: list[int]
    dtype: str
    levels: int


class TomogramInfo(BaseModel):
    tomo_type: str
    #: Where the tomogram is read from (portal location, overlay or static copy).
    path: Optional[str] = None
    #: Level-0 shape (z, y, x), dtype and pyramid levels; None if the store could not be read.
    zarr: Optional[ZarrInfo] = None
    #: CryoET Data Portal metadata (id, url, name, reconstruction, deposition, authors, paths...), if any.
    portal: Optional[dict[str, Any]] = None


class VoxelSpacingInfo(BaseModel):
    voxel_size: float
    static_path: Optional[str] = None
    overlay_path: Optional[str] = None
    portal_id: Optional[int] = None
    tomograms: list[TomogramInfo]


class RunPortalInfo(BaseModel):
    run_id: int
    run_name: Optional[str] = None
    run_url: str
    dataset_id: Optional[int] = None
    dataset_url: Optional[str] = None


class RunInfoResponse(BaseModel):
    """Where a run's data lives and what it holds (the run info dialog)."""

    name: str
    backend: str
    static_path: Optional[str] = None
    overlay_path: Optional[str] = None
    portal: Optional[RunPortalInfo] = None
    counts: dict[str, Optional[int]]
    voxel_spacings: list[VoxelSpacingInfo]


class TomogramResponse(BaseModel):
    """Tomogram with zarr URL."""

    tomo_type: str
    zarr_url: str


class PointResponse(BaseModel):
    """A single pick point.

    ``x``, ``y``, ``z`` are the stored location in Angstrom. The particle centre is the location plus the translation
    of ``transformation`` (a 4x4 object-to-tomogram matrix); clients draw the centre and send the location and
    transformation back unchanged when saving.
    """

    x: float
    y: float
    z: float
    instance_id: Optional[int]
    score: Optional[float]
    transformation: Optional[list[list[float]]] = None


class PicksSummaryResponse(BaseModel):
    """Summary of a picks collection."""

    object_name: str
    user_id: str
    session_id: str
    point_count: int
    color: tuple[int, int, int, int]
    is_filament: bool = False
    instance_count: int = 0


class PicksDetailResponse(BaseModel):
    """Detailed picks with all points."""

    object_name: str
    user_id: str
    session_id: str
    color: tuple[int, int, int, int]
    points: list[PointResponse]
    is_filament: bool = False


class SegmentationSummaryResponse(BaseModel):
    """Summary of a segmentation."""

    name: str
    user_id: str
    session_id: str
    voxel_size: float
    is_multilabel: bool
    zarr_url: str
    color: Optional[tuple[int, int, int, int]]
    segmentation_type: SegmentationType = "binary"
    is_instance: bool = False
    is_panoptic: bool = False
    channels: Optional[list[str]] = None


class InstanceResponse(BaseModel):
    """One instance (or panoptic segment) of a segmentation, measured on a pyramid level."""

    instance_id: int
    label: Optional[int] = None
    voxel_count: int
    centroid: tuple[float, float, float]


class InstancesResponse(BaseModel):
    """The instances of an instance or panoptic segmentation."""

    segmentation_type: SegmentationType
    level: int
    voxel_size: float
    instances: list[InstanceResponse]


# --- Filaments ---


class FilamentCurveModel(BaseModel):
    """An editable or fitted filament curve (copick ``CopickFilamentCurve``); ``points`` are regenerated from it."""

    kind: str
    control_points: list[tuple[float, float, float]]
    step: float
    alpha: Optional[float] = None
    degree: Optional[int] = None
    knots: Optional[list[float]] = None
    smoothing: Optional[float] = None


class FilamentResponse(BaseModel):
    """One traced filament: its ordered centreline in Angstrom."""

    instance_id: int
    points: list[tuple[float, float, float]]
    polarity_known: bool = False
    score: float = 1.0
    radius: Optional[float] = None
    curve_kind: Optional[str] = None
    #: The stored curve, if any (it may be stale: editors check it against ``points``).
    curve: Optional[FilamentCurveModel] = None
    metadata: dict[str, Any] = {}


class FilamentsSummaryResponse(BaseModel):
    """Summary of a set of filaments (one object, user and session)."""

    object_name: str
    user_id: str
    session_id: str
    filament_count: int
    color: tuple[int, int, int, int]
    instance_ids: list[int] = []


class FilamentsDetailResponse(BaseModel):
    """A set of filaments with their centrelines."""

    object_name: str
    user_id: str
    session_id: str
    color: tuple[int, int, int, int]
    filaments: list[FilamentResponse]
    voxel_spacing: Optional[float] = None


class FilamentWriteModel(BaseModel):
    """One filament to store: a ``curve`` (its points are regenerated by copick) or, for filaments without one,
    the ``points`` as they are."""

    instance_id: int
    curve: Optional[FilamentCurveModel] = None
    points: Optional[list[tuple[float, float, float]]] = None
    polarity_known: bool = False
    score: float = 1.0
    radius: Optional[float] = None
    metadata: dict[str, Any] = {}


class SaveFilamentsRequest(BaseModel):
    """Replace a filament set (created if missing). With ``pick_spacing`` (Angstrom), picks sampled along the
    filaments replace the picks set of the same object, user and session."""

    filaments: list[FilamentWriteModel]
    voxel_spacing: Optional[float] = None
    pick_spacing: Optional[float] = None


class SaveFilamentsResponse(BaseModel):
    filaments: FilamentsDetailResponse
    n_picks: int = 0


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
    transformation: Optional[list[list[float]]] = None


class UpdatePicksRequest(BaseModel):
    """Request to update picks points."""

    points: list[PointRequest]


class CreatePicksResponse(BaseModel):
    """Response after creating picks."""

    object_name: str
    user_id: str
    session_id: str
    color: tuple[int, int, int, int]

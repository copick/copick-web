/**
 * API response types matching the server's Pydantic models.
 */

export interface FeaturesResponse {
  /** copick has the run-level Filaments entity. */
  filaments: boolean;
  /** copick knows instance and panoptic segmentations. */
  segmentation_types: boolean;
  /** copick has pick identity helpers (instance IDs, full positions). */
  pick_identity: boolean;
}

export interface ConfigResponse {
  name: string | null;
  description: string | null;
  version: string | null;
  user_id: string | null;
  session_id: string | null;
  features?: FeaturesResponse;
}

export type Rgba = [number, number, number, number];
export type Matrix4 = number[][];

export interface PickableObjectResponse {
  name: string;
  is_particle: boolean;
  label: number | null;
  color: [number, number, number, number];
  radius: number | null;
  is_filament?: boolean;
  filament?: Record<string, unknown> | null;
}

/** Filament declaration of an object type (copick FilamentSpec). */
export interface FilamentSpecFields {
  polar: boolean | null;
  helical_rise_a: number | null;
  helical_twist_deg: number | null;
}

/** The editable fields of a pickable object type. */
export interface ObjectTypeFields {
  name: string;
  is_particle: boolean;
  label: number | null;
  color: Rgba;
  radius: number | null;
  map_threshold: number | null;
  emdb_id: string | null;
  pdb_id: string | null;
  identifier: string | null;
  /** null: not a filament. */
  filament: FilamentSpecFields | null;
}

export interface ObjectTypesResponse {
  /** Version of the object list; changes must name the version they were made against. */
  version: string;
  /** Whether the configuration file can be written. */
  editable: boolean;
  config_file: string | null;
  suggested_label: number;
  objects: ObjectTypeFields[];
}

export interface TomogramInfo {
  tomo_type: string;
  /** Where the tomogram is read from (portal location, overlay or static copy). */
  path: string | null;
  /** Level-0 shape (z, y, x), dtype and pyramid levels; null if the store could not be read. */
  zarr: { shape: number[]; dtype: string; levels: number } | null;
  /** CryoET Data Portal metadata, for portal tomograms. */
  portal: {
    id: number;
    url: string;
    name?: string;
    reconstruction_method?: string;
    processing?: string;
    ctf_corrected?: boolean;
    fiducial_alignment_status?: string;
    tomogram_version?: number;
    is_portal_standard?: boolean;
    deposition_id?: number;
    deposition_url?: string;
    alignment_id?: number;
    https_omezarr_dir?: string;
    s3_omezarr_dir?: string;
    https_mrc_file?: string;
    size_xyz?: [number, number, number];
    authors?: string[];
    path?: string;
  } | null;
}

export interface RunInfoResponse {
  name: string;
  /** The copick root class, e.g. CopickRootFSSpec or CopickRootCDP. */
  backend: string;
  static_path: string | null;
  overlay_path: string | null;
  portal: {
    run_id: number;
    run_name: string | null;
    run_url: string;
    dataset_id: number | null;
    dataset_url: string | null;
  } | null;
  counts: Record<string, number | null>;
  voxel_spacings: {
    voxel_size: number;
    static_path: string | null;
    overlay_path: string | null;
    portal_id: number | null;
    tomograms: TomogramInfo[];
  }[];
}

export interface RunSummaryResponse {
  name: string;
}

export interface TomogramSummaryResponse {
  tomo_type: string;
}

export interface VoxelSpacingSummaryResponse {
  voxel_size: number;
  tomograms: TomogramSummaryResponse[];
}

export interface RunDetailResponse {
  name: string;
  voxel_spacings: VoxelSpacingSummaryResponse[];
}

export interface TomogramResponse {
  tomo_type: string;
  zarr_url: string;
}

/**
 * A pick point. `x`, `y`, `z` are the stored location (Å); the particle centre
 * is the location plus the translation of `transformation`.
 */
export interface PointResponse {
  x: number;
  y: number;
  z: number;
  instance_id: number | null;
  score: number | null;
  transformation?: Matrix4 | null;
}

export interface PicksSummaryResponse {
  object_name: string;
  user_id: string;
  session_id: string;
  point_count: number;
  color: [number, number, number, number];
  is_filament?: boolean;
  instance_count?: number;
}

export interface PicksDetailResponse {
  object_name: string;
  user_id: string;
  session_id: string;
  color: [number, number, number, number];
  points: PointResponse[];
  is_filament?: boolean;
}

export interface SegmentationSummaryResponse {
  name: string;
  user_id: string;
  session_id: string;
  voxel_size: number;
  is_multilabel: boolean;
  zarr_url: string;
  color: [number, number, number, number] | null;
  /** Missing on servers that predate typed segmentations: derive with `segmentationTypeOf`. */
  segmentation_type?: SegmentationType;
  is_instance?: boolean;
  is_panoptic?: boolean;
  channels?: string[] | null;
}

export type SegmentationType =
  | "binary"
  | "multilabel"
  | "instance"
  | "panoptic";
export const SEGMENTATION_TYPES: SegmentationType[] = [
  "binary",
  "multilabel",
  "instance",
  "panoptic",
];

export function segmentationTypeOf(
  seg: SegmentationSummaryResponse,
): SegmentationType {
  if (seg.segmentation_type) return seg.segmentation_type;
  if (seg.is_panoptic) return "panoptic";
  if (seg.is_instance) return "instance";
  return seg.is_multilabel ? "multilabel" : "binary";
}

export interface InstanceResponse {
  instance_id: number;
  /** Object label (panoptic segments only). */
  label: number | null;
  voxel_count: number;
  /** Centroid in Å (x, y, z). */
  centroid: [number, number, number];
}

export interface InstancesResponse {
  segmentation_type: SegmentationType;
  level: number;
  voxel_size: number;
  instances: InstanceResponse[];
}

// --- Filaments ---

/** An editable or fitted filament curve (copick CopickFilamentCurve); points are regenerated from it. */
export interface FilamentCurveData {
  kind: string;
  control_points: [number, number, number][];
  step: number;
  alpha?: number | null;
  degree?: number | null;
  knots?: number[] | null;
  smoothing?: number | null;
}

export interface FilamentResponse {
  instance_id: number;
  /** Ordered centreline in Å. */
  points: [number, number, number][];
  polarity_known: boolean;
  score: number;
  radius: number | null;
  curve_kind: string | null;
  /** The stored curve, if any (may be stale: check it against `points`). */
  curve?: FilamentCurveData | null;
  metadata?: Record<string, unknown>;
}

export interface FilamentsSummaryResponse {
  object_name: string;
  user_id: string;
  session_id: string;
  filament_count: number;
  color: [number, number, number, number];
  instance_ids: number[];
}

export interface FilamentsDetailResponse {
  object_name: string;
  user_id: string;
  session_id: string;
  color: [number, number, number, number];
  filaments: FilamentResponse[];
  voxel_spacing?: number | null;
}

/** One filament to store: a curve (copick regenerates its points) or, for filaments without one, the points. */
export interface FilamentWrite {
  instance_id: number;
  curve?: FilamentCurveData | null;
  points?: [number, number, number][] | null;
  polarity_known: boolean;
  score: number;
  radius: number | null;
  metadata: Record<string, unknown>;
}

export interface SaveFilamentsRequest {
  filaments: FilamentWrite[];
  voxel_spacing?: number | null;
  /** Also write picks sampled every `pick_spacing` Å (they replace the whole picks set). */
  pick_spacing?: number | null;
}

export interface SaveFilamentsResponse {
  filaments: FilamentsDetailResponse;
  n_picks: number;
}

// --- Request types for picks mutations ---

export interface CreatePicksRequest {
  object_name: string;
  user_id: string;
  session_id: string;
}

export interface PointRequest {
  x: number;
  y: number;
  z: number;
  instance_id?: number | null;
  score?: number | null;
  transformation?: Matrix4 | null;
}

export interface UpdatePicksRequest {
  points: PointRequest[];
}

export interface CreatePicksResponse {
  object_name: string;
  user_id: string;
  session_id: string;
  color: [number, number, number, number];
}

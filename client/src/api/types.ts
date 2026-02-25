/**
 * API response types matching the server's Pydantic models.
 */

export interface ConfigResponse {
  name: string | null;
  description: string | null;
  version: string | null;
  user_id: string | null;
  session_id: string | null;
}

export interface PickableObjectResponse {
  name: string;
  is_particle: boolean;
  label: number | null;
  color: [number, number, number, number];
  radius: number | null;
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

export interface PointResponse {
  x: number;
  y: number;
  z: number;
  instance_id: number | null;
  score: number | null;
}

export interface PicksSummaryResponse {
  object_name: string;
  user_id: string;
  session_id: string;
  point_count: number;
  color: [number, number, number, number];
}

export interface PicksDetailResponse {
  object_name: string;
  user_id: string;
  session_id: string;
  color: [number, number, number, number];
  points: PointResponse[];
}

export interface SegmentationSummaryResponse {
  name: string;
  user_id: string;
  session_id: string;
  voxel_size: number;
  is_multilabel: boolean;
  zarr_url: string;
  color: [number, number, number, number] | null;
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

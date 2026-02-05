/**
 * API client for the copick-web server.
 */

import type {
  ConfigResponse,
  PickableObjectResponse,
  RunSummaryResponse,
  RunDetailResponse,
  TomogramResponse,
  PicksSummaryResponse,
  PicksDetailResponse,
  SegmentationSummaryResponse,
} from "./types";

const API_BASE = "/api";

async function fetchJson<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error ${response.status}: ${error}`);
  }
  return response.json();
}

export const api = {
  // Config endpoints
  getConfig: () => fetchJson<ConfigResponse>("/config"),

  getObjects: () => fetchJson<PickableObjectResponse[]>("/objects"),

  // Run endpoints
  getRuns: () => fetchJson<RunSummaryResponse[]>("/runs"),

  getRun: (runName: string) => fetchJson<RunDetailResponse>(`/runs/${encodeURIComponent(runName)}`),

  // Tomogram endpoints
  getTomogram: (runName: string, voxelSize: number, tomoType: string) =>
    fetchJson<TomogramResponse>(
      `/runs/${encodeURIComponent(runName)}/voxel_spacings/${voxelSize}/tomograms/${encodeURIComponent(tomoType)}`
    ),

  // Picks endpoints
  getPicks: (runName: string) => fetchJson<PicksSummaryResponse[]>(`/runs/${encodeURIComponent(runName)}/picks`),

  getPickPoints: (runName: string, objectName: string, userId: string, sessionId: string) =>
    fetchJson<PicksDetailResponse>(
      `/runs/${encodeURIComponent(runName)}/picks/${encodeURIComponent(objectName)}/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`
    ),

  // Segmentation endpoints
  getSegmentations: (runName: string) =>
    fetchJson<SegmentationSummaryResponse[]>(`/runs/${encodeURIComponent(runName)}/segmentations`),
};

/**
 * API client for the copick-web server.
 */

import type {
  ConfigResponse,
  CreatePicksRequest,
  CreatePicksResponse,
  PickableObjectResponse,
  PicksDetailResponse,
  PicksSummaryResponse,
  RunDetailResponse,
  RunSummaryResponse,
  SegmentationSummaryResponse,
  TomogramResponse,
  UpdatePicksRequest,
} from "./types";

const API_BASE = `${import.meta.env.BASE_URL}api`;

async function fetchJson<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error ${response.status}: ${error}`);
  }
  return response.json();
}

async function postJson<T, R>(endpoint: string, data: T): Promise<R> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error ${response.status}: ${error}`);
  }
  return response.json();
}

async function putJson<T, R>(endpoint: string, data: T): Promise<R> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error ${response.status}: ${error}`);
  }
  return response.json();
}

async function deleteRequest(endpoint: string): Promise<void> {
  const response = await fetch(`${API_BASE}${endpoint}`, { method: "DELETE" });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error ${response.status}: ${error}`);
  }
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

  // Picks mutation endpoints
  createPicks: (runName: string, data: CreatePicksRequest) =>
    postJson<CreatePicksRequest, CreatePicksResponse>(`/runs/${encodeURIComponent(runName)}/picks`, data),

  updatePicks: (runName: string, objectName: string, userId: string, sessionId: string, data: UpdatePicksRequest) =>
    putJson<UpdatePicksRequest, PicksDetailResponse>(
      `/runs/${encodeURIComponent(runName)}/picks/${encodeURIComponent(objectName)}/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`,
      data
    ),

  deletePicks: (runName: string, objectName: string, userId: string, sessionId: string) =>
    deleteRequest(
      `/runs/${encodeURIComponent(runName)}/picks/${encodeURIComponent(objectName)}/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`
    ),
};

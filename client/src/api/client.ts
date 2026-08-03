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
  ProjectSummaryResponse,
  RunDetailResponse,
  RunSummaryResponse,
  SegmentationSummaryResponse,
  TomogramResponse,
  UpdatePicksRequest,
} from "./types";

const API_BASE = `${import.meta.env.BASE_URL}api`;

const projectBase = (projectId: string) =>
  `/projects/${encodeURIComponent(projectId)}`;

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

async function postNoBody(endpoint: string): Promise<void> {
  const response = await fetch(`${API_BASE}${endpoint}`, { method: "POST" });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error ${response.status}: ${error}`);
  }
}

async function deleteRequest(endpoint: string): Promise<void> {
  const response = await fetch(`${API_BASE}${endpoint}`, { method: "DELETE" });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error ${response.status}: ${error}`);
  }
}

export const api = {
  // Project listing (no scope)
  getProjects: () => fetchJson<ProjectSummaryResponse[]>("/projects"),

  reloadProject: (projectId: string) =>
    postNoBody(`${projectBase(projectId)}/reload`),

  // Config endpoints
  getConfig: (projectId: string) =>
    fetchJson<ConfigResponse>(`${projectBase(projectId)}/config`),

  getObjects: (projectId: string) =>
    fetchJson<PickableObjectResponse[]>(`${projectBase(projectId)}/objects`),

  // Run endpoints
  getRuns: (projectId: string) =>
    fetchJson<RunSummaryResponse[]>(`${projectBase(projectId)}/runs`),

  getRun: (projectId: string, runName: string) =>
    fetchJson<RunDetailResponse>(
      `${projectBase(projectId)}/runs/${encodeURIComponent(runName)}`,
    ),

  // Tomogram endpoints
  getTomogram: (
    projectId: string,
    runName: string,
    voxelSize: number,
    tomoType: string,
  ) =>
    fetchJson<TomogramResponse>(
      `${projectBase(projectId)}/runs/${encodeURIComponent(runName)}/voxel_spacings/${voxelSize}/tomograms/${encodeURIComponent(tomoType)}`,
    ),

  // Picks endpoints
  getPicks: (projectId: string, runName: string) =>
    fetchJson<PicksSummaryResponse[]>(
      `${projectBase(projectId)}/runs/${encodeURIComponent(runName)}/picks`,
    ),

  getPickPoints: (
    projectId: string,
    runName: string,
    objectName: string,
    userId: string,
    sessionId: string,
  ) =>
    fetchJson<PicksDetailResponse>(
      `${projectBase(projectId)}/runs/${encodeURIComponent(runName)}/picks/${encodeURIComponent(objectName)}/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`,
    ),

  // Segmentation endpoints
  getSegmentations: (projectId: string, runName: string) =>
    fetchJson<SegmentationSummaryResponse[]>(
      `${projectBase(projectId)}/runs/${encodeURIComponent(runName)}/segmentations`,
    ),

  // Picks mutation endpoints
  createPicks: (projectId: string, runName: string, data: CreatePicksRequest) =>
    postJson<CreatePicksRequest, CreatePicksResponse>(
      `${projectBase(projectId)}/runs/${encodeURIComponent(runName)}/picks`,
      data,
    ),

  updatePicks: (
    projectId: string,
    runName: string,
    objectName: string,
    userId: string,
    sessionId: string,
    data: UpdatePicksRequest,
  ) =>
    putJson<UpdatePicksRequest, PicksDetailResponse>(
      `${projectBase(projectId)}/runs/${encodeURIComponent(runName)}/picks/${encodeURIComponent(objectName)}/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`,
      data,
    ),

  deletePicks: (
    projectId: string,
    runName: string,
    objectName: string,
    userId: string,
    sessionId: string,
  ) =>
    deleteRequest(
      `${projectBase(projectId)}/runs/${encodeURIComponent(runName)}/picks/${encodeURIComponent(objectName)}/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`,
    ),
};

/**
 * API client for the copick-web server.
 */

import type {
  ConfigResponse,
  FilamentsDetailResponse,
  FilamentsSummaryResponse,
  InstancesResponse,
  ObjectTypeFields,
  ObjectTypesResponse,
  SaveFilamentsRequest,
  SaveFilamentsResponse,
  SegmentationType,
  CreatePicksRequest,
  CreatePicksResponse,
  PickableObjectResponse,
  PicksDetailResponse,
  ReloadResponse,
  PicksSummaryResponse,
  RunDetailResponse,
  RunInfoResponse,
  RunSummaryResponse,
  SegmentationSummaryResponse,
  TomogramResponse,
  UpdatePicksRequest,
} from "./types";
import { decodeSurfacePoints, type SurfacePoints } from "@/utils/surfacePoints";

export const API_BASE = `${import.meta.env.BASE_URL}api`;

const enc = encodeURIComponent;

async function fetchJson<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error ${response.status}: ${error}`);
  }
  return response.json();
}

async function fetchBinary(endpoint: string): Promise<ArrayBuffer> {
  const response = await fetch(`${API_BASE}${endpoint}`);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error ${response.status}: ${error}`);
  }
  return response.arrayBuffer();
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

/** An API error with the server's status and message (FastAPI's `detail`). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

async function requestJson<R>(
  method: string,
  endpoint: string,
  data?: unknown,
): Promise<R> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers:
      data === undefined ? undefined : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!response.ok) {
    const text = await response.text();
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed?.detail === "string") detail = parsed.detail;
      else if (Array.isArray(parsed?.detail))
        detail = parsed.detail.map((d: { msg?: string }) => d.msg).join("; ");
    } catch {
      /* not JSON */
    }
    throw new ApiError(response.status, detail || response.statusText);
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

  /** Re-open the project on the server, so runs, tomograms and annotations added since show up. */
  reloadProject: () => requestJson<ReloadResponse>("POST", "/reload"),

  // Object types (configuration editing)
  getObjectTypes: () =>
    requestJson<ObjectTypesResponse>("GET", "/object-types"),

  createObjectType: (version: string, fields: ObjectTypeFields) =>
    requestJson<ObjectTypesResponse>("POST", "/object-types", {
      version,
      ...fields,
    }),

  updateObjectType: (version: string, name: string, fields: ObjectTypeFields) =>
    requestJson<ObjectTypesResponse>("PUT", `/object-types/${enc(name)}`, {
      version,
      ...fields,
    }),

  deleteObjectType: (version: string, name: string) =>
    requestJson<ObjectTypesResponse>(
      "DELETE",
      `/object-types/${enc(name)}?version=${enc(version)}`,
    ),

  // Run endpoints
  getRuns: () => fetchJson<RunSummaryResponse[]>("/runs"),

  getRunInfo: (runName: string) =>
    fetchJson<RunInfoResponse>(`/runs/${enc(runName)}/info`),

  getRun: (runName: string) =>
    fetchJson<RunDetailResponse>(`/runs/${encodeURIComponent(runName)}`),

  // Tomogram endpoints
  getTomogram: (runName: string, voxelSize: number, tomoType: string) =>
    fetchJson<TomogramResponse>(
      `/runs/${encodeURIComponent(runName)}/voxel_spacings/${voxelSize}/tomograms/${encodeURIComponent(tomoType)}`,
    ),

  // Picks endpoints
  getPicks: (runName: string) =>
    fetchJson<PicksSummaryResponse[]>(
      `/runs/${encodeURIComponent(runName)}/picks`,
    ),

  getPickPoints: (
    runName: string,
    objectName: string,
    userId: string,
    sessionId: string,
  ) =>
    fetchJson<PicksDetailResponse>(
      `/runs/${encodeURIComponent(runName)}/picks/${encodeURIComponent(objectName)}/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`,
    ),

  // Segmentation endpoints
  getSegmentations: (runName: string) =>
    fetchJson<SegmentationSummaryResponse[]>(
      `/runs/${encodeURIComponent(runName)}/segmentations`,
    ),

  getInstances: (
    runName: string,
    segType: SegmentationType,
    name: string,
    userId: string,
    sessionId: string,
    voxelSize: number,
    level = 1,
  ) =>
    fetchJson<InstancesResponse>(
      `/runs/${enc(runName)}/segmentations/${segType}/${enc(name)}/${enc(userId)}/${enc(sessionId)}/${voxelSize}/instances?level=${level}`,
    ),

  /** Boundary voxels of a segmentation, for the 3D view. */
  getSurfacePoints: async (
    runName: string,
    segType: SegmentationType,
    name: string,
    userId: string,
    sessionId: string,
    voxelSize: number,
  ): Promise<SurfacePoints> =>
    decodeSurfacePoints(
      await fetchBinary(
        `/runs/${enc(runName)}/segmentations/${segType}/${enc(name)}/${enc(userId)}/${enc(sessionId)}/${voxelSize}/surface`,
      ),
    ),

  // Filaments endpoints
  getFilaments: (runName: string) =>
    fetchJson<FilamentsSummaryResponse[]>(`/runs/${enc(runName)}/filaments`),

  getFilamentDetail: (
    runName: string,
    objectName: string,
    userId: string,
    sessionId: string,
  ) =>
    fetchJson<FilamentsDetailResponse>(
      `/runs/${enc(runName)}/filaments/${enc(objectName)}/${enc(userId)}/${enc(sessionId)}`,
    ),

  saveFilaments: (
    runName: string,
    objectName: string,
    userId: string,
    sessionId: string,
    data: SaveFilamentsRequest,
  ) =>
    requestJson<SaveFilamentsResponse>(
      "PUT",
      `/runs/${enc(runName)}/filaments/${enc(objectName)}/${enc(userId)}/${enc(sessionId)}`,
      data,
    ),

  deleteFilaments: (
    runName: string,
    objectName: string,
    userId: string,
    sessionId: string,
  ) =>
    requestJson<{ deleted: boolean }>(
      "DELETE",
      `/runs/${enc(runName)}/filaments/${enc(objectName)}/${enc(userId)}/${enc(sessionId)}`,
    ),

  // Picks mutation endpoints
  createPicks: (runName: string, data: CreatePicksRequest) =>
    postJson<CreatePicksRequest, CreatePicksResponse>(
      `/runs/${encodeURIComponent(runName)}/picks`,
      data,
    ),

  updatePicks: (
    runName: string,
    objectName: string,
    userId: string,
    sessionId: string,
    data: UpdatePicksRequest,
  ) =>
    putJson<UpdatePicksRequest, PicksDetailResponse>(
      `/runs/${encodeURIComponent(runName)}/picks/${encodeURIComponent(objectName)}/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`,
      data,
    ),

  deletePicks: (
    runName: string,
    objectName: string,
    userId: string,
    sessionId: string,
  ) =>
    deleteRequest(
      `/runs/${encodeURIComponent(runName)}/picks/${encodeURIComponent(objectName)}/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`,
    ),
};

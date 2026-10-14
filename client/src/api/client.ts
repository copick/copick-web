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
  ProjectSummaryResponse,
  RunDetailResponse,
  RunInfoResponse,
  RunSummaryResponse,
  SegmentationSummaryResponse,
  TomogramResponse,
  UpdatePicksRequest,
} from "./types";
import { decodeSurfacePoints, type SurfacePoints } from "@/utils/surfacePoints";

/**
 * Where the app is served from, found at runtime: index.html sets the document's base to the app root (the page URL
 * without its client route, e.g. `projects/<id>/`), so one build runs under any URL prefix, such as Open OnDemand's
 * /rnode/<host>/<port>/ or a reverse proxy's /viewer/copick-web/.
 */
export const APP_BASE = appBaseOf(
  typeof document === "undefined" ? "http://localhost/" : document.baseURI,
);

/** The app root for a document base URL: its directory (with or without `index.html`). */
export function appBaseOf(pageUrl: string): URL {
  return new URL(".", pageUrl);
}

/** Absolute URL of a path relative to the app root (e.g. the `zarr_url` of a tomogram); a leading slash is ignored. */
export function appUrl(path: string, base: URL = APP_BASE): string {
  return new URL(path.replace(/^\/+/, ""), base).href;
}

export const API_BASE = appUrl("api");

const enc = encodeURIComponent;

/** API path prefix of a project's routes. */
const project = (projectId: string) => `/projects/${enc(projectId)}`;

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

/** Path of a run's routes in a project. */
const run = (projectId: string, runName: string) =>
  `${project(projectId)}/runs/${enc(runName)}`;

/** Path of one segmentation (type, name, user, session, voxel size) in a run. */
const segmentation = (
  projectId: string,
  runName: string,
  segType: SegmentationType,
  name: string,
  userId: string,
  sessionId: string,
  voxelSize: number,
) =>
  `${run(projectId, runName)}/segmentations/${segType}/${enc(name)}/${enc(userId)}/${enc(sessionId)}/${voxelSize}`;

/** Path of one annotation set (object, user, session) of a kind (`picks`, `filaments`) in a run. */
const annotation = (
  projectId: string,
  runName: string,
  kind: "picks" | "filaments",
  objectName: string,
  userId: string,
  sessionId: string,
) =>
  `${run(projectId, runName)}/${kind}/${enc(objectName)}/${enc(userId)}/${enc(sessionId)}`;

export const api = {
  // Project listing (no scope)
  getProjects: () => fetchJson<ProjectSummaryResponse[]>("/projects"),

  // Config endpoints
  getConfig: (projectId: string) =>
    fetchJson<ConfigResponse>(`${project(projectId)}/config`),

  getObjects: (projectId: string) =>
    fetchJson<PickableObjectResponse[]>(`${project(projectId)}/objects`),

  /** Re-open the project on the server, so runs, tomograms and annotations added since show up. */
  reloadProject: (projectId: string) =>
    requestJson<ReloadResponse>("POST", `${project(projectId)}/reload`),

  // Object types (configuration editing)
  getObjectTypes: (projectId: string) =>
    requestJson<ObjectTypesResponse>(
      "GET",
      `${project(projectId)}/object-types`,
    ),

  createObjectType: (
    projectId: string,
    version: string,
    fields: ObjectTypeFields,
  ) =>
    requestJson<ObjectTypesResponse>(
      "POST",
      `${project(projectId)}/object-types`,
      { version, ...fields },
    ),

  updateObjectType: (
    projectId: string,
    version: string,
    name: string,
    fields: ObjectTypeFields,
  ) =>
    requestJson<ObjectTypesResponse>(
      "PUT",
      `${project(projectId)}/object-types/${enc(name)}`,
      { version, ...fields },
    ),

  deleteObjectType: (projectId: string, version: string, name: string) =>
    requestJson<ObjectTypesResponse>(
      "DELETE",
      `${project(projectId)}/object-types/${enc(name)}?version=${enc(version)}`,
    ),

  // Run endpoints
  getRuns: (projectId: string) =>
    fetchJson<RunSummaryResponse[]>(`${project(projectId)}/runs`),

  getRunInfo: (projectId: string, runName: string) =>
    fetchJson<RunInfoResponse>(`${run(projectId, runName)}/info`),

  getRun: (projectId: string, runName: string) =>
    fetchJson<RunDetailResponse>(run(projectId, runName)),

  /** URL of a run's gallery thumbnail (PNG). */
  runThumbnailUrl: (projectId: string, runName: string, size: number) =>
    `${API_BASE}${run(projectId, runName)}/thumbnail?size=${size}`,

  // Tomogram endpoints
  getTomogram: (
    projectId: string,
    runName: string,
    voxelSize: number,
    tomoType: string,
  ) =>
    fetchJson<TomogramResponse>(
      `${run(projectId, runName)}/voxel_spacings/${voxelSize}/tomograms/${enc(tomoType)}`,
    ),

  // Picks endpoints
  getPicks: (projectId: string, runName: string) =>
    fetchJson<PicksSummaryResponse[]>(`${run(projectId, runName)}/picks`),

  getPickPoints: (
    projectId: string,
    runName: string,
    objectName: string,
    userId: string,
    sessionId: string,
  ) =>
    fetchJson<PicksDetailResponse>(
      annotation(projectId, runName, "picks", objectName, userId, sessionId),
    ),

  // Segmentation endpoints
  getSegmentations: (projectId: string, runName: string) =>
    fetchJson<SegmentationSummaryResponse[]>(
      `${run(projectId, runName)}/segmentations`,
    ),

  getInstances: (
    projectId: string,
    runName: string,
    segType: SegmentationType,
    name: string,
    userId: string,
    sessionId: string,
    voxelSize: number,
    level = 1,
  ) =>
    fetchJson<InstancesResponse>(
      `${segmentation(projectId, runName, segType, name, userId, sessionId, voxelSize)}/instances?level=${level}`,
    ),

  /** Boundary voxels of a segmentation, for the 3D view. */
  getSurfacePoints: async (
    projectId: string,
    runName: string,
    segType: SegmentationType,
    name: string,
    userId: string,
    sessionId: string,
    voxelSize: number,
  ): Promise<SurfacePoints> =>
    decodeSurfacePoints(
      await fetchBinary(
        `${segmentation(projectId, runName, segType, name, userId, sessionId, voxelSize)}/surface`,
      ),
    ),

  // Filaments endpoints
  getFilaments: (projectId: string, runName: string) =>
    fetchJson<FilamentsSummaryResponse[]>(
      `${run(projectId, runName)}/filaments`,
    ),

  getFilamentDetail: (
    projectId: string,
    runName: string,
    objectName: string,
    userId: string,
    sessionId: string,
  ) =>
    fetchJson<FilamentsDetailResponse>(
      annotation(
        projectId,
        runName,
        "filaments",
        objectName,
        userId,
        sessionId,
      ),
    ),

  saveFilaments: (
    projectId: string,
    runName: string,
    objectName: string,
    userId: string,
    sessionId: string,
    data: SaveFilamentsRequest,
  ) =>
    requestJson<SaveFilamentsResponse>(
      "PUT",
      annotation(
        projectId,
        runName,
        "filaments",
        objectName,
        userId,
        sessionId,
      ),
      data,
    ),

  deleteFilaments: (
    projectId: string,
    runName: string,
    objectName: string,
    userId: string,
    sessionId: string,
  ) =>
    requestJson<{ deleted: boolean }>(
      "DELETE",
      annotation(
        projectId,
        runName,
        "filaments",
        objectName,
        userId,
        sessionId,
      ),
    ),

  // Picks mutation endpoints
  createPicks: (projectId: string, runName: string, data: CreatePicksRequest) =>
    postJson<CreatePicksRequest, CreatePicksResponse>(
      `${run(projectId, runName)}/picks`,
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
      annotation(projectId, runName, "picks", objectName, userId, sessionId),
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
      annotation(projectId, runName, "picks", objectName, userId, sessionId),
    ),
};

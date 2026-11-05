/**
 * CellCanvas learning client: a server-side binding ties the opened copick reconstruction to a CellCanvas core
 * dataset. Painting is saved into a copick segmentation (0 = unannotated); train/predict run in the core under an
 * operation ID chosen here, so a lost response is retried with the same ID instead of starting new work. A
 * prediction is shown only after the server reports it published complete.
 */

import { API_BASE } from "./client";

export interface CellCanvasClass {
  id: number;
  name: string;
  color?: [number, number, number] | null;
}

export interface SegmentationRef {
  name: string;
  user_id: string;
  session_id: string;
}

export interface CellCanvasBinding {
  id: string;
  run: string;
  voxel_size: number;
  tomo_type: string;
  classes: CellCanvasClass[];
  painting: SegmentationRef;
  prediction: SegmentationRef;
  features: Record<string, unknown>;
}

export interface Publication {
  exists?: boolean;
  complete?: boolean;
  operation_id?: string;
  prediction_version?: number;
  painting_revision?: string | null;
  published_at?: number;
}

export interface OperationRecord {
  id: string;
  kind: "train" | "predict";
  state:
    | "running"
    | "unknown"
    | "succeeded"
    | "failed"
    | "lost"
    | "not_submitted"
    | "rejected";
  painting_revision?: string | null;
  error?: { message?: string; error?: string; code?: string } | string | null;
  publication?: Publication;
}

export interface OperationState {
  pending: OperationRecord | null;
  last: OperationRecord | null;
  published: Publication;
}

export interface BindingStatus {
  binding: CellCanvasBinding;
  check: {
    ok: boolean;
    problems: string[];
    copick: {
      shape: number[];
      scale_angstrom: number[];
      translation_angstrom: number[];
    };
  };
  core: {
    service_id: string;
    trained: boolean;
    busy: boolean;
    model_painting_revision: string | null;
    painting: { revision: string | null };
  } | null;
  painting: { exists: boolean; revision: string | null };
  operation: OperationState;
}

export interface Stroke {
  label: number;
  radius: number;
  plane: "XY" | "XZ" | "YZ";
  /** Voxel indices (x, y, z). */
  points: [number, number, number][];
}

export class CellCanvasError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "CellCanvasError";
  }
}

const base = (projectId: string) =>
  `${API_BASE}/projects/${encodeURIComponent(projectId)}/cellcanvas/bindings`;

async function call<R>(url: string, body?: unknown): Promise<R> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await response.text();
  let data: { detail?: unknown; code?: string } | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!response.ok) {
    const detail =
      typeof data?.detail === "string"
        ? data.detail
        : text || response.statusText;
    throw new CellCanvasError(response.status, data?.code, detail);
  }
  return data as R;
}

export const cellcanvasApi = {
  list: (projectId: string, run: string, voxelSize: number, tomoType: string) =>
    call<{ bindings: CellCanvasBinding[] }>(
      `${base(projectId)}?${new URLSearchParams({
        run,
        voxel_size: String(voxelSize),
        tomo_type: tomoType,
      })}`,
    ),
  status: (projectId: string, id: string) =>
    call<BindingStatus>(`${base(projectId)}/${encodeURIComponent(id)}`),
  paint: (
    projectId: string,
    id: string,
    baseRevision: string | null,
    strokes: Stroke[],
  ) =>
    call<{ revision: string; changed_voxels: number }>(
      `${base(projectId)}/${encodeURIComponent(id)}/painting`,
      { base_revision: baseRevision, strokes },
    ),
  submit: (
    projectId: string,
    id: string,
    kind: "train" | "predict",
    operationId: string,
  ) =>
    call<OperationState>(
      `${base(projectId)}/${encodeURIComponent(id)}/${kind}`,
      {
        operation_id: operationId,
      },
    ),
  operation: (projectId: string, id: string) =>
    call<OperationState>(
      `${base(projectId)}/${encodeURIComponent(id)}/operation`,
    ),
};

/** Voxels on the segment from `a` to `b` (inclusive, deduplicated), so a fast drag leaves no gaps. */
export function strokeSegment(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number][] {
  const steps = Math.max(...a.map((v, i) => Math.abs(b[i] - v)));
  const points: [number, number, number][] = [];
  for (let s = 0; s <= steps; s++) {
    const t = steps === 0 ? 0 : s / steps;
    const p = a.map((v, i) => Math.round(v + (b[i] - v) * t)) as [
      number,
      number,
      number,
    ];
    const last = points[points.length - 1];
    if (!last || last.some((v, i) => v !== p[i])) points.push(p);
  }
  return points;
}

/** Split a stroke into requests within the server's per-request point bound. */
export function chunkStroke(stroke: Stroke, maxPoints = 4096): Stroke[] {
  const chunks: Stroke[] = [];
  for (let i = 0; i < stroke.points.length; i += maxPoints)
    chunks.push({ ...stroke, points: stroke.points.slice(i, i + maxPoints) });
  return chunks;
}

/**
 * Whether the bound reconstruction is the opened one: same voxel grid and spacing. Painting is refused otherwise.
 * `axes` are the viewer's x, y, z axes in world units; `angstromPerUnit` converts them.
 */
export function geometryMatches(
  copick: BindingStatus["check"]["copick"],
  axes: { size: number; scale: number; translation: number }[],
  angstromPerUnit: number,
): boolean {
  const zyx = [...axes].reverse();
  return zyx.every(
    (axis, i) =>
      axis.size === copick.shape[i] &&
      Math.abs(axis.scale * angstromPerUnit - copick.scale_angstrom[i]) <
        1e-3 &&
      Math.abs(
        axis.translation * angstromPerUnit - copick.translation_angstrom[i],
      ) < 1e-2,
  );
}

/** A new complete publication to display (not a repeat of one already shown, never an incomplete one). */
export function newPublication(
  shownOperation: string | null,
  published: Publication | undefined,
): string | null {
  if (!published?.complete || !published.operation_id) return null;
  return published.operation_id === shownOperation
    ? null
    : published.operation_id;
}

export function describeOperation(state: OperationState | undefined): string {
  if (!state) return "";
  const op = state.pending ?? state.last;
  if (!op) return "";
  const what = op.kind === "train" ? "Training" : "Prediction";
  const error =
    typeof op.error === "string"
      ? op.error
      : (op.error?.message ?? op.error?.error ?? "");
  switch (op.state) {
    case "running":
      return `${what} running…`;
    case "unknown":
      return `${what} status unknown (service unreachable); will reconcile the same operation.`;
    case "succeeded":
      return op.kind === "train"
        ? "Model trained on the saved painting."
        : `Prediction v${op.publication?.prediction_version ?? "?"} published.`;
    case "failed":
      return `${what} failed: ${error}. The previous published prediction is unchanged.`;
    case "lost":
      return `${what} lost: the CellCanvas service restarted. Train again.`;
    case "not_submitted":
      return `${what} was not accepted by the service; submit again.`;
    case "rejected":
      return `${what} refused: ${error}`;
  }
}

/** Remember an operation ID before submitting it, so a reload retries the same one. */
export const pendingOperation = {
  key: (projectId: string, bindingId: string) =>
    `cellcanvas-op:${projectId}:${bindingId}`,
  get(
    projectId: string,
    bindingId: string,
  ): { id: string; kind: "train" | "predict" } | null {
    try {
      return JSON.parse(
        localStorage.getItem(this.key(projectId, bindingId)) ?? "null",
      );
    } catch {
      return null;
    }
  },
  set(
    projectId: string,
    bindingId: string,
    value: { id: string; kind: "train" | "predict" } | null,
  ) {
    if (value)
      localStorage.setItem(
        this.key(projectId, bindingId),
        JSON.stringify(value),
      );
    else localStorage.removeItem(this.key(projectId, bindingId));
  },
};

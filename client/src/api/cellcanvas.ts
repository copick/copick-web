/**
 * CellCanvas learning client: a server-side binding ties the opened copick reconstruction to a CellCanvas core
 * dataset. Painting is saved into a copick segmentation (0 = unannotated); train/predict run in the core under an
 * operation ID chosen here, so a lost response is retried with the same ID instead of starting new work. A
 * prediction is shown only after the server reports it published complete. Predict can be limited to a region (the
 * current slice or a slab around it): the core predicts only that region and the server rewrites only the storage
 * chunks it touches, so a full-resolution reconstruction is predicted in seconds instead of a whole-volume run.
 */

import { API_BASE } from "./client";
import { call, type Box3, type Painter, type Stroke } from "./annotations";

export {
  ApiError as CellCanvasError,
  chunkStroke,
  geometryMatches,
  strokeSegment,
} from "./annotations";
export type { Stroke } from "./annotations";

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

/** A predict region in z, y, x voxel indices, half-open; missing axes span the volume. */
export type PredictRegion = Partial<Record<"z" | "y" | "x", [number, number]>>;

export interface Publication {
  exists?: boolean;
  complete?: boolean;
  operation_id?: string;
  prediction_version?: number;
  painting_revision?: string | null;
  published_at?: number;
  /** Region of the latest prediction (absent for a whole-volume one). */
  region?: Required<PredictRegion>;
  /** Regions of the current model shown together (each region prediction of the same model accumulates). */
  regions?: Required<PredictRegion>[];
  /** Voxel box (x, y, z) of the chunks the latest region publication rewrote. */
  changed_region?: Box3;
  /** The region publication started a new store (none before, or one of another format); reopen it. */
  new_store?: boolean;
}

/** Which part of the volume Predict covers. */
export type PredictExtent = "slice" | "slab" | "volume";

/** Voxels above which Predict defaults to the current slice and whole-volume prediction is not offered. */
export const WHOLE_VOLUME_VOXELS = 64 * 1024 * 1024;
export const SLAB_DEPTH = 16;

/** The region Predict sends: the slice at `z`, a `SLAB_DEPTH` slab centred on it, or nothing (the volume). */
export function predictRegion(
  extent: PredictExtent,
  z: number,
  depth: number,
): PredictRegion | null {
  if (extent === "volume") return null;
  const half = extent === "slab" ? Math.floor(SLAB_DEPTH / 2) : 0;
  const size = extent === "slab" ? Math.min(SLAB_DEPTH, depth) : 1;
  const start = Math.max(0, Math.min(depth - size, z - half));
  return { z: [start, start + size] };
}

export function describeRegion(region?: PredictRegion | null): string {
  if (!region?.z) return "volume";
  const [a, b] = region.z;
  return b - a === 1 ? `slice z=${a}` : `slices z=${a}–${b - 1}`;
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
  region?: Required<PredictRegion>;
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
  painting: { exists: boolean; revision: string | null; can_undo: boolean };
  operation: OperationState;
}

const base = (projectId: string) =>
  `${API_BASE}/projects/${encodeURIComponent(projectId)}/cellcanvas/bindings`;

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
    strokeId?: string,
  ) =>
    call<{
      revision: string | null;
      changed_voxels: number;
      can_undo: boolean;
    }>(`${base(projectId)}/${encodeURIComponent(id)}/painting`, {
      base_revision: baseRevision,
      strokes,
      stroke_id: strokeId,
    }),
  undo: (projectId: string, id: string, baseRevision: string | null) =>
    call<{ revision: string; changed_voxels: number; can_undo: boolean }>(
      `${base(projectId)}/${encodeURIComponent(id)}/undo`,
      { base_revision: baseRevision },
    ),
  /** The binding's painting, restricted to its classes (accepting also goes through the binding). */
  painter: (projectId: string, id: string): Painter => ({
    paint: (baseRevision, strokes, strokeId) =>
      cellcanvasApi.paint(projectId, id, baseRevision, strokes, strokeId),
    undo: (baseRevision) => cellcanvasApi.undo(projectId, id, baseRevision),
    accept: (baseRevision, proposal, proposalLabel, label, box) =>
      call(`${base(projectId)}/${encodeURIComponent(id)}/accept`, {
        base_revision: baseRevision,
        proposal: proposal.ref,
        proposal_label: proposalLabel,
        proposal_digest: proposal.digest,
        label,
        box: box ?? null,
      }),
  }),
  submit: (
    projectId: string,
    id: string,
    kind: "train" | "predict",
    operationId: string,
    region?: PredictRegion | null,
  ) =>
    call<OperationState>(
      `${base(projectId)}/${encodeURIComponent(id)}/${kind}`,
      {
        operation_id: operationId,
        ...(region ? { region } : {}),
      },
    ),
  operation: (projectId: string, id: string) =>
    call<OperationState>(
      `${base(projectId)}/${encodeURIComponent(id)}/operation`,
    ),
};

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
      return op.kind === "predict"
        ? `Predicting ${describeRegion(op.region)}…`
        : `${what} running…`;
    case "unknown":
      return `${what} status unknown (service unreachable); will reconcile the same operation.`;
    case "succeeded":
      return op.kind === "train"
        ? "Model trained on the saved painting."
        : `Prediction v${op.publication?.prediction_version ?? "?"} of the ${describeRegion(op.publication?.region)} published.`;
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

interface Remembered {
  id: string;
  kind: "train" | "predict";
  region?: PredictRegion | null;
}

/** Remember an operation (ID and region) before submitting it, so a reload retries the same one. */
export const pendingOperation = {
  key: (projectId: string, bindingId: string) =>
    `cellcanvas-op:${projectId}:${bindingId}`,
  get(projectId: string, bindingId: string): Remembered | null {
    try {
      return JSON.parse(
        localStorage.getItem(this.key(projectId, bindingId)) ?? "null",
      );
    } catch {
      return null;
    }
  },
  set(projectId: string, bindingId: string, value: Remembered | null) {
    if (value)
      localStorage.setItem(
        this.key(projectId, bindingId),
        JSON.stringify(value),
      );
    else localStorage.removeItem(this.key(projectId, bindingId));
  },
};

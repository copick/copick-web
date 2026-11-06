/**
 * CellCanvas learning client: a server-side binding ties the opened copick reconstruction to a CellCanvas core
 * dataset. Painting is saved into a copick segmentation (0 = unannotated); train/predict run in the core under an
 * operation ID chosen here, so a lost response is retried with the same ID instead of starting new work. A
 * prediction is shown only after the server reports it published complete.
 */

import { API_BASE } from "./client";
import { call, type Painter, type Stroke } from "./annotations";

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

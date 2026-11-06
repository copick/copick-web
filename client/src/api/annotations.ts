/**
 * Painting a copick multilabel segmentation and accepting completed proposals into it; no learning backend needed.
 *
 * 0 is unknown (never annotated) and erasing returns voxels to it; classes are positive IDs, so background is always
 * an explicit class. Every change names the revision it was based on and is refused (409) when the painting changed
 * since. A proposal (model output in its own segmentation) is accepted only while it matches its producer's
 * completion record, and it fills only unknown voxels: human labels are kept.
 *
 * Optional backends are listed by `backends()`: CellCanvas (see `./cellcanvas`) and nnInteractive prompts, whose
 * results are published as proposals.
 */

import { API_BASE } from "./client";

export interface Stroke {
  label: number;
  radius: number;
  plane: "XY" | "XZ" | "YZ";
  /** Voxel indices (x, y, z). */
  points: [number, number, number][];
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** What each refusal `code` from the annotation and CellCanvas routes means to the person painting. */
const REFUSALS: Record<string, string> = {
  geometry_mismatch:
    "The painting or proposal is on a different voxel grid from this reconstruction.",
  revision_conflict: "The painting or proposal changed since it was loaded.",
  not_complete:
    "That segmentation is not a completed proposal yet; wait for it to finish.",
  nothing_to_undo: "Nothing to undo.",
  busy: "Another save to this painting is in progress; try again in a moment.",
  not_found:
    "The reconstruction or proposal is no longer in the copick project.",
  invalid_request:
    "The edit was refused: check the class, brush size and proposal label.",
  no_painting: "Paint at least one class before training.",
  operation_pending: "Another operation is pending; wait for it to finish.",
  operation_conflict:
    "That operation ID was already used for different work; submit again.",
  not_ready: "The completed prediction is no longer readable; predict again.",
  invalid_prediction:
    "The prediction has classes outside this binding's class range.",
  unsupported_storage:
    "Publishing the prediction needs a local copick overlay filesystem.",
  service_unavailable: "The CellCanvas service is unreachable.",
  backend_unavailable: "The nnInteractive server is unreachable.",
  backend_error: "The nnInteractive server failed on this request.",
  session_lost: "The nnInteractive session ended; start a new one.",
  refused: "The nnInteractive server refused this prompt.",
  unsupported_project: "nnInteractive needs a local copick project config.",
};

/** The message to show for a refusal: worded from its `code`, else the server's `detail`. */
export function refusalMessage(code: string | undefined, detail: string) {
  return (code && REFUSALS[code]) || detail;
}

export async function call<R>(
  url: string,
  body?: unknown,
  method?: "GET" | "POST" | "DELETE",
): Promise<R> {
  const response = await fetch(url, {
    method: method ?? (body === undefined ? "GET" : "POST"),
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
    throw new ApiError(
      response.status,
      data?.code,
      refusalMessage(data?.code, detail),
    );
  }
  return data as R;
}

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

export interface SegmentationRef {
  name: string;
  user_id: string;
  session_id: string;
}

/** A painted segmentation of one reconstruction. */
export interface PaintTarget {
  run: string;
  voxel_size: number;
  tomo_type: string;
  painting: SegmentationRef;
}

export interface PaintClass {
  id: number;
  name: string;
  color?: number[] | null;
}

/** Full-resolution grid of a reconstruction (z, y, x; Å). */
export interface Grid {
  shape: number[];
  scale_angstrom: number[];
  translation_angstrom: number[];
}

export interface PaintingState {
  grid?: Grid;
  exists: boolean;
  revision: string | null;
  can_undo: boolean;
  shape?: number[];
  classes?: PaintClass[];
}

export interface Saved {
  revision: string | null;
  changed_voxels: number;
  can_undo: boolean;
}

export interface ProposalRecord {
  ref: SegmentationRef;
  complete: true;
  producer: string;
  digest: string;
  current?: boolean;
  label?: number;
  prompt?: Record<string, unknown>;
}

export interface Accepted extends Saved {
  kept_human_voxels: number;
  source: Record<string, unknown>;
}

/** Half-open voxel box `[[x0, x1], [y0, y1], [z0, z1]]`. */
export type Box3 = [[number, number], [number, number], [number, number]];

export interface Backends {
  painting: true;
  cellcanvas: boolean;
  nninteractive: {
    available: boolean;
    needs_local_project?: boolean;
    code?: string;
  };
}

export interface PromptResult {
  changed_region: Box3 | null;
  proposal: ProposalRecord;
  written_voxels: number;
}

/** Saves and undo of one painting, by whichever route owns it (generic or a CellCanvas binding). */
export interface Painter {
  paint(
    baseRevision: string | null,
    strokes: Stroke[],
    strokeId?: string,
  ): Promise<Saved>;
  undo(baseRevision: string | null): Promise<Saved>;
  accept(
    baseRevision: string | null,
    proposal: ProposalRecord,
    proposalLabel: number,
    label: number,
    box?: Box3 | null,
  ): Promise<Accepted>;
}

const project = (projectId: string) =>
  `${API_BASE}/projects/${encodeURIComponent(projectId)}`;

const query = (target: PaintTarget, extra: Record<string, string> = {}) =>
  new URLSearchParams({
    run: target.run,
    voxel_size: String(target.voxel_size),
    tomo_type: target.tomo_type,
    ...target.painting,
    ...extra,
  });

export const annotationsApi = {
  backends: (projectId: string) =>
    call<Backends>(`${project(projectId)}/backends`),
  state: (projectId: string, target: PaintTarget) =>
    call<PaintingState>(`${project(projectId)}/painting?${query(target)}`),
  proposal: (
    projectId: string,
    target: PaintTarget,
    proposal: SegmentationRef,
  ) =>
    call<ProposalRecord>(
      `${project(projectId)}/painting/proposal?${query(target, {
        proposal_name: proposal.name,
        proposal_user_id: proposal.user_id,
        proposal_session_id: proposal.session_id,
      })}`,
    ),
  painter: (projectId: string, target: PaintTarget): Painter => ({
    paint: (baseRevision, strokes, strokeId) =>
      call<Saved>(`${project(projectId)}/painting/strokes`, {
        ...target,
        base_revision: baseRevision,
        strokes,
        stroke_id: strokeId,
      }),
    undo: (baseRevision) =>
      call<Saved>(`${project(projectId)}/painting/undo`, {
        ...target,
        base_revision: baseRevision,
      }),
    accept: (baseRevision, proposal, proposalLabel, label, box) =>
      call<Accepted>(`${project(projectId)}/painting/accept`, {
        ...target,
        base_revision: baseRevision,
        proposal: proposal.ref,
        proposal_label: proposalLabel,
        proposal_digest: proposal.digest,
        label,
        box: box ?? null,
      }),
  }),
};

/** nnInteractive prompts on the target's reconstruction; each result is published to `proposal` as `proposalLabel`. */
export const nninteractiveApi = {
  open: (projectId: string, target: PaintTarget) =>
    call<{ session_id: string; shape: number[]; supports_undo: boolean }>(
      `${project(projectId)}/nninteractive/sessions`,
      target,
    ),
  prompt: (
    projectId: string,
    sessionId: string,
    target: PaintTarget,
    proposal: SegmentationRef,
    proposalLabel: number,
    prompt:
      | { label: number; box: Box3 }
      | { point: [number, number, number]; include: boolean },
  ) =>
    call<PromptResult>(
      `${project(projectId)}/nninteractive/sessions/${encodeURIComponent(sessionId)}/prompt`,
      {
        ...target,
        proposal,
        proposal_label: proposalLabel,
        ...prompt,
      },
    ),
  undo: (
    projectId: string,
    sessionId: string,
    target: PaintTarget,
    proposal: SegmentationRef,
    proposalLabel: number,
  ) =>
    call<PromptResult>(
      `${project(projectId)}/nninteractive/sessions/${encodeURIComponent(sessionId)}/undo`,
      {
        ...target,
        proposal,
        proposal_label: proposalLabel,
      },
    ),
  close: (projectId: string, sessionId: string) =>
    call<null>(
      `${project(projectId)}/nninteractive/sessions/${encodeURIComponent(sessionId)}`,
      undefined,
      "DELETE",
    ),
};

/** Box around a stroke's points, grown by `margin` voxels in its plane and `depth` across it, clipped to `shape` (x, y, z). */
export function strokeBox(
  stroke: Stroke,
  shape: [number, number, number],
  margin = 16,
  depth = 4,
): Box3 {
  const across = { XY: 2, XZ: 1, YZ: 0 }[stroke.plane];
  return [0, 1, 2].map((axis) => {
    const values = stroke.points.map((p) => p[axis]);
    const grow = axis === across ? depth : margin + Math.ceil(stroke.radius);
    return [
      Math.max(0, Math.min(...values) - grow),
      Math.min(shape[axis], Math.max(...values) + grow + 1),
    ];
  }) as Box3;
}

/**
 * Whether a server-side grid is the opened one: same voxel grid, spacing and origin. Painting is refused otherwise.
 * `axes` are the viewer's x, y, z axes in world units; `angstromPerUnit` converts them.
 */
export function geometryMatches(
  grid: Grid,
  axes: { size: number; scale: number; translation: number }[],
  angstromPerUnit: number,
): boolean {
  const zyx = [...axes].reverse();
  return zyx.every(
    (axis, i) =>
      axis.size === grid.shape[i] &&
      Math.abs(axis.scale * angstromPerUnit - grid.scale_angstrom[i]) < 1e-3 &&
      Math.abs(
        axis.translation * angstromPerUnit - grid.translation_angstrom[i],
      ) < 1e-2,
  );
}

/** Painting target fixed by an embedding host (`?paint_name=&paint_user=&paint_session=`), if any. */
export function hostPaintingRef(
  search = window.location.search,
): SegmentationRef | null {
  const params = new URLSearchParams(search);
  const name = params.get("paint_name");
  const user = params.get("paint_user");
  const session = params.get("paint_session");
  return name && user && session
    ? { name, user_id: user, session_id: session }
    : null;
}

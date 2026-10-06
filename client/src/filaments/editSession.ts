/**
 * Editing state of one filament set in the browser: the web counterpart of
 * copick-shared-ui's FilamentEditSession (napari-copick, chimerax-copick).
 *
 * The state is immutable: every edit returns a new state, so an undo step is
 * just the state before it. Curves are regenerated with the TypeScript port of
 * copick's algorithm for the preview; saving sends the curves and copick
 * regenerates the stored points.
 *
 * Rules (as in the desktop viewers):
 * - a filament with fewer than two control points is "pending" (not drawn, not saved);
 * - B-spline fits keep their knots: their control points move but can't be added
 *   or removed until converted to Catmull-Rom;
 * - filaments loaded without a curve are saved as their points until edited.
 */

import type { FilamentResponse, FilamentWrite } from "@/api/types";
import {
  controlPointsFromPolyline,
  editableCurve,
  evaluateCurve,
  reverseCurve,
  type FilamentCurve,
  type XYZ,
} from "./curves";
import {
  editableHandles,
  insertControlPoint,
  nearestOnPolyline,
  splitControlPoints,
  splitPolyline,
  type InsertMode,
} from "./editing";

export interface EditFilament {
  instanceId: number;
  /** The curve the points come from; null for a filament loaded without one and not edited since. */
  curve: FilamentCurve | null;
  /** The centreline (Å), regenerated from `curve`. */
  points: XYZ[];
  polarityKnown: boolean;
  score: number;
  radius: number | null;
  metadata: Record<string, unknown>;
}

export interface EditState {
  filaments: ReadonlyMap<number, EditFilament>;
  /** Control points of filaments with fewer than two. */
  pending: ReadonlyMap<number, XYZ[]>;
  activeId: number;
}

export interface EditContext {
  /** Arc-length spacing of new curves (Å): the tomogram's voxel size. */
  step: number;
  /** The object's radius (Å), for new filaments. */
  radius: number | null;
}

export interface Handles {
  controls: XYZ[];
  kind: string;
  canAddRemove: boolean;
}

/** Undo steps kept. */
export const MAX_HISTORY = 200;

const handleCache = new WeakMap<EditFilament, Handles>();

/** The handles an editor shows for a filament (its curve's control points, or ones derived from its points). */
export function handlesOf(f: EditFilament): Handles {
  let h = handleCache.get(f);
  if (!h) {
    h = editableHandles(f.points, f.curve);
    handleCache.set(f, h);
  }
  return h;
}

export function stateFromResponse(filaments: FilamentResponse[]): EditState {
  const map = new Map<number, EditFilament>();
  for (const f of filaments) {
    if (f.points.length < 2) continue;
    map.set(f.instance_id, {
      instanceId: f.instance_id,
      curve: (f.curve as FilamentCurve | null | undefined) ?? null,
      points: f.points.map((p) => [p[0], p[1], p[2]] as XYZ),
      polarityKnown: f.polarity_known,
      score: f.score,
      radius: f.radius,
      metadata: f.metadata ?? {},
    });
  }
  const ids = [...map.keys()];
  return {
    filaments: map,
    pending: new Map(),
    activeId: ids.length ? Math.min(...ids) : 1,
  };
}

export function ids(state: EditState): number[] {
  return [
    ...new Set([...state.filaments.keys(), ...state.pending.keys()]),
  ].sort((a, b) => a - b);
}

export function nextId(state: EditState): number {
  const all = ids(state);
  return all.length ? Math.max(...all) + 1 : 1;
}

/** Control points of a filament (pending ones included); empty if it does not exist. */
export function controls(state: EditState, id: number): XYZ[] {
  const pending = state.pending.get(id);
  if (pending) return pending.map((p) => [...p] as XYZ);
  const f = state.filaments.get(id);
  return f ? handlesOf(f).controls.map((p) => [...p] as XYZ) : [];
}

export function canAddRemove(state: EditState, id: number): boolean {
  const f = state.filaments.get(id);
  return !f || handlesOf(f).canAddRemove;
}

export function kindOf(state: EditState, id: number): string | null {
  const f = state.filaments.get(id);
  return f ? handlesOf(f).kind : state.pending.has(id) ? "catmull-rom" : null;
}

function withFilaments(
  state: EditState,
  update: (
    filaments: Map<number, EditFilament>,
    pending: Map<number, XYZ[]>,
  ) => void,
  activeId = state.activeId,
): EditState {
  const filaments = new Map(state.filaments);
  const pending = new Map(state.pending);
  update(filaments, pending);
  return { filaments, pending, activeId };
}

function regenerated(f: EditFilament, curve: FilamentCurve): EditFilament {
  return { ...f, curve, points: evaluateCurve(curve) };
}

/** Replace the control points of one filament (creating it if new). Fewer than two points keep it pending. */
export function setControls(
  state: EditState,
  ctx: EditContext,
  id: number,
  cps: XYZ[],
): EditState {
  return withFilaments(state, (filaments, pending) => {
    const existing = filaments.get(id);
    if (cps.length === 0) {
      filaments.delete(id);
      pending.delete(id);
    } else if (cps.length < 2) {
      filaments.delete(id);
      pending.set(id, cps);
    } else if (existing) {
      // Keep the curve's kind and own step (as copick's with_control_points); a B-spline keeps its knots.
      const base = editableCurve(existing.points, existing.curve);
      if (base.kind === "bspline" && cps.length !== base.control_points.length)
        throw new Error(
          `Filament ${id} is a B-spline fit; convert it to Catmull-Rom to add or remove points.`,
        );
      filaments.set(
        id,
        regenerated(existing, { ...base, control_points: cps }),
      );
    } else {
      pending.delete(id);
      const curve: FilamentCurve = {
        kind: "catmull-rom",
        control_points: cps,
        step: ctx.step,
        alpha: 0.5,
      };
      filaments.set(id, {
        instanceId: id,
        curve,
        points: evaluateCurve(curve),
        polarityKnown: false,
        score: 1,
        radius: ctx.radius,
        metadata: {},
      });
    }
  });
}

const addRemoveError = (id: number) =>
  new Error(
    `Filament ${id} is a B-spline fit; convert it to Catmull-Rom to add or remove points.`,
  );

/** Insert a control point into the active filament; returns the new state and the point's index. */
export function insertPoint(
  state: EditState,
  ctx: EditContext,
  point: XYZ,
  mode: InsertMode,
): { state: EditState; index: number } {
  const id = state.activeId;
  if (!canAddRemove(state, id)) throw addRemoveError(id);
  const { controls: cps, index } = insertControlPoint(
    controls(state, id),
    point,
    mode,
  );
  return { state: setControls(state, ctx, id, cps), index };
}

export function movePoint(
  state: EditState,
  ctx: EditContext,
  id: number,
  index: number,
  point: XYZ,
): EditState {
  const cps = controls(state, id);
  if (index < 0 || index >= cps.length) return state;
  cps[index] = point;
  return setControls(state, ctx, id, cps);
}

export function removePoint(
  state: EditState,
  ctx: EditContext,
  id: number,
  index: number,
): EditState {
  if (!canAddRemove(state, id)) throw addRemoveError(id);
  const cps = controls(state, id);
  cps.splice(index, 1);
  return setControls(state, ctx, id, cps);
}

/** Start a new, empty filament; unchanged if the active one is already new and empty. */
export function newFilament(state: EditState): EditState {
  const id = nextId(state);
  return id === state.activeId ? state : { ...state, activeId: id };
}

export function setActive(state: EditState, id: number): EditState {
  return id === state.activeId ? state : { ...state, activeId: id };
}

export function deleteFilament(state: EditState, id: number): EditState {
  if (!state.filaments.has(id) && !state.pending.has(id)) return state;
  const next = withFilaments(state, (filaments, pending) => {
    filaments.delete(id);
    pending.delete(id);
  });
  const remaining = ids(next);
  return id === state.activeId
    ? { ...next, activeId: remaining[0] ?? 1 }
    : next;
}

export function reverse(state: EditState, id: number): EditState {
  const f = state.filaments.get(id);
  const p = state.pending.get(id);
  if (!f && !p) return state;
  return withFilaments(state, (filaments, pending) => {
    if (f) {
      filaments.set(
        id,
        f.curve === null
          ? { ...f, points: [...f.points].reverse() }
          : regenerated(f, reverseCurve(editableCurve(f.points, f.curve))),
      );
    } else if (p) pending.set(id, [...p].reverse());
  });
}

/** Make a B-spline (or any curve) editable with add / remove: Catmull-Rom handles derived from its points. */
export function convertToCatmullRom(state: EditState, id: number): EditState {
  const f = state.filaments.get(id);
  if (!f) return state;
  const curve = editableCurve(f.points, f.curve, ["catmull-rom"]);
  return withFilaments(state, (filaments) =>
    filaments.set(id, regenerated(f, curve)),
  );
}

/** The filament whose centreline passes closest to `point`, if any. */
export function nearestFilament(
  state: EditState,
  point: XYZ,
): { id: number; distance: number } | null {
  let best: { id: number; distance: number } | null = null;
  for (const [id, f] of state.filaments) {
    const { distance } = nearestOnPolyline(f.points, point);
    if (!best || distance < best.distance) best = { id, distance };
  }
  return best;
}

/**
 * Cut a filament in two where its centreline passes closest to `point`.
 * The first piece keeps the ID, the second gets the next free one (never the
 * active empty filament's); both keep the filament's other fields.
 */
export function cut(
  state: EditState,
  ctx: EditContext,
  point: XYZ,
  tolerance: number,
): { state: EditState; pieces: [number, number] } {
  const near = nearestFilament(state, point);
  if (!near || near.distance > tolerance)
    throw new Error("Click closer to a filament to cut it.");
  const f = state.filaments.get(near.id)!;
  const curve = f.curve;
  const step = curve?.step ?? ctx.step;
  const h = handlesOf(f);
  let pieces: [XYZ[], XYZ[]];
  let kind = "catmull-rom";
  if (h.canAddRemove) {
    kind = h.kind === "linear" ? "linear" : "catmull-rom";
    pieces = splitControlPoints(h.controls, f.points, point, step);
  } else {
    const [a, b] = splitPolyline(f.points, point, step);
    pieces = [
      controlPointsFromPolyline(a, step / 2),
      controlPointsFromPolyline(b, step / 2),
    ];
  }
  const alpha = curve?.alpha ?? 0.5;
  let newId = nextId(state);
  if (newId === state.activeId) newId += 1; // the active filament is a new, still empty one
  const next = withFilaments(state, (filaments) => {
    ([near.id, newId] as const).forEach((id, i) => {
      const c: FilamentCurve = {
        kind,
        control_points: pieces[i],
        step,
        alpha: kind === "catmull-rom" ? alpha : null,
      };
      filaments.set(id, {
        ...f,
        instanceId: id,
        curve: c,
        points: evaluateCurve(c),
      });
    });
  });
  return { state: next, pieces: [near.id, newId] };
}

/** The filaments to store (pending ones are left out), in ID order. */
export function toSaveRequest(state: EditState): FilamentWrite[] {
  return [...state.filaments.values()]
    .sort((a, b) => a.instanceId - b.instanceId)
    .map((f) => ({
      instance_id: f.instanceId,
      ...(f.curve !== null
        ? { curve: f.curve as FilamentWrite["curve"] }
        : { points: f.points }),
      polarity_known: f.polarityKnown,
      score: f.score,
      radius: f.radius,
      metadata: f.metadata,
    }));
}

// --- Undo history ----------------------------------------------------------------------------------------------

export interface HistoryStep {
  label: string;
  state: EditState;
}

export interface History {
  state: EditState;
  undo: HistoryStep[];
  redo: HistoryStep[];
}

export function historyOf(state: EditState): History {
  return { state, undo: [], redo: [] };
}

/** Record `next` as one undo step (nothing if unchanged). */
export function record(
  history: History,
  label: string,
  next: EditState,
): History {
  if (next === history.state) return history;
  return {
    state: next,
    undo: [...history.undo, { label, state: history.state }].slice(
      -MAX_HISTORY,
    ),
    redo: [],
  };
}

export function undo(history: History): History {
  const step = history.undo[history.undo.length - 1];
  if (!step) return history;
  return {
    state: step.state,
    undo: history.undo.slice(0, -1),
    redo: [...history.redo, { label: step.label, state: history.state }],
  };
}

export function redo(history: History): History {
  const step = history.redo[history.redo.length - 1];
  if (!step) return history;
  return {
    state: step.state,
    undo: [...history.undo, { label: step.label, state: history.state }],
    redo: history.redo.slice(0, -1),
  };
}

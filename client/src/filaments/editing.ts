/**
 * Editing helpers on control points and centrelines: a port of
 * `copick_shared_ui.util.filaments` (insert, project, split), so the web editor
 * behaves like the napari and ChimeraX tracers.
 */

import { editableCurve, type FilamentCurve, type XYZ } from "./curves";

export type InsertMode = "append" | "prepend" | "nearest";

/** The curve kinds the editor shows handles for. */
export const EDITABLE_KINDS = ["catmull-rom", "linear", "bspline"] as const;

const sub = (a: XYZ, b: XYZ): XYZ => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: XYZ, b: XYZ): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a: XYZ, b: XYZ): number => Math.hypot(...sub(a, b));
const along = (a: XYZ, d: XYZ, t: number): XYZ => [
  a[0] + t * d[0],
  a[1] + t * d[1],
  a[2] + t * d[2],
];
const clip01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * Insert `point` into an ordered control-point list: after the last, before
 * the first, or into the segment it is closest to (before the first or after
 * the last if it lies beyond an end).
 */
export function insertControlPoint(
  controls: XYZ[],
  point: XYZ,
  mode: InsertMode,
): { controls: XYZ[]; index: number } {
  let index: number;
  if (mode === "prepend") index = 0;
  else if (mode === "append" || (mode === "nearest" && controls.length < 2))
    index = controls.length;
  else if (mode === "nearest") {
    const ts: number[] = [];
    let seg = 0;
    let best = Infinity;
    for (let i = 0; i + 1 < controls.length; i++) {
      const ab = sub(controls[i + 1], controls[i]);
      const denom = dot(ab, ab) || 1;
      const t = dot(sub(point, controls[i]), ab) / denom;
      ts.push(t);
      const d = dist(along(controls[i], ab, clip01(t)), point);
      if (d < best) {
        best = d;
        seg = i;
      }
    }
    if (seg === 0 && ts[0] < 0) index = 0;
    else if (seg === ts.length - 1 && ts[ts.length - 1] > 1)
      index = controls.length;
    else index = seg + 1;
  } else throw new Error(`Unknown insert mode '${mode}'`);
  const out = controls.slice();
  out.splice(index, 0, [point[0], point[1], point[2]]);
  return { controls: out, index };
}

/** Cumulative arc lengths of a polyline (0 at its start). */
export function arcLengths(points: XYZ[]): number[] {
  const s = [0];
  for (let i = 1; i < points.length; i++)
    s.push(s[i - 1] + dist(points[i], points[i - 1]));
  return s;
}

/**
 * The point of a polyline closest to `query`. `fromArcLength` only considers
 * the polyline from that arc length on (keeps projections of successive
 * points in order on a filament that passes close to itself).
 */
export function nearestOnPolyline(
  points: XYZ[],
  query: XYZ,
  fromArcLength = 0,
): { s: number; point: XYZ; distance: number } {
  const s0 = arcLengths(points);
  let best = { s: 0, point: points[0], distance: Infinity };
  let first = true;
  for (let i = 0; i + 1 < points.length; i++) {
    const d = sub(points[i + 1], points[i]);
    const segLen = Math.hypot(...d);
    const safe = segLen > 0 ? segLen : 1;
    let t = dot(sub(query, points[i]), d) / (safe * safe);
    const tMin = clip01((fromArcLength - s0[i]) / safe);
    t = clip01(Math.max(t, tMin));
    const closest = along(points[i], d, t);
    const distance =
      s0[i] + segLen < fromArcLength ? Infinity : dist(closest, query);
    // argmin: the first segment wins ties (also when every distance is infinite)
    if (first || distance < best.distance) {
      best = { s: s0[i] + t * segLen, point: closest, distance };
      first = false;
    }
  }
  return best;
}

/**
 * Split the control points of an interpolating curve (Catmull-Rom, linear) at
 * a point on its centreline. The cut point ends the first piece and starts the
 * second; a cut within `minGap` (arc length) of a control point splits there.
 *
 * @throws If a piece would have fewer than two control points.
 */
export function splitControlPoints(
  controls: XYZ[],
  polyline: XYZ[],
  cut: XYZ,
  minGap: number,
): [XYZ[], XYZ[]] {
  const { s: sCut, point: at } = nearestOnPolyline(polyline, cut);
  const sCps: number[] = [];
  let sPrev = 0;
  for (const c of controls) {
    sPrev = nearestOnPolyline(polyline, c, sPrev).s;
    sCps.push(sPrev);
  }
  let first: XYZ[];
  let second: XYZ[];
  let k = -1;
  let nearest = Infinity;
  sCps.forEach((s, i) => {
    const gap = Math.abs(s - sCut);
    if (gap < minGap && gap < nearest) {
      nearest = gap;
      k = i;
    }
  });
  if (k >= 0) {
    first = controls.slice(0, k + 1);
    second = controls.slice(k);
  } else {
    k = sCps.filter((s) => s < sCut).length - 1; // last control point before the cut
    first = [...controls.slice(0, k + 1), at];
    second = [at, ...controls.slice(k + 1)];
  }
  if (first.length < 2 || second.length < 2)
    throw new Error("The cut is too close to an end of the filament.");
  return [first, second];
}

/**
 * Split a polyline at the point closest to `cut`; both pieces include it.
 *
 * @throws If a piece would be shorter than `minGap`.
 */
export function splitPolyline(
  polyline: XYZ[],
  cut: XYZ,
  minGap: number,
): [XYZ[], XYZ[]] {
  const { s: sCut, point: at } = nearestOnPolyline(polyline, cut);
  const s = arcLengths(polyline);
  if (sCut < minGap || s[s.length - 1] - sCut < minGap)
    throw new Error("The cut is too close to an end of the filament.");
  return [
    [...polyline.filter((_, i) => s[i] < sCut), at],
    [at, ...polyline.filter((_, i) => s[i] > sCut)],
  ];
}

/**
 * The handles an editor shows for a filament: its current curve of a known
 * kind, otherwise Catmull-Rom handles derived from its points. A B-spline keeps
 * its knots, so its handles can be moved but not added or removed.
 */
export function editableHandles(
  points: XYZ[],
  curve: FilamentCurve | null,
): { controls: XYZ[]; kind: string; canAddRemove: boolean } {
  const editable = editableCurve(points, curve, EDITABLE_KINDS);
  return {
    controls: editable.control_points.map((p) => [p[0], p[1], p[2]] as XYZ),
    kind: editable.kind,
    canAddRemove: editable.kind !== "bspline",
  };
}

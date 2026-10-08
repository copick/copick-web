/**
 * Pure geometry for drawing filaments (ordered centrelines) as dense points.
 * Coordinates are world units; nothing here depends on idetik.
 */

import type { XYZ } from "./coordinates";

/** Insert evenly spaced vertices so that consecutive points are at most `maxStep` apart. */
export function densify(points: readonly XYZ[], maxStep: number): XYZ[] {
  if (points.length === 0) return [];
  if (!(maxStep > 0)) return points.map((p) => [...p] as XYZ);
  const out: XYZ[] = [[...points[0]] as XYZ];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const steps = Math.max(1, Math.ceil(length / maxStep));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      out.push([
        a[0] + t * (b[0] - a[0]),
        a[1] + t * (b[1] - a[1]),
        a[2] + t * (b[2] - a[2]),
      ]);
    }
  }
  return out;
}

export interface SlabSample {
  position: XYZ;
  /** Signed distance from the slice along the slice axis. */
  distance: number;
}

/** Samples within `halfThickness` of the slice `slice` along axis `w`. */
export function slabSamples(
  dense: readonly XYZ[],
  w: number,
  slice: number,
  halfThickness: number,
): SlabSample[] {
  const out: SlabSample[] = [];
  for (const p of dense) {
    const distance = p[w] - slice;
    if (Math.abs(distance) <= halfThickness)
      out.push({ position: p, distance });
  }
  return out;
}

/**
 * Points where the polyline crosses the plane `p[w] === slice`. Each segment
 * is half-open so a vertex lying exactly on the plane is reported once.
 */
export function planeCrossings(
  points: readonly XYZ[],
  w: number,
  slice: number,
): XYZ[] {
  const out: XYZ[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const da = a[w] - slice;
    const db = b[w] - slice;
    const crosses = (da < 0 && db >= 0) || (db < 0 && da >= 0);
    if (!crosses) continue;
    const t = da / (da - db);
    out.push([
      a[0] + t * (b[0] - a[0]),
      a[1] + t * (b[1] - a[1]),
      a[2] + t * (b[2] - a[2]),
    ]);
  }
  return out;
}

/** `n` points on a circle of `radius` around `center` in the plane spanned by axes `u` and `v`. */
export function ringPoints(
  center: XYZ,
  u: number,
  v: number,
  radius: number,
  n = 32,
): XYZ[] {
  const out: XYZ[] = [];
  for (let k = 0; k < n; k++) {
    const angle = (2 * Math.PI * k) / n;
    const p = [...center] as XYZ;
    p[u] += radius * Math.cos(angle);
    p[v] += radius * Math.sin(angle);
    out.push(p);
  }
  return out;
}

/** Opacity of a slab sample: 1 on the slice, fading linearly to `min` at the slab edge. */
export function slabAlpha(
  distance: number,
  halfThickness: number,
  min = 0.15,
): number {
  if (!(halfThickness > 0)) return 1;
  const t = Math.min(1, Math.abs(distance) / halfThickness);
  return 1 - t * (1 - min);
}

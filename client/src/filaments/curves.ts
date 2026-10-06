/**
 * Filament curves: a port of copick's reference implementation
 * (`copick.util.filaments` and `CopickFilamentCurve`), so the editor can
 * regenerate centrelines while tracing. Constants and tie-breaking follow core
 * exactly; the server still regenerates every saved filament through copick.
 */

export type XYZ = [number, number, number];
export type CurveKind = "catmull-rom" | "linear" | "bspline";

export interface FilamentCurve {
  kind: CurveKind | string;
  control_points: XYZ[];
  step: number;
  alpha?: number | null;
  degree?: number | null;
  knots?: number[] | null;
  smoothing?: number | null;
}

/** The curve kinds copick evaluates. */
export const KNOWN_KINDS: readonly CurveKind[] = [
  "catmull-rom",
  "linear",
  "bspline",
];

/** Minimum number of samples per segment or knot span of the fine polyline. */
export const MIN_SAMPLES = 16;
/** Samples of the fine polyline per `step` of segment (or control polygon) length. */
export const SAMPLES_PER_STEP = 16;
/** Consecutive Catmull-Rom and linear control points must be further apart than this (Å). */
export const MIN_POINT_DISTANCE = 1e-6;
/** A curve is current while its anchors lie within this fraction of `step` of the stored points. */
export const CURRENT_FRACTION = 0.01;
/** Highest B-spline degree. */
export const MAX_DEGREE = 5;

// --- vector helpers ---------------------------------------------------------

const sub = (a: XYZ, b: XYZ): XYZ => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: XYZ): number => Math.hypot(a[0], a[1], a[2]);
const dist = (a: XYZ, b: XYZ): number => norm(sub(a, b));
const dot = (a: XYZ, b: XYZ): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp = (a: XYZ, b: XYZ, wa: number, wb: number, d: number): XYZ => [
  (wa * a[0] + wb * b[0]) / d,
  (wa * a[1] + wb * b[1]) / d,
  (wa * a[2] + wb * b[2]) / d,
];
const isKnown = (kind: string): kind is CurveKind =>
  (KNOWN_KINDS as readonly string[]).includes(kind);
const copy = (p: XYZ): XYZ => [p[0], p[1], p[2]];

// --- validation -------------------------------------------------------------

/** Refuse a curve that cannot be evaluated (throws like `check_curve`). */
export function checkCurve(curve: FilamentCurve): void {
  const { kind, step } = curve;
  if (!isKnown(kind))
    throw new Error(
      `Unknown curve kind '${kind}'; this copick evaluates ${KNOWN_KINDS.join(", ")}.`,
    );
  const points = curve.control_points;
  if (!points.every((p) => p.every(Number.isFinite)))
    throw new Error("Curve control points must be finite.");
  if (!(Number.isFinite(step) && step > 0))
    throw new Error(
      `Curve step must be a positive number of Angstrom, not ${step}.`,
    );

  if (kind === "catmull-rom" || kind === "linear") {
    if (points.length < 2)
      throw new Error(`A ${kind} curve needs at least two control points.`);
    for (let i = 0; i + 1 < points.length; i++) {
      if (dist(points[i + 1], points[i]) <= MIN_POINT_DISTANCE)
        throw new Error(
          `Control points ${i} and ${i + 1} coincide; consecutive control points must be distinct.`,
        );
    }
    const alpha = curve.alpha;
    if (
      kind === "catmull-rom" &&
      alpha !== null &&
      alpha !== undefined &&
      !(alpha >= 0 && alpha <= 1)
    )
      throw new Error(
        `Catmull-Rom alpha must be between 0 and 1, not ${alpha}.`,
      );
    return;
  }

  const degree = curve.degree;
  const knots = curve.knots;
  if (degree === null || degree === undefined || !knots)
    throw new Error("A bspline curve needs a degree and knots.");
  if (!Number.isInteger(degree) || degree < 1 || degree > MAX_DEGREE)
    throw new Error(
      `B-spline degree must be an integer from 1 to ${MAX_DEGREE}, not ${degree}.`,
    );
  const p = degree;
  const n = points.length;
  if (n < p + 1)
    throw new Error(
      `A degree ${p} B-spline needs at least ${p + 1} control points, got ${n}.`,
    );
  const u = knots;
  if (u.length !== n + p + 1)
    throw new Error(
      `A degree ${p} B-spline with ${n} control points needs ${n + p + 1} knots, got ${u.length}.`,
    );
  if (!u.every(Number.isFinite))
    throw new Error("B-spline knots must be finite.");
  for (let i = 0; i + 1 < u.length; i++)
    if (u[i + 1] - u[i] < 0)
      throw new Error("B-spline knots must be non-decreasing.");
  const first = u[0];
  const last = u[u.length - 1];
  const clamped =
    u.slice(0, p + 1).every((x) => x === first) &&
    u.slice(-(p + 1)).every((x) => x === last) &&
    last > first;
  if (!clamped)
    throw new Error(
      `B-spline knots must be clamped: the first and the last ${p + 1} knots equal.`,
    );
  if (u[p + 1] === first || u[u.length - (p + 2)] === last)
    throw new Error(`B-spline end knots must repeat exactly ${p + 1} times.`);
  const counts = new Map<number, number>();
  for (const x of u.slice(p + 1, n)) counts.set(x, (counts.get(x) ?? 0) + 1);
  if ([...counts.values()].some((c) => c > p))
    throw new Error(`Interior B-spline knots may repeat at most ${p} times.`);
}

// --- evaluation -------------------------------------------------------------

/** `m` samples of the Catmull-Rom segment from q[1] to q[2] (Barry-Goldman), without its end. */
function catmullRomSamples(q: XYZ[], alpha: number, m: number): XYZ[] {
  const t = [0];
  for (let j = 0; j < 3; j++) t.push(t[j] + dist(q[j + 1], q[j]) ** alpha);
  const out: XYZ[] = [];
  for (let k = 0; k < m; k++) {
    const tt = t[1] + ((t[2] - t[1]) * k) / m;
    const a = [0, 1, 2].map((j) =>
      lerp(q[j], q[j + 1], t[j + 1] - tt, tt - t[j], t[j + 1] - t[j]),
    );
    const b0 = lerp(a[0], a[1], t[2] - tt, tt - t[0], t[2] - t[0]);
    const b1 = lerp(a[1], a[2], t[3] - tt, tt - t[1], t[3] - t[1]);
    out.push(lerp(b0, b1, t[2] - tt, tt - t[1], t[2] - t[1]));
  }
  return out;
}

/** The knot span j (degree <= j <= n - 1) holding u; the last non-empty span at the end. */
function span(knots: number[], degree: number, n: number, u: number): number {
  if (u >= knots[n]) {
    let j = n - 1;
    while (knots[j] >= knots[j + 1]) j--;
    return j;
  }
  let count = 0; // searchsorted(side="right"): knots <= u
  while (count < knots.length && knots[count] <= u) count++;
  return Math.min(Math.max(count - 1, degree), n - 1);
}

/** The B-spline at parameter u in span j, by de Boor's algorithm. */
function deBoor(
  c: XYZ[],
  knots: number[],
  degree: number,
  j: number,
  u: number,
): XYZ {
  const p = degree;
  const d = c.slice(j - p, j + 1).map(copy);
  for (let r = 1; r <= p; r++) {
    for (let i = p; i >= r; i--) {
      const lo = knots[j - p + i];
      const hi = knots[j + 1 + i - r];
      const a = (u - lo) / (hi - lo);
      d[i] = [
        (1 - a) * d[i - 1][0] + a * d[i][0],
        (1 - a) * d[i - 1][1] + a * d[i][1],
        (1 - a) * d[i - 1][2] + a * d[i][2],
      ];
    }
  }
  return d[p];
}

function bsplineAt(c: XYZ[], knots: number[], degree: number, u: number): XYZ {
  return deBoor(c, knots, degree, span(knots, degree, c.length, u), u);
}

function finePieces(
  points: XYZ[],
  step: number,
  kind: string,
  alpha: number,
  degree: number | null,
  knots: number[] | null,
): XYZ[][] {
  const pieces: XYZ[][] = [];
  if (kind === "bspline") {
    const p = degree as number;
    const u = knots as number[];
    const n = points.length;
    for (let j = p; j < n; j++) {
      if (!(u[j] < u[j + 1])) continue;
      let polygon = 0;
      for (let i = j - p; i < j; i++) polygon += dist(points[i + 1], points[i]);
      const m = Math.max(
        MIN_SAMPLES,
        Math.ceil((SAMPLES_PER_STEP * polygon) / step),
      );
      const piece: XYZ[] = [];
      for (let k = 0; k < m; k++)
        piece.push(deBoor(points, u, p, j, u[j] + ((u[j + 1] - u[j]) * k) / m));
      piece.push(bsplineAt(points, u, p, u[j + 1]));
      pieces.push(piece);
    }
    return pieces;
  }
  const n = points.length;
  const extended: XYZ[] = [
    sub(points[0], sub(points[1], points[0])),
    ...points,
    sub(points[n - 1], sub(points[n - 2], points[n - 1])),
  ];
  for (let i = 0; i + 1 < n; i++) {
    const m = Math.max(
      MIN_SAMPLES,
      Math.ceil((SAMPLES_PER_STEP * dist(points[i + 1], points[i])) / step),
    );
    let samples: XYZ[];
    if (kind === "linear") {
      const d = sub(points[i + 1], points[i]);
      samples = [];
      for (let k = 0; k < m; k++) {
        const f = k / m;
        samples.push([
          points[i][0] + f * d[0],
          points[i][1] + f * d[1],
          points[i][2] + f * d[2],
        ]);
      }
    } else {
      samples = catmullRomSamples(extended.slice(i, i + 4), alpha, m);
      samples[0] = copy(points[i]); // the segment starts exactly at its control point
    }
    samples.push(copy(points[i + 1]));
    pieces.push(samples);
  }
  return pieces;
}

/** np.interp for increasing xp. */
function interp(x: number, xp: number[], fp: number[]): number {
  if (x <= xp[0]) return fp[0];
  const last = xp.length - 1;
  if (x >= xp[last]) return fp[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xp[mid] <= x) lo = mid;
    else hi = mid;
  }
  return fp[lo] + ((fp[hi] - fp[lo]) * (x - xp[lo])) / (xp[hi] - xp[lo]);
}

function resamplePiece(fine: XYZ[], step: number): XYZ[] {
  const kept: XYZ[] = [fine[0]];
  const s = [0];
  for (let i = 1; i < fine.length; i++) {
    const gap = dist(fine[i], fine[i - 1]);
    if (gap > 0) {
      kept.push(fine[i]);
      s.push(s[s.length - 1] + gap);
    }
  }
  const length = s[s.length - 1];
  if (length <= 0) return [];
  const n = Math.max(1, Math.ceil(length / step - 1e-9));
  const axes = [0, 1, 2].map((a) => kept.map((p) => p[a]));
  const out: XYZ[] = [];
  for (let k = 0; k < n; k++) {
    const target = k * (length / n);
    out.push([
      interp(target, s, axes[0]),
      interp(target, s, axes[1]),
      interp(target, s, axes[2]),
    ]);
  }
  out[0] = copy(kept[0]);
  return out;
}

/** The centreline points of a curve, from its start to its end, at most `step` apart (`evaluate_curve`). */
export function evaluateCurve(curve: FilamentCurve): XYZ[] {
  const alpha =
    curve.alpha === null || curve.alpha === undefined ? 0.5 : curve.alpha;
  checkCurve({ ...curve, alpha });
  const pieces = finePieces(
    curve.control_points,
    curve.step,
    curve.kind,
    alpha,
    curve.degree ?? null,
    curve.knots ?? null,
  );
  const resampled = pieces.map((piece) => resamplePiece(piece, curve.step));
  if (!resampled.some((r) => r.length))
    throw new Error("The curve has zero length.");
  const lastPiece = pieces[pieces.length - 1];
  return [...resampled.flat(), copy(lastPiece[lastPiece.length - 1])];
}

/** The points a curve passes through: its control points, or a B-spline at each distinct knot of its domain. */
export function curveAnchors(curve: FilamentCurve): XYZ[] {
  const points = curve.control_points;
  if (curve.kind !== "bspline") return points.map(copy);
  const u = curve.knots as number[];
  const p = curve.degree as number;
  const n = points.length;
  const values = [...new Set(u.slice(p, n + 1))].sort((a, b) => a - b);
  return values.map((value) => bsplineAt(points, u, p, value));
}

/** The distance of each query point to the nearest segment of `polyline`. */
export function distancesToPolyline(queries: XYZ[], polyline: XYZ[]): number[] {
  if (polyline.length === 1) return queries.map((q) => dist(q, polyline[0]));
  const segments = polyline.slice(0, -1).map((a, i) => {
    const ab = sub(polyline[i + 1], a);
    return { a, ab, ab2: Math.max(dot(ab, ab), 1e-30) };
  });
  return queries.map((q) => {
    let best = Infinity;
    for (const { a, ab, ab2 } of segments) {
      const t = Math.min(1, Math.max(0, dot(sub(q, a), ab) / ab2));
      const dx = q[0] - (a[0] + t * ab[0]);
      const dy = q[1] - (a[1] + t * ab[1]);
      const dz = q[2] - (a[2] + t * ab[2]);
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  });
}

/** Whether a curve still describes `points` (`curve_is_current`); never for an unknown kind. */
export function isCurrentFor(curve: FilamentCurve, points: XYZ[]): boolean {
  if (!isKnown(curve.kind) || points.length < 2) return false;
  let anchors: XYZ[];
  try {
    anchors = curveAnchors(curve);
    if (!anchors.length || anchors.some((a) => !a.every(Number.isFinite)))
      return false;
  } catch {
    return false;
  }
  const eps = CURRENT_FRACTION * curve.step;
  if (
    dist(points[0], anchors[0]) > eps ||
    dist(points[points.length - 1], anchors[anchors.length - 1]) > eps
  )
    return false;
  return distancesToPolyline(anchors, points).every((d) => d <= eps);
}

/**
 * Catmull-Rom (alpha 0.5) control points, chosen from `points`, whose curve
 * stays within `tolerance` of them (`control_points_from_polyline`).
 */
export function controlPointsFromPolyline(
  points: XYZ[],
  tolerance: number,
): XYZ[] {
  if (!(Number.isFinite(tolerance) && tolerance > 0))
    throw new Error(`Tolerance must be positive, not ${tolerance}.`);
  let line = points;
  if (line.length > 1)
    line = line.filter(
      (p, i) => i === 0 || dist(p, line[i - 1]) > MIN_POINT_DISTANCE,
    );
  if (line.length < 2)
    throw new Error("A filament needs at least two distinct points.");
  if (dist(line[line.length - 1], line[0]) <= MIN_POINT_DISTANCE)
    throw new Error(
      "The polyline ends where it starts; closed filaments are not supported.",
    );

  const chosen = [0, line.length - 1];
  for (;;) {
    const control = [...chosen].sort((a, b) => a - b).map((i) => copy(line[i]));
    const curve = evaluateCurve({
      kind: "catmull-rom",
      alpha: 0.5,
      control_points: control,
      step: tolerance,
    });
    const distance = distancesToPolyline(line, curve);
    let far = 0;
    for (let i = 1; i < distance.length; i++)
      if (distance[i] > distance[far]) far = i; // lowest index on ties
    if (distance[far] <= tolerance || chosen.includes(far)) return control;
    chosen.push(far);
  }
}

/** The median distance between consecutive points, or 0 for fewer than two. */
export function medianSpacing(points: XYZ[]): number {
  if (points.length < 2) return 0;
  const gaps = points
    .slice(1)
    .map((p, i) => dist(p, points[i]))
    .sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

/** The same curve traversed backwards (`CopickFilamentCurve.reversed`). */
export function reverseCurve(curve: FilamentCurve): FilamentCurve {
  const out: FilamentCurve = {
    ...curve,
    control_points: [...curve.control_points].reverse().map(copy),
  };
  if (curve.knots) {
    const u = curve.knots;
    const first = u[0];
    const last = u[u.length - 1];
    out.knots = u.map((x) => first + last - x).reverse();
  }
  if (
    out.kind === "catmull-rom" &&
    (out.alpha === null || out.alpha === undefined)
  )
    out.alpha = 0.5;
  if (isKnown(out.kind)) checkCurve(out);
  return out;
}

/**
 * The curve an editor should show (`CopickFilament.editable_curve`): the
 * filament's own if it is current and of one of `kinds`, otherwise a
 * Catmull-Rom curve derived from `points`.
 *
 * @param tolerance - Largest distance of the derived curve from `points` (Å); default half `step`.
 * @param step - Spacing of the derived curve's points; default the median spacing of `points`.
 */
export function editableCurve(
  points: XYZ[],
  curve: FilamentCurve | null,
  kinds: readonly string[] = KNOWN_KINDS,
  tolerance?: number,
  step?: number,
): FilamentCurve {
  if (curve && isCurrentFor(curve, points) && kinds.includes(curve.kind))
    return curve;
  let s = step;
  if (!s) {
    s = medianSpacing(points);
    if (s <= 0)
      throw new Error(
        "Cannot derive a step from coincident points; pass step.",
      );
  }
  return {
    kind: "catmull-rom",
    alpha: 0.5,
    control_points: controlPointsFromPolyline(points, tolerance || s / 2),
    step: s,
  };
}

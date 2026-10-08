import { describe, expect, test } from "vitest";
// Copied from copick tests/data/filament_curves.json (the normative reference cases).
import reference from "./__fixtures__/filament_curves.json";
import {
  checkCurve,
  controlPointsFromPolyline,
  curveAnchors,
  editableCurve,
  evaluateCurve,
  isCurrentFor,
  medianSpacing,
  reverseCurve,
  type FilamentCurve,
  type XYZ,
} from "./curves";

type Case = FilamentCurve & { name: string; points: XYZ[] };
const cases = reference.cases as unknown as Case[];
const cubic = cases.find((c) => c.name === "cubic B-spline")!;

function expectClose(actual: XYZ[], expected: XYZ[], tol: number) {
  expect(actual.length).toBe(expected.length);
  const worst = Math.max(
    ...actual.map((p, i) =>
      Math.hypot(
        p[0] - expected[i][0],
        p[1] - expected[i][1],
        p[2] - expected[i][2],
      ),
    ),
  );
  expect(worst).toBeLessThan(tol);
}

// Python: t = np.linspace(0, 1, 41); np.stack([t * 300, 40 * np.sin(t * 6), 10 * t], axis=1)
const SINE: XYZ[] = Array.from({ length: 41 }, (_, i) => {
  const t = i / 40;
  return [t * 300, 40 * Math.sin(t * 6), 10 * t];
});

describe("curve evaluation matches copick's reference cases", () => {
  test.each(cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    expectClose(evaluateCurve(c), c.points, 1e-3);
  });
});

describe("curves", () => {
  test("anchors of a B-spline are the curve at its distinct knots", () => {
    // Python: curve_anchors(cubic["control_points"], kind="bspline", degree=3, knots=cubic["knots"])
    expectClose(
      curveAnchors(cubic),
      [
        [0.0, 0.0, 0.0],
        [68.816327, 40.306122, 8.020408],
        [127.918367, -0.102041, 20.346939],
        [200.0, 30.0, 30.0],
      ],
      1e-5,
    );
    const linear = cases.find((c) => c.kind === "linear")!;
    expect(curveAnchors(linear)).toEqual(linear.control_points);
  });

  test("reversing a B-spline: reversed knots, reversed points, twice is the original", () => {
    const back = reverseCurve(cubic);
    // Python: reverse_knots(cubic["knots"])
    back.knots!.forEach((k, i) =>
      expect(k).toBeCloseTo([0, 0, 0, 0, 0.3, 0.7, 1, 1, 1, 1][i], 12),
    );
    expectClose(evaluateCurve(back), [...cubic.points].reverse(), 1e-6);
    const twice = reverseCurve(back);
    twice.knots!.forEach((k, i) => expect(k).toBeCloseTo(cubic.knots![i], 12));
    expect(twice.control_points).toEqual(cubic.control_points);
  });

  test("current curves describe their points; edited ones don't", () => {
    for (const c of cases) expect(isCurrentFor(c, c.points)).toBe(true);
    const moved: Case = {
      ...cubic,
      control_points: cubic.control_points.map((p, i) =>
        i === 2 ? ([p[0], p[1] + 20, p[2]] as XYZ) : p,
      ),
    };
    expect(isCurrentFor(moved, cubic.points)).toBe(false);
    expect(isCurrentFor({ ...cubic, kind: "nurbs" }, cubic.points)).toBe(false);
    expect(isCurrentFor({ ...cubic, knots: null }, cubic.points)).toBe(false);
  });

  test("control points derived from a polyline match core", () => {
    // Python: control_points_from_polyline(SINE, 2.0)
    expectClose(
      controlPointsFromPolyline(SINE, 2.0),
      [
        [0.0, 0.0, 0.0],
        [30.0, 22.585699, 1.0],
        [82.5, 39.874601, 2.75],
        [127.5, 22.307349, 4.25],
        [217.5, -37.402103, 7.25],
        [262.5, -34.35738, 8.75],
        [300.0, -11.17662, 10.0],
      ],
      1e-5,
    );
    expect(() => controlPointsFromPolyline(SINE, 0)).toThrow(/positive/);
    expect(() =>
      controlPointsFromPolyline(
        [
          [0, 0, 0],
          [0, 0, 0],
        ],
        1,
      ),
    ).toThrow(/two distinct/);
  });

  test("editable curve: the own curve if current, else derived Catmull-Rom handles", () => {
    expect(editableCurve(cubic.points, cubic)).toBe(cubic);
    const derived = editableCurve(cubic.points, cubic, ["catmull-rom"]);
    expect(derived.kind).toBe("catmull-rom");
    // Python: CopickFilament(instance_id=1, points=SINE).editable_curve()
    const sine = editableCurve(SINE, null);
    expect(sine.step).toBeCloseTo(8.544463613546437, 9);
    expectClose(
      sine.control_points,
      [
        [0.0, 0.0, 0.0],
        [82.5, 39.874601, 2.75],
        [217.5, -37.402103, 7.25],
        [262.5, -34.35738, 8.75],
        [300.0, -11.17662, 10.0],
      ],
      1e-5,
    );
  });

  test("median spacing", () => {
    // Python: median_spacing([[0,0,0],[1,0,0],[3,0,0],[6,0,0]]) == 2.0
    expect(
      medianSpacing([
        [0, 0, 0],
        [1, 0, 0],
        [3, 0, 0],
        [6, 0, 0],
      ]),
    ).toBe(2);
    expect(medianSpacing([[0, 0, 0]])).toBe(0);
  });

  test("invalid curves are refused like core", () => {
    const base: FilamentCurve = {
      kind: "catmull-rom",
      control_points: [
        [0, 0, 0],
        [10, 0, 0],
      ],
      step: 1,
    };
    expect(() => checkCurve({ ...base, kind: "nurbs" })).toThrow(
      /Unknown curve kind/,
    );
    expect(() => checkCurve({ ...base, step: 0 })).toThrow(/step/);
    expect(() => checkCurve({ ...base, control_points: [[0, 0, 0]] })).toThrow(
      /two control points/,
    );
    expect(() =>
      checkCurve({
        ...base,
        control_points: [
          [0, 0, 0],
          [0, 0, 0],
        ],
      }),
    ).toThrow(/coincide/);
    expect(() => checkCurve({ ...base, alpha: 2 })).toThrow(/alpha/);
    expect(() => checkCurve({ ...cubic, degree: 7 })).toThrow(/degree/);
    expect(() =>
      checkCurve({ ...cubic, knots: cubic.knots!.slice(1) }),
    ).toThrow(/knots/);
    expect(() =>
      checkCurve({ ...cubic, knots: [0, 0, 0, 0.1, 0.3, 0.7, 1, 1, 1, 1] }),
    ).toThrow(/clamped/);
  });
});

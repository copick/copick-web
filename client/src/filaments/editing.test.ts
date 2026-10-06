import { describe, expect, test } from "vitest";
import reference from "./__fixtures__/filament_curves.json";
import {
  evaluateCurve,
  isCurrentFor,
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

const close = (a: XYZ, b: XYZ, tol = 1e-6) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < tol;

const catmullRom = (controls: XYZ[], step = 10): FilamentCurve => ({
  kind: "catmull-rom",
  alpha: 0.5,
  control_points: controls,
  step,
});

describe("insertControlPoint", () => {
  const cps: XYZ[] = [
    [0, 0, 0],
    [10, 0, 0],
    [20, 0, 0],
  ];
  test.each([
    ["append", [5, 0, 0], 3],
    ["prepend", [5, 0, 0], 0],
    ["nearest", [15, 1, 0], 2],
    ["nearest", [-5, 0, 0], 0],
    ["nearest", [30, 0, 0], 3],
    ["nearest", [4, -1, 0], 1],
  ] as [InsertMode, XYZ, number][])("%s %j -> %i", (mode, point, index) => {
    const { controls, index: i } = insertControlPoint(cps, point, mode);
    expect(i).toBe(index);
    expect(controls).toHaveLength(4);
    expect(controls[i]).toEqual(point);
    expect(cps).toHaveLength(3); // the input is not changed
  });

  test("into an empty and a single-point list", () => {
    const one = insertControlPoint([], [1, 2, 3], "nearest");
    expect(one.index).toBe(0);
    expect(insertControlPoint(one.controls, [4, 5, 6], "nearest").index).toBe(
      1,
    );
  });
});

test("nearestOnPolyline respects order on a hairpin", () => {
  // out along y=0, back along y=10: a point near the start is near both legs
  const line: XYZ[] = [
    [0, 0, 0],
    [100, 0, 0],
    [100, 10, 0],
    [0, 10, 0],
  ];
  let hit = nearestOnPolyline(line, [20, 4, 0]);
  expect(hit.s).toBeCloseTo(20);
  expect(hit.distance).toBeCloseTo(4);
  hit = nearestOnPolyline(line, [20, 4, 0], 110);
  expect(hit.s).toBeCloseTo(190);
  expect(close(hit.point, [20, 10, 0])).toBe(true);
});

describe("cutting", () => {
  test("between control points: untouched handles, shared cut point", () => {
    const before: XYZ[] = [
      [0, 0, 0],
      [100, 50, 0],
      [200, 0, 0],
      [300, 50, 0],
      [400, 0, 0],
    ];
    const line = evaluateCurve(catmullRom(before));
    const near = line[Math.floor(line.length / 2) + 3]; // just past the middle control point
    const [a, b] = splitControlPoints(
      before,
      line,
      [near[0], near[1], near[2] + 5],
      10,
    );
    expect(a.slice(0, 3)).toEqual(before.slice(0, 3));
    expect(b.slice(1)).toEqual(before.slice(3));
    expect(close(a[a.length - 1], b[0])).toBe(true);
    const pa = evaluateCurve(catmullRom(a));
    const pb = evaluateCurve(catmullRom(b));
    expect(close(pa[pa.length - 1], pb[0])).toBe(true);
  });

  test("at a control point, and too close to an end", () => {
    const straight: XYZ[] = [0, 100, 200, 300, 400].map((x) => [x, 0, 0]);
    const line = evaluateCurve(catmullRom(straight));
    const [a, b] = splitControlPoints(straight, line, [203, 4, 0], 10);
    expect(a).toEqual(straight.slice(0, 3));
    expect(b).toEqual(straight.slice(2));
    expect(() => splitControlPoints(straight, line, [2, 0, 0], 10)).toThrow(
      /too close to an end/,
    );
  });

  test("a B-spline along its centreline", () => {
    const cubic = (
      reference.cases as unknown as (FilamentCurve & {
        name: string;
        points: XYZ[];
      })[]
    ).find((c) => c.name === "cubic B-spline")!;
    const line = cubic.points;
    const mid = line[Math.floor(line.length / 2)];
    const [a, b] = splitPolyline(line, mid, cubic.step);
    expect(close(a[a.length - 1], mid) && close(b[0], mid)).toBe(true);
    expect(a.length + b.length).toBe(line.length + 1);
    expect(() => splitPolyline(line, line[0], cubic.step)).toThrow(
      /too close to an end/,
    );
  });
});

describe("editableHandles", () => {
  test("own curve, derived Catmull-Rom, fixed B-spline handles", () => {
    const cr = catmullRom(
      [
        [0, 0, 0],
        [50, 10, 0],
        [100, 0, 0],
      ],
      5,
    );
    const points = evaluateCurve(cr);
    let h = editableHandles(points, cr);
    expect(h.kind).toBe("catmull-rom");
    expect(h.canAddRemove).toBe(true);
    expect(h.controls).toHaveLength(3);
    // a filament without a curve gets derived handles
    h = editableHandles(points, null);
    expect(h.kind).toBe("catmull-rom");
    expect(h.canAddRemove).toBe(true);
    expect(h.controls.length).toBeGreaterThanOrEqual(2);
    expect(
      isCurrentFor(
        { ...cr, control_points: h.controls, step: 5 },
        evaluateCurve({ ...cr, control_points: h.controls }),
      ),
    ).toBe(true);

    const cubic = (
      reference.cases as unknown as (FilamentCurve & {
        name: string;
        points: XYZ[];
      })[]
    ).find((c) => c.kind === "bspline")!;
    h = editableHandles(cubic.points, cubic);
    expect(h.kind).toBe("bspline");
    expect(h.canAddRemove).toBe(false);
    expect(h.controls).toHaveLength(cubic.control_points.length);
  });
});

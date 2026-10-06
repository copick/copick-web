import { describe, expect, test } from "vitest";
import type { FilamentResponse } from "@/api/types";
import { evaluateCurve, type XYZ } from "./curves";
import {
  canAddRemove,
  controls,
  convertToCatmullRom,
  cut,
  deleteFilament,
  historyOf,
  insertPoint,
  kindOf,
  movePoint,
  newFilament,
  record,
  redo,
  removePoint,
  reverse,
  stateFromResponse,
  toSaveRequest,
  undo,
  type EditState,
} from "./editSession";

const ctx = { step: 10, radius: 125 };
const empty: EditState = {
  filaments: new Map(),
  pending: new Map(),
  activeId: 1,
};

function traced(points: XYZ[], start: EditState = empty): EditState {
  let s = start;
  for (const p of points) s = insertPoint(s, ctx, p, "append").state;
  return s;
}

const close = (a: XYZ, b: XYZ) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

describe("filament edit session", () => {
  test("tracing: one point is pending, two make a regenerated catmull-rom filament", () => {
    let s = traced([[0, 0, 0]]);
    expect(s.pending.get(1)).toEqual([[0, 0, 0]]);
    expect(s.filaments.size).toBe(0);
    s = traced(
      [
        [100, 0, 0],
        [200, 50, 0],
      ],
      s,
    );
    const f = s.filaments.get(1)!;
    expect(f.curve?.kind).toBe("catmull-rom");
    expect(f.radius).toBe(125);
    expect(
      close(f.points[0], [0, 0, 0]) &&
        close(f.points[f.points.length - 1], [200, 50, 0]),
    ).toBe(true);
    expect(f.points).toEqual(evaluateCurve(f.curve!));
    expect(controls(s, 1)).toHaveLength(3);
  });

  test("move, remove, nearest insert", () => {
    let s = traced([
      [0, 0, 0],
      [100, 0, 0],
      [200, 0, 0],
    ]);
    s = movePoint(s, ctx, 1, 1, [100, 30, 0]);
    expect(controls(s, 1)[1]).toEqual([100, 30, 0]);
    s = insertPoint(s, ctx, [50, 10, 0], "nearest").state;
    expect(controls(s, 1)[1]).toEqual([50, 10, 0]);
    s = removePoint(s, ctx, 1, 1);
    expect(controls(s, 1)).toHaveLength(3);
    s = removePoint(removePoint(s, ctx, 1, 0), ctx, 1, 0);
    expect(s.filaments.has(1)).toBe(false);
    expect(s.pending.get(1)).toHaveLength(1);
  });

  test("new, reverse, delete", () => {
    let s = traced([
      [0, 0, 0],
      [100, 0, 0],
    ]);
    s = newFilament(s);
    expect(s.activeId).toBe(2);
    expect(newFilament(s)).toBe(s); // already on an empty new filament
    s = traced(
      [
        [0, 100, 0],
        [0, 200, 0],
      ],
      s,
    );
    const before = controls(s, 2);
    s = reverse(s, 2);
    expect(controls(s, 2)).toEqual([...before].reverse());
    s = deleteFilament(s, 2);
    expect(s.filaments.has(2)).toBe(false);
    expect(s.activeId).toBe(1);
  });

  test("filaments loaded without a curve keep their points until edited", () => {
    const response: FilamentResponse[] = [
      {
        instance_id: 3,
        points: [
          [0, 0, 0],
          [50, 5, 0],
          [100, 0, 0],
          [150, -5, 0],
          [200, 0, 0],
        ],
        polarity_known: true,
        score: 0.5,
        radius: null,
        curve_kind: null,
        curve: null,
        metadata: { note: "x" },
      },
    ];
    let s = stateFromResponse(response);
    expect(s.activeId).toBe(3);
    expect(toSaveRequest(s)[0]).toMatchObject({
      instance_id: 3,
      points: response[0].points,
      metadata: { note: "x" },
    });
    expect(toSaveRequest(s)[0].curve).toBeUndefined();
    expect(kindOf(s, 3)).toBe("catmull-rom"); // derived handles
    s = movePoint(s, ctx, 3, 0, [0, 10, 0]);
    const saved = toSaveRequest(s)[0];
    expect(saved.curve?.kind).toBe("catmull-rom");
    expect(saved).toMatchObject({
      polarity_known: true,
      score: 0.5,
      metadata: { note: "x" },
    });
  });

  test("b-splines move but don't add or remove until converted", () => {
    const knots = [0, 0, 0, 0, 1 / 3, 2 / 3, 1, 1, 1, 1];
    const cps: XYZ[] = [
      [0, 0, 0],
      [60, 40, 0],
      [120, -20, 0],
      [180, 30, 0],
      [240, 0, 0],
      [300, 10, 0],
    ];
    const curve = {
      kind: "bspline",
      control_points: cps,
      step: 10,
      degree: 3,
      knots,
    };
    let s = stateFromResponse([
      {
        instance_id: 1,
        points: evaluateCurve(curve),
        polarity_known: false,
        score: 1,
        radius: null,
        curve_kind: "bspline",
        curve,
      },
    ]);
    expect(canAddRemove(s, 1)).toBe(false);
    expect(() => insertPoint(s, ctx, [10, 10, 0], "append")).toThrow(
      /B-spline/,
    );
    s = movePoint(s, ctx, 1, 2, [120, 0, 0]);
    expect(s.filaments.get(1)!.curve?.kind).toBe("bspline");
    s = convertToCatmullRom(s, 1);
    expect(kindOf(s, 1)).toBe("catmull-rom");
    expect(canAddRemove(s, 1)).toBe(true);
  });

  test("cut splits at the click, keeps fields and avoids the active empty filament's ID", () => {
    let s = traced([
      [0, 0, 0],
      [100, 0, 0],
      [200, 0, 0],
      [300, 0, 0],
      [400, 0, 0],
    ]);
    s = newFilament(s); // active: empty filament 2
    const result = cut(s, ctx, [150, 3, 0], 20);
    expect(result.pieces).toEqual([1, 3]);
    const [a, b] = [controls(result.state, 1), controls(result.state, 3)];
    expect(a[a.length - 1]).toEqual(b[0]);
    expect(a[0]).toEqual([0, 0, 0]);
    expect(b[b.length - 1]).toEqual([400, 0, 0]);
    expect(result.state.activeId).toBe(2);
    expect(() => cut(s, ctx, [150, 300, 0], 20)).toThrow(/closer/);
    expect(() => cut(s, ctx, [2, 0, 0], 20)).toThrow(/too close to an end/);
  });

  test("history: steps undo and redo in order; a new step clears redo", () => {
    let h = historyOf(empty);
    for (const p of [
      [0, 0, 0],
      [100, 0, 0],
      [200, 0, 0],
    ] as XYZ[])
      h = record(
        h,
        "Add filament point",
        insertPoint(h.state, ctx, p, "append").state,
      );
    expect(record(h, "noop", h.state)).toBe(h);
    h = undo(h);
    expect(controls(h.state, 1)).toHaveLength(2);
    h = redo(h);
    expect(controls(h.state, 1)).toHaveLength(3);
    h = undo(undo(h));
    expect(h.redo).toHaveLength(2);
    h = record(h, "Reverse filament", reverse(h.state, 1));
    expect(h.redo).toHaveLength(0);
    expect(undo(historyOf(empty)).state).toBe(empty);
  });
});

import { describe, expect, test } from "vitest";
import type { XYZ } from "./coordinates";
import {
  densify,
  planeCrossings,
  ringPoints,
  slabAlpha,
  slabSamples,
} from "./filamentGeometry";

describe("filament geometry", () => {
  test("densify keeps the vertices and bounds the spacing", () => {
    const dense = densify(
      [
        [0, 0, 0],
        [10, 0, 0],
        [10, 3, 0],
      ],
      2,
    );
    expect(dense[0]).toEqual([0, 0, 0]);
    expect(dense).toContainEqual([10, 0, 0]);
    expect(dense[dense.length - 1]).toEqual([10, 3, 0]);
    for (let i = 1; i < dense.length; i++) {
      const [a, b] = [dense[i - 1], dense[i]];
      expect(
        Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
      ).toBeLessThanOrEqual(2 + 1e-9);
    }
    expect(densify([], 1)).toEqual([]);
  });

  test("slab samples keep only points near the slice, with signed distance", () => {
    const pts: XYZ[] = [
      [0, 0, 0],
      [0, 0, 5],
      [0, 0, 9],
      [0, 0, 20],
    ];
    const samples = slabSamples(pts, 2, 6, 4);
    expect(samples.map((s) => s.distance)).toEqual([-1, 3]);
  });

  test("crossings interpolate the polyline and count on-plane vertices once", () => {
    const line: XYZ[] = [
      [0, 0, 0],
      [0, 10, 10],
      [0, 20, 20],
    ];
    expect(planeCrossings(line, 2, 5)).toEqual([[0, 5, 5]]);
    expect(planeCrossings(line, 2, 10)).toEqual([[0, 10, 10]]);
    expect(planeCrossings(line, 2, 30)).toEqual([]);
    // A U-turn crosses twice.
    expect(
      planeCrossings(
        [
          [0, 0, 0],
          [0, 0, 10],
          [1, 0, 0],
        ],
        2,
        5,
      ),
    ).toHaveLength(2);
  });

  test("rings lie in the plane at the requested radius", () => {
    const ring = ringPoints([5, 5, 5], 0, 1, 2, 8);
    expect(ring).toHaveLength(8);
    for (const p of ring) {
      expect(p[2]).toBe(5);
      expect(Math.hypot(p[0] - 5, p[1] - 5)).toBeCloseTo(2, 9);
    }
  });

  test("slab alpha fades with distance", () => {
    expect(slabAlpha(0, 10)).toBe(1);
    expect(slabAlpha(10, 10)).toBeCloseTo(0.15);
    expect(slabAlpha(-5, 10)).toBeCloseTo(0.575);
    expect(slabAlpha(3, 0)).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import {
  chunkStroke,
  describeOperation,
  describeRegion,
  geometryMatches,
  newPublication,
  predictRegion,
  strokeSegment,
} from "./cellcanvas";

describe("strokeSegment", () => {
  it("fills every voxel between drag samples without duplicates", () => {
    expect(strokeSegment([0, 0, 5], [3, 1, 5])).toEqual([
      [0, 0, 5],
      [1, 0, 5],
      [2, 1, 5],
      [3, 1, 5],
    ]);
    expect(strokeSegment([2, 2, 2], [2, 2, 2])).toEqual([[2, 2, 2]]);
  });
});

describe("chunkStroke", () => {
  it("keeps label, radius and plane across bounded requests", () => {
    const points = Array.from(
      { length: 5 },
      (_, i) => [i, 0, 0] as [number, number, number],
    );
    const chunks = chunkStroke({ label: 2, radius: 1, plane: "XY", points }, 2);
    expect(chunks.map((c) => c.points.length)).toEqual([2, 2, 1]);
    expect(chunks.every((c) => c.label === 2 && c.plane === "XY")).toBe(true);
  });
});

describe("geometryMatches", () => {
  const copick = {
    shape: [32, 40, 48],
    scale_angstrom: [10, 10, 10],
    translation_angstrom: [0, 0, 0],
  };
  const axes = (scale: number, x = 48) => [
    { size: x, scale, translation: 0 },
    { size: 40, scale, translation: 0 },
    { size: 32, scale, translation: 0 },
  ];
  it("compares the viewer's x, y, z grid with the bound z, y, x reconstruction in Å", () => {
    expect(geometryMatches(copick, axes(10), 1)).toBe(true);
    expect(geometryMatches(copick, axes(1), 10)).toBe(true); // nm world units
    expect(geometryMatches(copick, axes(10, 47), 1)).toBe(false);
    expect(geometryMatches(copick, axes(20), 1)).toBe(false);
  });
});

describe("newPublication", () => {
  it("reports only new complete publications", () => {
    expect(newPublication(null, { complete: true, operation_id: "a" })).toBe(
      "a",
    );
    expect(
      newPublication("a", { complete: true, operation_id: "a" }),
    ).toBeNull();
    expect(
      newPublication("a", { complete: false, operation_id: "b" }),
    ).toBeNull();
    expect(newPublication(null, { exists: false })).toBeNull();
  });
});

describe("describeOperation", () => {
  it("says a failed prediction leaves the published one and a lost receipt needs retraining", () => {
    const base = { pending: null, published: {} };
    expect(
      describeOperation({
        ...base,
        last: {
          id: "1",
          kind: "predict",
          state: "failed",
          error: { message: "boom" },
        },
      }),
    ).toMatch(/previous published prediction is unchanged/);
    expect(
      describeOperation({
        ...base,
        last: { id: "1", kind: "train", state: "lost" },
      }),
    ).toMatch(/restarted/);
  });
});

describe("predictRegion", () => {
  it("predicts the shown slice, a slab clipped to the volume, or the whole volume", () => {
    expect(predictRegion("slice", 120, 564)).toEqual({ z: [120, 121] });
    expect(predictRegion("slab", 120, 564)).toEqual({ z: [112, 128] });
    expect(predictRegion("slab", 3, 564)).toEqual({ z: [0, 16] });
    expect(predictRegion("slab", 563, 564)).toEqual({ z: [548, 564] });
    expect(predictRegion("slab", 2, 5)).toEqual({ z: [0, 5] });
    expect(predictRegion("volume", 120, 564)).toBeNull();
    expect(describeRegion({ z: [120, 121] })).toBe("slice z=120");
    expect(describeRegion({ z: [112, 128] })).toBe("slices z=112–127");
    expect(describeRegion(null)).toBe("volume");
  });
});

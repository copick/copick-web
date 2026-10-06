import { describe, expect, test } from "vitest";
import {
  angstromToWorld,
  geometryFromDimensions,
  indicesToWorld,
  planeAxes,
  sphereIntersection,
  worldToAngstrom,
  worldToIndex,
} from "./coordinates";

const dimensions = {
  x: { unit: "angstrom", lods: [{ size: 64, scale: 10, translation: 100 }] },
  y: { unit: "angstrom", lods: [{ size: 64, scale: 15, translation: 200 }] },
  z: { unit: "angstrom", lods: [{ size: 64, scale: 20, translation: -300 }] },
};

describe("coordinates", () => {
  test("nonzero origins and anisotropic ZYX source axes preserve physical pick coordinates", () => {
    const { axes } = geometryFromDimensions(dimensions);
    expect(indicesToWorld([16, 45, 22], axes)).toEqual([260, 875, 140]);
    expect(
      [260, 872, 148].map((value, axis) => worldToIndex(value, axes[axis])),
    ).toEqual([16, 45, 22]);
    expect(worldToIndex(-1000, axes[0])).toBe(0);
    expect(worldToIndex(10000, axes[0])).toBe(63);
    expect(planeAxes).toEqual({ XY: [0, 1, 2], XZ: [0, 2, 1], YZ: [1, 2, 0] });
  });

  test("150 Å spheres intersect slices using physical distance, not full projected circles", () => {
    expect(sphereIntersection(150, 90)).toBe(120);
    expect(sphereIntersection(150, -90)).toBe(120);
    expect(sphereIntersection(150, 151)).toBeNull();
    expect(sphereIntersection(150, 150)).toBe(0);
  });

  test("units are normalised to Å instead of being refused", () => {
    const nm = {
      x: { ...dimensions.x, unit: "nanometer" },
      y: { ...dimensions.y, unit: "nanometer" },
      z: { ...dimensions.z, unit: "nanometer" },
    };
    const g = geometryFromDimensions(nm);
    expect(g.angstromPerUnit).toBe(10);
    expect(g.unitAssumed).toBe(false);
    expect(angstromToWorld([100, 200, 300], g.angstromPerUnit)).toEqual([
      10, 20, 30,
    ]);
    expect(worldToAngstrom([10, 20, 30], g.angstromPerUnit)).toEqual([
      100, 200, 300,
    ]);

    const bare = geometryFromDimensions({
      x: { lods: dimensions.x.lods },
      y: { lods: dimensions.y.lods },
      z: { lods: dimensions.z.lods },
    });
    expect(bare.angstromPerUnit).toBe(1);
    expect(bare.unitAssumed).toBe(true);
  });

  test("invalid physical axes and mixed units cannot silently misplace annotations", () => {
    expect(() =>
      geometryFromDimensions({
        ...dimensions,
        z: { ...dimensions.z, unit: "nanometer" },
      }),
    ).toThrow(/Mixed/);
    expect(() =>
      geometryFromDimensions({ ...dimensions, z: undefined }),
    ).toThrow(/no Z axis/);
    expect(() =>
      geometryFromDimensions({
        ...dimensions,
        x: {
          unit: "angstrom",
          lods: [{ size: 64, scale: 0, translation: 100 }],
        },
      }),
    ).toThrow(/Invalid/);
  });
});

import { describe, expect, test } from "vitest";
import {
  INSTANCE_PALETTE,
  INSTANCE_PALETTE_SIZE,
  hsvToRgb,
  instanceColor,
  instanceCycle,
  instanceRgb,
  paletteIndex,
} from "./instanceColors";

// colorsys.hsv_to_rgb((i * 0.618033988749895) % 1.0, 0.65, 0.95), from Python.
const PYTHON: Record<number, [number, number, number]> = {
  1: [0.3325, 0.512684, 0.95],
  2: [0.692868, 0.95, 0.3325],
  3: [0.95, 0.3325, 0.873052],
  23: [0.771734, 0.95, 0.3325],
  256: [0.764622, 0.95, 0.3325],
  257: [0.95, 0.3325, 0.944806],
};

describe("instance colours", () => {
  test("match the Qt apps' golden-ratio formula", () => {
    for (const [id, rgb] of Object.entries(PYTHON)) {
      const got = instanceRgb(Number(id));
      rgb.forEach((c, i) => expect(got[i]).toBeCloseTo(c, 6));
    }
  });

  test("the palette is LabelLayer's cycle: cycle[(id - 1) % n] equals the formula for ids <= n", () => {
    expect(INSTANCE_PALETTE).toHaveLength(INSTANCE_PALETTE_SIZE);
    for (let id = 1; id <= INSTANCE_PALETTE_SIZE; id++) {
      expect(INSTANCE_PALETTE[(id - 1) % INSTANCE_PALETTE_SIZE]).toEqual(
        instanceRgb(id),
      );
    }
  });

  test("picks and filaments wrap like the segmentation cycle", () => {
    expect(paletteIndex(1)).toBe(0);
    expect(paletteIndex(256)).toBe(255);
    expect(paletteIndex(257)).toBe(0);
    expect(instanceColor(257, [0, 0, 0, 255])).toEqual(
      instanceColor(1, [0, 0, 0, 255]),
    );
  });

  test("instance 0 and missing ids keep the base colour", () => {
    const base: [number, number, number, number] = [10, 20, 30, 200];
    expect(instanceColor(0, base)).toBe(base);
    expect(instanceColor(null, base)).toBe(base);
    expect(instanceColor(undefined, base)).toBe(base);
    expect(instanceColor(1, base)).toEqual([85, 131, 242, 200]);
  });

  test("hsvToRgb covers every sextant", () => {
    expect(hsvToRgb(0, 0, 0.5)).toEqual([0.5, 0.5, 0.5]);
    for (let k = 0; k < 6; k++) {
      const rgb = hsvToRgb(k / 6 + 0.01, 1, 1);
      expect(Math.max(...rgb)).toBeCloseTo(1, 9);
    }
  });

  test("the cycle carries the requested alpha", () => {
    const cycle = instanceCycle(0.5);
    expect(cycle[0]).toEqual([...instanceRgb(1), 0.5]);
  });
});

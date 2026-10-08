import { describe, expect, test } from "vitest";
import { niceFloor, scaleBar } from "./scaleBar";

describe("scale bar", () => {
  test("nice lengths are 1, 2 or 5 times a power of ten", () => {
    expect(niceFloor(1)).toBe(1);
    expect(niceFloor(1.9)).toBe(1);
    expect(niceFloor(2.5)).toBe(2);
    expect(niceFloor(7)).toBe(5);
    expect(niceFloor(3456)).toBe(2000);
    expect(niceFloor(0.034)).toBeCloseTo(0.02);
    expect(niceFloor(0)).toBe(0);
  });

  test("each pane's bar follows its own resolution", () => {
    // Two panes of different widths showing the same volume have different Å per pixel.
    expect(scaleBar(10, 100)).toEqual({ angstrom: 1000, pixels: 100 });
    expect(scaleBar(25, 100)).toEqual({ angstrom: 2000, pixels: 80 });
    expect(scaleBar(0, 100)).toBeNull();
  });
});

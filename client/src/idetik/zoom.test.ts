import { describe, expect, test } from "vitest";
import { centroid, markerPixels, MAX_MARKER_PIXELS, ZoomTracker } from "./zoom";

describe("zoom-aware markers", () => {
  test("markers keep their minimum size zoomed out and a physical size zoomed in", () => {
    expect(markerPixels(6, 100, 0.02)).toBe(6); // 2 px on screen: stays at the minimum
    expect(markerPixels(6, 100, 0.5)).toBe(50); // 4x zoom past the minimum: grows
    expect(markerPixels(6, 100, 100)).toBe(MAX_MARKER_PIXELS);
    expect(markerPixels(6, null, 1)).toBe(6);
    expect(markerPixels(6, 100, null)).toBe(6);
  });

  test("points are rebuilt only for real zoom changes", () => {
    const zoom = new ZoomTracker();
    expect(zoom.changed(null)).toBe(false);
    expect(zoom.changed(1)).toBe(true);
    zoom.commit(1);
    expect(zoom.changed(1.01)).toBe(false);
    expect(zoom.changed(1.2)).toBe(true);
    expect(zoom.scale).toBe(1);
  });

  test("centroid skips invalid points", () => {
    expect(
      centroid([
        [0, 0, 0],
        [2, 4, 6],
        [NaN, 0, 0],
      ]),
    ).toEqual([1, 2, 3]);
    expect(centroid([])).toBeNull();
  });
});

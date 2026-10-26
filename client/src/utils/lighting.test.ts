import { describe, expect, test } from "vitest";
import { IDETIK_LIGHT, bakeLighting, brightness } from "./lighting";

/** Unit normals spread over the sphere, plus idetik's light direction and its opposite. */
function normals(): [number, number, number][] {
  const out: [number, number, number][] = [
    [...IDETIK_LIGHT],
    [-IDETIK_LIGHT[0], -IDETIK_LIGHT[1], -IDETIK_LIGHT[2]],
  ];
  for (let i = 0; i < 200; i++) {
    const z = 1 - (2 * (i + 0.5)) / 200;
    const r = Math.sqrt(1 - z * z);
    const a = i * 2.399963;
    out.push([r * Math.cos(a), r * Math.sin(a), z]);
  }
  return out;
}

/** What idetik's mesh shader draws with ambient 0 and diffuse 1. */
const idetikBrightness = (n: number[]) =>
  Math.max(
    0,
    n[0] * IDETIK_LIGHT[0] + n[1] * IDETIK_LIGHT[1] + n[2] * IDETIK_LIGHT[2],
  );

describe("lighting", () => {
  test("no side is dark: the underside is lit by the fill light", () => {
    const all = normals().map((n) => brightness(...n));
    expect(Math.min(...all)).toBeGreaterThanOrEqual(0.45);
    expect(brightness(0, 0, 1)).toBeGreaterThan(0.8);
    expect(brightness(0, 0, -1)).toBeGreaterThan(0.7);
  });

  test("baked normals make idetik's shader draw the brightness of the true normal", () => {
    const ns = normals();
    const vertices = new Float32Array(
      ns.flatMap((n, i) => [i, 2 * i, 3 * i, ...n]),
    );
    const baked = bakeLighting(vertices);
    ns.forEach((n, i) => {
      const b = [3, 4, 5].map((k) => baked[6 * i + k]);
      expect(Math.hypot(...b)).toBeCloseTo(1, 5);
      expect(idetikBrightness(b)).toBeCloseTo(brightness(...n), 5);
      // Positions are kept, and the input is not changed.
      expect([0, 1, 2].map((k) => baked[6 * i + k])).toEqual([i, 2 * i, 3 * i]);
      expect(vertices[6 * i + 3]).toBeCloseTo(n[0], 6);
    });
  });
});

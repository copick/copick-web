/**
 * Zoom-aware marker sizes. Idetik draws points at a fixed pixel size, so
 * overlays rescale them from the view's zoom: a marker keeps a physical size
 * (world units) once that is larger on screen than its minimum pixel size.
 */

import type { Layer } from "@idetik/core";
import type { XYZ } from "./coordinates";

/** Idetik's Viewport (not exported by the package). */
export type Viewport = NonNullable<Parameters<Layer["update"]>[0]>;

/** Largest marker drawn, in CSS pixels (GPUs clamp point sizes anyway). */
export const MAX_MARKER_PIXELS = 160;
/** Relative zoom change that rebuilds a layer's points. */
const REBUILD_TOLERANCE = 0.04;

/**
 * CSS pixels per world unit in a viewport: from the visible world rectangle for
 * orthographic views, at the depth of `focus` for perspective views (null
 * without a focus).
 */
export function pixelsPerWorldUnit(
  viewport: Viewport | undefined,
  focus?: XYZ,
): number | null {
  if (!viewport) return null;
  const camera = viewport.camera;
  const element = viewport.element;
  if (camera.type === "OrthographicCamera") {
    const rect = (
      camera as unknown as {
        getWorldViewRect(): { min: ArrayLike<number>; max: ArrayLike<number> };
      }
    ).getWorldViewRect();
    const width = rect.max[0] - rect.min[0];
    return width > 0 && element.clientWidth > 0
      ? element.clientWidth / width
      : null;
  }
  const target = focus;
  if (!target) return null;
  const p = camera.position;
  const distance = Math.hypot(
    p[0] - target[0],
    p[1] - target[1],
    p[2] - target[2],
  );
  const focal = camera.projectionMatrix[5]; // cot(fov / 2)
  return distance > 0 && element.clientHeight > 0
    ? (focal * element.clientHeight) / 2 / distance
    : null;
}

/** Marker size in CSS pixels: `diameter` world units on screen, at least `minPixels`. */
export function markerPixels(
  minPixels: number,
  diameter: number | null,
  scale: number | null,
): number {
  if (!diameter || !scale) return minPixels;
  return Math.min(MAX_MARKER_PIXELS, Math.max(minPixels, diameter * scale));
}

/** Tracks a layer's zoom; `changed` is true when the points should be rebuilt. */
export class ZoomTracker {
  private built_: number | null = null;

  /** The zoom the points were last built for. */
  get scale(): number | null {
    return this.built_;
  }

  changed(scale: number | null): boolean {
    if (scale === null) return false;
    if (this.built_ === null) return true;
    return Math.abs(scale / this.built_ - 1) > REBUILD_TOLERANCE;
  }

  /** Call when the points are rebuilt for `scale`. */
  commit(scale: number | null): void {
    if (scale !== null) this.built_ = scale;
  }
}

/** Centroid of a point set (3D focus for zoom), or null when empty. */
export function centroid(points: Iterable<XYZ>): XYZ | null {
  let n = 0;
  const s: XYZ = [0, 0, 0];
  for (const p of points) {
    if (!p.every(Number.isFinite)) continue;
    s[0] += p[0];
    s[1] += p[1];
    s[2] += p[2];
    n++;
  }
  return n ? [s[0] / n, s[1] / n, s[2] / n] : null;
}

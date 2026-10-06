/**
 * Pick markers for one view of the linked viewer (adapted from apex-agent's
 * PickLayer; see NOTICE.md). Replaces the old single-view PicksLayer.
 *
 * Each point has its own colour (instance colours for filament objects). Two
 * styles:
 * - `dots`: a disc that shrinks and fades with distance from the slice;
 * - `shells`: the physical cross-section of the object's radius sphere with the
 *   slice (2D), or three great circles (3D).
 *
 * The layer reads the shared crosshair (`sliceCoords`) and its view's zoom every
 * frame and rebuilds its points only when either changes, so slicing does not go
 * through React. Dots keep a physical size (`dotDiameter`) once that is larger
 * on screen than their minimum pixel size, so they grow as the view zooms in.
 */

import { Layer, Points, type SliceCoordinates } from "@idetik/core";
import { vec3 } from "gl-matrix";
import {
  AXES,
  planeAxes,
  sphereIntersection,
  type ViewId,
  type XYZ,
} from "./coordinates";
import {
  centroid,
  markerPixels,
  pixelsPerWorldUnit,
  ZoomTracker,
  type Viewport,
} from "./zoom";

type PointProps = ConstructorParameters<typeof Points>[0][number];
export type Rgba255 = [number, number, number, number];
export type MarkerStyle = "dots" | "shells";

export interface MarkerPoint {
  /** Particle centre in world units. */
  position: XYZ;
  color: Rgba255;
  selected?: boolean;
}

export interface PickMarkersOptions {
  points: MarkerPoint[];
  view: ViewId;
  sliceCoords: SliceCoordinates;
  style: MarkerStyle;
  /** Object radius in world units (shells), or null when unknown. */
  radius: number | null;
  /** Minimum dot size (CSS pixels). */
  pointSizePixels: number;
  /** Physical dot diameter (world units) once zoomed in, or null for fixed-size dots. */
  dotDiameter: number | null;
  /** Distance (world units) over which dots shrink to half size. */
  fadeRadius: number;
}

export class PickMarkersLayer extends Layer {
  public readonly type = "PickMarkersLayer";

  private readonly options_: PickMarkersOptions;
  private lastSlice_: number | undefined = undefined;
  private built_ = false;
  private readonly zoom_ = new ZoomTracker();
  private readonly focus_: XYZ | null;

  constructor(options: PickMarkersOptions) {
    super({ blendMode: "normal" });
    this.options_ = options;
    this.focus_ =
      options.view === "3D"
        ? centroid(options.points.map((p) => p.position))
        : null;
    this.update();
    this.setState("ready");
  }

  update(viewport?: Viewport): void {
    const { view, sliceCoords } = this.options_;
    const scale = pixelsPerWorldUnit(viewport, this.focus_ ?? undefined);
    const zoomed = this.zoom_.changed(scale);
    if (zoomed) this.zoom_.commit(scale);
    if (view === "3D") {
      if (!this.built_ || zoomed) this.rebuild(0);
      return;
    }
    const w = planeAxes[view][2];
    const slice = sliceCoords[AXES[w]] ?? 0;
    if (!this.built_ || zoomed || slice !== this.lastSlice_)
      this.rebuild(slice);
  }

  private rebuild(slice: number): void {
    this.built_ = true;
    this.lastSlice_ = slice;
    const {
      points,
      view,
      style,
      radius,
      pointSizePixels,
      dotDiameter,
      fadeRadius,
    } = this.options_;
    const scale = this.zoom_.scale;
    const dot = (minPixels: number) =>
      markerPixels(minPixels, dotDiameter, scale);
    // Enough samples for a closed-looking ring at the current zoom.
    const ringSamples = (r: number, min: number) =>
      scale
        ? Math.min(360, Math.max(min, Math.ceil((2 * Math.PI * r * scale) / 4)))
        : min;
    const dpr = window.devicePixelRatio || 1;
    const props: PointProps[] = [];
    const add = (xyz: XYZ, color: Rgba255, alpha: number, size: number) =>
      props.push({
        position: vec3.fromValues(xyz[0], xyz[1], xyz[2]),
        color: [color[0] / 255, color[1] / 255, color[2] / 255, alpha],
        size: size * dpr,
        marker: "circle",
      });

    for (const point of points) {
      const xyz = point.position;
      if (!xyz.every(Number.isFinite)) continue;
      const selected = !!point.selected;
      const color = selected ? highlight(point.color) : point.color;

      if (view === "3D") {
        add(xyz, color, selected ? 1 : 0.85, dot(selected ? 7 : 3));
        if (style === "shells" && radius && radius > 0) {
          const n = ringSamples(radius, 32);
          for (const [u, v] of [
            [0, 1],
            [0, 2],
            [1, 2],
          ]) {
            for (let k = 0; k < n; k++) {
              const q = [...xyz] as XYZ;
              const a = (k * 2 * Math.PI) / n;
              q[u] += radius * Math.cos(a);
              q[v] += radius * Math.sin(a);
              add(q, color, selected ? 1 : 0.35, selected ? 2 : 1.3);
            }
          }
        }
        continue;
      }

      const [u, v, w] = planeAxes[view];
      const distance = xyz[w] - slice;
      const onPlane = [...xyz] as XYZ;
      onPlane[w] = slice;

      if (style === "shells" && radius && radius > 0) {
        const r = sphereIntersection(radius, distance);
        if (r === null) continue;
        const n = ringSamples(r, 48);
        for (let k = 0; k < n; k++) {
          const a = (k * 2 * Math.PI) / n;
          const ring = [...onPlane] as XYZ;
          ring[u] += r * Math.cos(a);
          ring[v] += r * Math.sin(a);
          add(ring, color, selected ? 1 : 0.8, selected ? 2.5 : 1.6);
        }
        add(onPlane, color, 1, selected ? 6 : 3);
        continue;
      }

      const zScale = Math.abs(distance) / fadeRadius + 1.0;
      // Beyond 3 fade radii a dot is a faint speck; dense sets (filament picks) would otherwise
      // pile up into streaks.
      if (zScale > 4) continue;
      const size =
        (selected ? dot(pointSizePixels) * 1.35 : dot(pointSizePixels)) /
        zScale;
      if (size < 0.5) continue;
      add(onPlane, color, 1.0 / zScale, size);
    }

    this.clearObjects();
    if (props.length > 0) {
      const object = new Points(props);
      object.depthTest = false;
      this.addObject(object);
    }
  }
}

function highlight(color: Rgba255): Rgba255 {
  return [
    Math.min(255, color[0] + 80),
    Math.min(255, color[1] + 80),
    Math.min(255, color[2] + 80),
    255,
  ];
}

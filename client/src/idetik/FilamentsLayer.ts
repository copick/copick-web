/**
 * Filaments drawn as dense points (idetik's line geometry is not used).
 *
 * - 2D views: centreline samples within a slab around the slice, fading with
 *   distance, plus a ring where the filament crosses the slice plane.
 * - 3D view: every sample of the centreline.
 *
 * Like PickMarkersLayer, the layer reads the shared crosshair and its view's
 * zoom every frame and rebuilds only when either changes. Zoomed in, samples
 * are drawn at the filament's radius, so the centreline reads as a tube.
 */

import { Layer, Points, type SliceCoordinates } from "@idetik/core";
import { vec3 } from "gl-matrix";
import { AXES, planeAxes, type ViewId, type XYZ } from "./coordinates";
import {
  planeCrossings,
  ringPoints,
  slabAlpha,
  slabSamples,
} from "./filamentGeometry";
import {
  centroid,
  markerPixels,
  pixelsPerWorldUnit,
  ZoomTracker,
  type Viewport,
} from "./zoom";

type PointProps = ConstructorParameters<typeof Points>[0][number];
type Rgba255 = [number, number, number, number];

export interface FilamentPolyline {
  instanceId: number;
  /** The centreline in world units, ordered. */
  points: XYZ[];
  /** The centreline densified for drawing. */
  dense: XYZ[];
  color: Rgba255;
  /** Ring radius (world units). */
  radius: number;
  selected?: boolean;
}

export interface FilamentsLayerOptions {
  filaments: FilamentPolyline[];
  view: ViewId;
  sliceCoords: SliceCoordinates;
  /** Half thickness of the slab drawn around the slice (world units). */
  halfThickness: number;
  pointSizePixels: number;
}

export class FilamentsLayer extends Layer {
  public readonly type = "FilamentsLayer";

  private readonly options_: FilamentsLayerOptions;
  private lastSlice_: number | undefined = undefined;
  private built_ = false;
  private readonly zoom_ = new ZoomTracker();
  private readonly focus_: XYZ | null;

  constructor(options: FilamentsLayerOptions) {
    super({ blendMode: "normal" });
    this.options_ = options;
    this.focus_ =
      options.view === "3D"
        ? centroid(options.filaments.flatMap((f) => f.points))
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
    const slice = sliceCoords[AXES[planeAxes[view][2]]] ?? 0;
    if (!this.built_ || zoomed || slice !== this.lastSlice_)
      this.rebuild(slice);
  }

  private rebuild(slice: number): void {
    this.built_ = true;
    this.lastSlice_ = slice;
    const { filaments, view, halfThickness, pointSizePixels } = this.options_;
    const dpr = window.devicePixelRatio || 1;
    const props: PointProps[] = [];
    const add = (xyz: XYZ, color: Rgba255, alpha: number, size: number) =>
      props.push({
        position: vec3.fromValues(xyz[0], xyz[1], xyz[2]),
        color: [color[0] / 255, color[1] / 255, color[2] / 255, alpha],
        size: size * dpr,
        marker: "circle",
      });

    const scale = this.zoom_.scale;
    for (const filament of filaments) {
      const base = markerPixels(pointSizePixels, filament.radius, scale);
      const size = filament.selected ? base * 1.8 : base;
      const ringSize = Math.max(
        1.5,
        pointSizePixels * (filament.selected ? 1.1 : 0.6),
      );
      const ringSamples = scale
        ? Math.min(
            360,
            Math.max(
              40,
              Math.ceil((2 * Math.PI * filament.radius * scale) / 4),
            ),
          )
        : 40;
      if (view === "3D") {
        for (const p of filament.dense) add(p, filament.color, 0.9, size);
        continue;
      }
      const [u, v, w] = planeAxes[view];
      for (const { position, distance } of slabSamples(
        filament.dense,
        w,
        slice,
        halfThickness,
      )) {
        const onPlane = [...position] as XYZ;
        onPlane[w] = slice;
        add(onPlane, filament.color, slabAlpha(distance, halfThickness), size);
      }
      for (const crossing of planeCrossings(filament.points, w, slice)) {
        for (const p of ringPoints(
          crossing,
          u,
          v,
          filament.radius,
          ringSamples,
        )) {
          add(p, filament.color, 1, ringSize);
        }
      }
    }

    this.clearObjects();
    if (props.length > 0) {
      const object = new Points(props);
      object.depthTest = false;
      this.addObject(object);
    }
  }
}

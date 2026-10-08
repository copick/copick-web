/**
 * A segmentation in the 3D view, drawn as its boundary voxels (idetik's
 * VolumeLayer has no label colour maps). Points are shaded by their outward
 * normal and sized to one voxel of the level they come from, at least
 * `minPixels`, so the surface looks closed at any zoom.
 *
 * Big point clouds are expensive to rebuild, so zoom changes are applied once
 * the zoom has settled.
 */

import { Layer, Points } from "@idetik/core";
import { vec3 } from "gl-matrix";
import type { XYZ } from "./coordinates";
import {
  markerPixels,
  pixelsPerWorldUnit,
  ZoomTracker,
  type Viewport,
} from "./zoom";
import {
  pointColor,
  shade,
  type SurfaceColoring,
  type SurfacePoints,
} from "@/utils/surfacePoints";

type PointProps = ConstructorParameters<typeof Points>[0][number];

/** Point diameter, in voxels of the points' level. */
const VOXEL_DIAMETER = 1.6;
/** How long the zoom must stay put before the points are resized (ms). */
const SETTLE_MS = 150;

export interface SurfacePointsLayerOptions {
  points: SurfacePoints;
  coloring: SurfaceColoring;
  /** Å per world unit. */
  angstromPerUnit: number;
  minPixels: number;
}

export class SurfacePointsLayer extends Layer {
  public readonly type = "SurfacePointsLayer";

  private readonly options_: SurfacePointsLayerOptions;
  private readonly zoom_ = new ZoomTracker();
  /** Drawn points: world position, shaded colour (0-1). */
  private readonly drawn_: { position: vec3; color: Rgba01 }[] = [];
  private readonly focus_: XYZ | undefined;
  private built_ = false;
  private pendingScale_: number | null = null;
  private pendingSince_ = 0;

  constructor(options: SurfacePointsLayerOptions) {
    super({ blendMode: "normal" });
    this.options_ = options;
    const { points, coloring, angstromPerUnit } = options;
    const n = points.positions.length / 3;
    const sum: XYZ = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const c = pointColor(points, coloring, i);
      if (!c) continue;
      const s = shade(
        points.normals[3 * i],
        points.normals[3 * i + 1],
        points.normals[3 * i + 2],
      );
      const position = vec3.fromValues(
        points.positions[3 * i] / angstromPerUnit,
        points.positions[3 * i + 1] / angstromPerUnit,
        points.positions[3 * i + 2] / angstromPerUnit,
      );
      sum[0] += position[0];
      sum[1] += position[1];
      sum[2] += position[2];
      this.drawn_.push({ position, color: [c[0] * s, c[1] * s, c[2] * s, 1] });
    }
    const m = this.drawn_.length;
    this.focus_ = m ? [sum[0] / m, sum[1] / m, sum[2] / m] : undefined;
    this.setState("ready");
  }

  update(viewport?: Viewport): void {
    if (!viewport) return;
    const scale = pixelsPerWorldUnit(viewport, this.focus_);
    if (!this.built_) {
      this.zoom_.commit(scale);
      this.rebuild();
      return;
    }
    if (!this.zoom_.changed(scale) || scale === null) {
      this.pendingScale_ = null;
      return;
    }
    const now = performance.now();
    if (
      this.pendingScale_ === null ||
      Math.abs(scale / this.pendingScale_ - 1) > 0.02
    ) {
      this.pendingScale_ = scale;
      this.pendingSince_ = now;
      return;
    }
    if (now - this.pendingSince_ >= SETTLE_MS) {
      this.pendingScale_ = null;
      this.zoom_.commit(scale);
      this.rebuild();
    }
  }

  private rebuild(): void {
    this.built_ = true;
    const { points, angstromPerUnit, minPixels } = this.options_;
    const diameter = (VOXEL_DIAMETER * points.voxelSize) / angstromPerUnit;
    const size =
      markerPixels(minPixels, diameter, this.zoom_.scale) *
      (window.devicePixelRatio || 1);
    const props: PointProps[] = this.drawn_.map(({ position, color }) => ({
      position,
      color,
      size,
      marker: "square",
    }));
    this.clearObjects();
    if (props.length > 0) this.addObject(new Points(props));
  }
}

type Rgba01 = [number, number, number, number];

/**
 * idetik Layer for rendering pick points.
 * Based on the Particles implementation from try-cryolens/app/common/ParticlesLayer.ts
 */

import { Layer, Points, Texture2DArray, Color } from "@idetik/core";
import { vec3 } from "gl-matrix";

// Marker atlas size
const SPRITE_SIZE = 256;

type PointData = {
  position: vec3;
  color: Color;
  size: number;
  markerIndex: number;
};

export interface PicksLayerOptions {
  points: Array<{ x: number; y: number; z: number }>;
  color: [number, number, number, number]; // RGBA 0-255
  pointSizePixels: number; // Diameter in pixels (converted from Angstroms)
  zFadeRadius: number; // Radius in Angstroms for z-depth fading
}

export class PicksLayer extends Layer {
  public readonly type = "PicksLayer";

  private readonly rawPoints_: Array<{ x: number; y: number; z: number }>;
  private readonly color_: Color;
  private readonly pointSizePixels_: number;
  private readonly zFadeRadius_: number;
  private static markerAtlas_: Texture2DArray;
  private needsUpdate_ = true;
  private currentZ_ = 0;

  constructor(options: PicksLayerOptions) {
    super();
    this.setState("initialized");
    this.rawPoints_ = options.points;
    // Use Color.from() for robust color parsing (like cryolens)
    this.color_ = Color.from([
      options.color[0] / 255,
      options.color[1] / 255,
      options.color[2] / 255,
      options.color[3] / 255,
    ]);
    this.pointSizePixels_ = options.pointSizePixels;
    this.zFadeRadius_ = options.zFadeRadius;
    // Enable transparency for proper blending (like cryolens)
    this.transparent = true;
    this.refreshPointsRenderable();
    this.setState("ready");
  }

  /**
   * Set the current Z position (in world coordinates).
   * Points will be scaled/dimmed based on distance from this position.
   */
  public setCurrentZ(z: number) {
    if (this.currentZ_ !== z) {
      this.currentZ_ = z;
      this.needsUpdate_ = true;
    }
  }

  public update() {
    if (!this.needsUpdate_) {
      return;
    }
    this.refreshPointsRenderable();
    this.needsUpdate_ = false;
  }

  private refreshPointsRenderable() {
    const { r, g, b } = this.color_;

    // Filter and scale points by depth
    const scaledPoints: PointData[] = [];

    for (const pt of this.rawPoints_) {
      // Calculate distance from current z-slice
      const zDist = Math.abs(pt.z - this.currentZ_);

      // Z-fading based on radius: points fade as they move away from current slice
      // At zDist = 0: zScale = 1 (full size/opacity)
      // At zDist = zFadeRadius: zScale = 2 (half size/opacity)
      // At zDist = 2*zFadeRadius: zScale = 3 (third size/opacity)
      const zScale = zDist / this.zFadeRadius_ + 1.0;

      // Scale size by devicePixelRatio (critical for high-DPI displays)
      const size = (this.pointSizePixels_ * (window.devicePixelRatio || 1)) / zScale;

      // Skip very small points
      if (size < 0.1) {
        continue;
      }

      // Calculate opacity based on z-distance
      const opacity = 1.0 / zScale;

      scaledPoints.push({
        // Put all points at z=10 to render in front of image plane
        // The actual pt.z is only used for depth-based size/opacity calculation
        position: vec3.fromValues(pt.x, pt.y, 10),
        color: Color.from([r, g, b, opacity]),
        size,
        markerIndex: 0, // Circle marker
      });
    }

    // Clear existing objects
    this.objects.length = 0;

    if (scaledPoints.length > 0) {
      const pointsRenderable = new Points(scaledPoints, PicksLayer.markerAtlas);
      this.addObject(pointsRenderable);
    }
  }

  private static get markerAtlas() {
    if (!PicksLayer.markerAtlas_) {
      PicksLayer.markerAtlas_ = PicksLayer.createMarkerAtlas();
    }
    return PicksLayer.markerAtlas_;
  }

  private static createMarkerAtlas() {
    // Create a simple circle marker
    const circle = (size: number) => {
      const data = new Float32Array(size * size);
      const center = size / 2;
      const radius = size / 2;

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = x - center;
          const dy = y - center;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // Soft edge for anti-aliasing
          if (dist < radius - 1) {
            data[y * size + x] = 1.0;
          } else if (dist < radius) {
            data[y * size + x] = radius - dist;
          }
        }
      }
      return data;
    };

    // Create atlas with just circle marker for now
    const circleData = circle(SPRITE_SIZE);

    const texture = new Texture2DArray(circleData, SPRITE_SIZE, SPRITE_SIZE);
    texture.wrapR = "clamp_to_edge";
    texture.wrapS = "clamp_to_edge";
    texture.wrapT = "clamp_to_edge";
    return texture;
  }

  /**
   * Get the number of visible points at current z-position
   * (points whose rendered size would be >= 0.1 pixels)
   */
  public get visiblePointCount(): number {
    return this.rawPoints_.filter((pt) => {
      const zDist = Math.abs(pt.z - this.currentZ_);
      const zScale = zDist / this.zFadeRadius_ + 1.0;
      const size = (this.pointSizePixels_ * (window.devicePixelRatio || 1)) / zScale;
      return size >= 0.1;
    }).length;
  }

  /**
   * Get total number of points
   */
  public get totalPointCount(): number {
    return this.rawPoints_.length;
  }
}

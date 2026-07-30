import { Layer, Points, type SliceOrientation } from "@idetik/core";
import { vec3 } from "gl-matrix";
import { AXIS_COMPONENT, planeAxes, type PlaneAxes } from "./orientation";

type PointProps = ConstructorParameters<typeof Points>[0][number];

export interface PicksLayerOptions {
  points: Array<{ x: number; y: number; z: number }>;
  color: [number, number, number, number];
  pointSizePixels: number;
  fadeRadius: number;
  orientation: SliceOrientation;
}

export class PicksLayer extends Layer {
  public readonly type = "PicksLayer";

  private readonly points_: Array<{ x: number; y: number; z: number }>;
  private readonly rgb_: [number, number, number]; // 0-1
  private readonly pointSizePixels_: number;
  private readonly fadeRadius_: number;
  private orientation_: SliceOrientation;
  private axes_: PlaneAxes;
  private slicePosition_ = 0;
  private needsUpdate_ = true;

  constructor({ points, color, pointSizePixels, fadeRadius, orientation }: PicksLayerOptions) {
    super({ blendMode: "normal" });
    this.points_ = points;
    this.rgb_ = [color[0] / 255, color[1] / 255, color[2] / 255];
    this.pointSizePixels_ = pointSizePixels;
    this.fadeRadius_ = fadeRadius;
    this.orientation_ = orientation;
    this.axes_ = planeAxes(orientation);
    this.refresh();
    this.setState("ready");
  }

  setOrientation(orientation: SliceOrientation): void {
    if (this.orientation_ !== orientation) {
      this.orientation_ = orientation;
      this.axes_ = planeAxes(orientation);
      this.needsUpdate_ = true;
    }
  }

  setSlicePosition(position: number): void {
    if (this.slicePosition_ !== position) {
      this.slicePosition_ = position;
      this.needsUpdate_ = true;
    }
  }

  update(): void {
    if (this.needsUpdate_) {
      this.refresh();
      this.needsUpdate_ = false;
    }
  }

  private refresh(): void {
    const [r, g, b] = this.rgb_;
    const dpr = window.devicePixelRatio || 1;
    const props: PointProps[] = [];
    const { u, v, w } = this.axes_;

    for (const pt of this.points_) {
      const zScale = Math.abs(pt[w] - this.slicePosition_) / this.fadeRadius_ + 1.0;
      const size = (this.pointSizePixels_ * dpr) / zScale;
      if (size < 0.1) continue;

      const position = vec3.create();
      position[AXIS_COMPONENT[u]] = pt[u];
      position[AXIS_COMPONENT[v]] = pt[v];
      position[AXIS_COMPONENT[w]] = this.slicePosition_;

      props.push({
        position,
        color: [r, g, b, 1.0 / zScale],
        size,
        marker: "circle",
      });
    }

    this.clearObjects();
    if (props.length > 0) {
      const points = new Points(props);
      points.depthTest = false;
      this.addObject(points);
    }
  }
}

import { Layer, Points } from "@idetik/core";
import { vec3 } from "gl-matrix";

type PointProps = ConstructorParameters<typeof Points>[0][number];

export interface PicksLayerOptions {
  points: Array<{ x: number; y: number; z: number }>;
  color: [number, number, number, number];
  pointSizePixels: number;
  zFadeRadius: number;
}

export class PicksLayer extends Layer {
  public readonly type = "PicksLayer";

  private readonly points_: Array<{ x: number; y: number; z: number }>;
  private readonly rgb_: [number, number, number]; // 0-1
  private readonly pointSizePixels_: number;
  private readonly zFadeRadius_: number;
  private currentZ_ = 0;
  private needsUpdate_ = true;

  constructor({
    points,
    color,
    pointSizePixels,
    zFadeRadius,
  }: PicksLayerOptions) {
    super({ blendMode: "normal" });
    this.points_ = points;
    this.rgb_ = [color[0] / 255, color[1] / 255, color[2] / 255];
    this.pointSizePixels_ = pointSizePixels;
    this.zFadeRadius_ = zFadeRadius;
    this.refresh();
    this.setState("ready");
  }

  setCurrentZ(z: number): void {
    if (this.currentZ_ !== z) {
      this.currentZ_ = z;
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

    for (const pt of this.points_) {
      const zScale = Math.abs(pt.z - this.currentZ_) / this.zFadeRadius_ + 1.0;
      const size = (this.pointSizePixels_ * dpr) / zScale;
      if (size < 0.1) continue;

      props.push({
        position: vec3.fromValues(pt.x, pt.y, 10),
        color: [r, g, b, 1.0 / zScale],
        size,
        marker: "circle",
      });
    }

    this.clearObjects();
    if (props.length > 0) {
      this.addObject(new Points(props));
    }
  }
}

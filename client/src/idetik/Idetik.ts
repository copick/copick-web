import { Idetik as IdetikRuntime, Layer, Overlay, OrthographicCamera, PanZoomControls } from "@idetik/core";

export class Idetik {
  private readonly runtime_: IdetikRuntime;
  private readonly camera_: OrthographicCamera;

  constructor(canvas: HTMLCanvasElement) {
    this.camera_ = new OrthographicCamera(0, 128, 0, 128, -1000, 1000);
    this.runtime_ = new IdetikRuntime({
      canvas,
      viewports: [{ camera: this.camera_, cameraControls: new PanZoomControls(this.camera_) }],
    });
    this.runtime_.start();
  }

  get canvas(): HTMLCanvasElement {
    return this.runtime_.canvas;
  }

  addLayer(layer: Layer): void {
    this.viewport_.addLayer(layer);
  }

  removeLayer(layer: Layer): void {
    if (this.viewport_.layers.includes(layer)) {
      this.viewport_.removeLayer(layer);
    }
  }

  addOverlay(overlay: Overlay): void {
    this.runtime_.addOverlay(overlay);
  }

  removeOverlay(overlay: Overlay): void {
    this.runtime_.removeOverlay(overlay);
  }

  frameTo(xRange: [number, number], yRange: [number, number]): void {
    this.camera_.setFrame(xRange[0], xRange[1], yRange[1], yRange[0]);
  }

  worldPerPixel(): number {
    return (this.camera_.transform.scale[0] * this.camera_.viewportSize[0]) / this.runtime_.canvas.clientWidth;
  }

  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = this.runtime_.canvas;
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / canvas.clientWidth) * 2 - 1;
    const ndcY = ((clientY - rect.top) / canvas.clientHeight) * 2 - 1;

    const transform = this.camera_.transform;
    const widthWorld = transform.scale[0] * this.camera_.viewportSize[0];
    const heightWorld = transform.scale[1] * this.camera_.viewportSize[1];

    return {
      x: transform.translation[0] + ndcX * (widthWorld / 2),
      y: transform.translation[1] + ndcY * (heightWorld / 2),
    };
  }

  dispose(): void {
    this.runtime_.stop();
  }

  private get viewport_() {
    return this.runtime_.viewports[0];
  }
}

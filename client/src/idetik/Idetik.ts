import {
  Idetik as IdetikRuntime,
  Layer,
  OrthographicCamera,
  Overlay,
  PanZoomControls,
  type SliceOrientation,
} from "@idetik/core";

export class Idetik {
  private readonly runtime_: IdetikRuntime;
  private readonly camera_: OrthographicCamera;

  constructor(canvas: HTMLCanvasElement, orientation: SliceOrientation = "XY") {
    this.camera_ = new OrthographicCamera(0, 128, 0, 128, { orientation });
    this.runtime_ = new IdetikRuntime({
      canvas,
      viewports: [
        {
          camera: this.camera_,
          cameraControls: new PanZoomControls(this.camera_),
        },
      ],
    });
    this.runtime_.start();
  }

  get canvas(): HTMLCanvasElement {
    return this.runtime_.canvas;
  }

  get orientation(): SliceOrientation {
    return this.camera_.orientation;
  }

  setOrientation(orientation: SliceOrientation): void {
    this.camera_.setOrientation(orientation);
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
    return (
      (this.camera_.transform.scale[0] * this.camera_.viewportSize[0]) /
      this.runtime_.canvas.clientWidth
    );
  }

  screenToWorld(
    clientX: number,
    clientY: number,
  ): { x: number; y: number; z: number } {
    const [x, y, z] = this.viewport_.clientToWorld([clientX, clientY]);
    return { x, y, z };
  }

  dispose(): void {
    this.runtime_.stop();
  }

  private get viewport_() {
    return this.runtime_.viewports[0];
  }
}

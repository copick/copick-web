/**
 * One idetik runtime with four viewports bound to DOM panes: XY, XZ and YZ
 * (orthographic camera + pan/zoom) and 3D (perspective camera + orbit).
 *
 * Replaces the old single-canvas `Idetik` wrapper; there is no "one canvas"
 * guard any more, each TomogramViewer owns one runtime. Adapted from
 * apex-agent's TomogramViewer (see NOTICE.md).
 */

import {
  Idetik,
  OrbitControls,
  OrthographicCamera,
  PanZoomControls,
  PerspectiveCamera,
  type Layer,
  type Overlay,
} from "@idetik/core";
import { vec3 } from "gl-matrix";
import {
  PLANES,
  VIEW_IDS,
  indicesToWorld,
  centerIndices,
  planeAxes,
  volumeSize,
  type Plane,
  type ViewId,
  type VolumeGeometry,
  type XYZ,
} from "./coordinates";

const MEMORY_LIMIT_MB = 2048;

export interface ViewerRuntimeOptions {
  canvas: HTMLCanvasElement;
  /** Pane elements in VIEW_IDS order (XY, XZ, YZ, 3D). */
  panes: HTMLElement[];
  geometry: VolumeGeometry;
}

export class ViewerRuntime {
  readonly idetik: Idetik;
  readonly geometry: VolumeGeometry;
  readonly canvas: HTMLCanvasElement;
  private readonly size_: number;
  private readonly center_: XYZ;
  private disposed_ = false;

  constructor({ canvas, panes, geometry }: ViewerRuntimeOptions) {
    if (panes.length !== 4)
      throw new Error("ViewerRuntime needs four pane elements.");
    this.canvas = canvas;
    this.geometry = geometry;
    const axes = geometry.axes;
    this.size_ = volumeSize(axes);
    this.center_ = indicesToWorld(centerIndices(axes), axes);

    const ortho = PLANES.map((plane, i) => {
      const camera = ViewerRuntime.frameCamera(plane, geometry);
      return {
        id: plane,
        element: panes[i],
        camera,
        cameraControls: new PanZoomControls(camera),
        layers: [] as Layer[],
      };
    });
    const camera3d = new PerspectiveCamera({
      near: this.size_ / 10000,
      far: this.size_ * 20,
    });
    // Native front-to-back volume compositing requires alpha=0; CSS provides the dark backdrop.
    // Each 2D view of a 3D chunk uploads the whole chunk (a 256³ float32 chunk is 64 MB), so
    // the budget is idetik's default rather than apex's 512 MB, which a single full-resolution
    // XY slice of a portal tomogram already exceeds (label layers then never get a slot).
    this.idetik = new Idetik({
      canvas,
      memoryLimitMB: MEMORY_LIMIT_MB,
      maxConcurrentRequests: 6,
      maxGpuUploadsPerUpdate: 2,
      backgroundColor: [0, 0, 0, 0],
      viewports: [
        ...ortho,
        {
          id: "3D",
          element: panes[3],
          camera: camera3d,
          cameraControls: this.orbitControls(
            camera3d,
            this.center_,
            this.size_ * 1.35,
          ),
          layers: [],
        },
      ],
    });
  }

  private static frameCamera(
    plane: Plane,
    geometry: VolumeGeometry,
  ): OrthographicCamera {
    const [u, v] = planeAxes[plane];
    const a = geometry.axes[u];
    const b = geometry.axes[v];
    return new OrthographicCamera(
      a.translation,
      a.translation + a.size * a.scale,
      b.translation + b.size * b.scale,
      b.translation,
      { orientation: plane },
    );
  }

  private orbitControls(
    camera: PerspectiveCamera,
    target: XYZ,
    radius: number,
  ) {
    return new OrbitControls(camera, {
      target: vec3.fromValues(target[0], target[1], target[2]),
      radius,
      yaw: 0.4,
      pitch: 0.25,
    });
  }

  get disposed(): boolean {
    return this.disposed_;
  }

  get center(): XYZ {
    return this.center_;
  }

  get size(): number {
    return this.size_;
  }

  viewport(id: ViewId) {
    const viewport = this.idetik.getViewport(id);
    if (!viewport) throw new Error(`Unknown viewport ${id}`);
    return viewport;
  }

  addLayer(id: ViewId, layer: Layer): void {
    if (this.disposed_) return;
    const viewport = this.viewport(id);
    if (!viewport.layers.includes(layer)) viewport.addLayer(layer);
  }

  /**
   * Add a layer beneath the view's other layers (idetik draws layers in the
   * order they were added). Used for the density, so overlays added earlier
   * stay on top when a pane is shown again.
   */
  addLayerAtBottom(id: ViewId, layer: Layer): void {
    if (this.disposed_) return;
    const viewport = this.viewport(id);
    if (viewport.layers.includes(layer)) return;
    const others = [...viewport.layers];
    for (const other of others) viewport.removeLayer(other);
    viewport.addLayer(layer);
    for (const other of others) viewport.addLayer(other);
  }

  removeLayer(id: ViewId, layer: Layer): void {
    if (this.disposed_) return;
    const viewport = this.idetik.getViewport(id);
    if (viewport?.layers.includes(layer)) viewport.removeLayer(layer);
  }

  hasLayer(id: ViewId, layer: Layer): boolean {
    return this.idetik.getViewport(id)?.layers.includes(layer) ?? false;
  }

  addOverlay(overlay: Overlay): void {
    this.idetik.addOverlay(overlay);
  }

  removeOverlay(overlay: Overlay): void {
    this.idetik.removeOverlay(overlay);
  }

  /** World coordinates under a client position in an ortho view (the slice axis is the camera's). */
  clientToWorld(id: Plane, clientX: number, clientY: number): XYZ {
    const world = this.viewport(id).clientToWorld([clientX, clientY]);
    return [world[0], world[1], world[2]];
  }

  /** World units per CSS pixel along a view's horizontal axis, measured on that view's own pane. */
  worldPerPixel(id: Plane): number {
    const element = this.viewport(id).element;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0) return 0;
    const u = planeAxes[id][0];
    const p0 = this.viewport(id).clientToWorld([rect.left, rect.top]);
    const p1 = this.viewport(id).clientToWorld([rect.left + 100, rect.top]);
    return Math.abs(p1[u] - p0[u]) / 100;
  }

  /** Where a world point projects in a view, in percent of the pane (left, top). */
  projectToPane(id: Plane, world: XYZ): [number, number] {
    const camera = this.viewport(id).camera;
    const clip = vec3.transformMat4(
      vec3.create(),
      vec3.fromValues(world[0], world[1], world[2]),
      camera.getViewProjection(),
    );
    return [(clip[0] + 1) * 50, (1 + clip[1]) * 50];
  }

  /** Reframe one ortho view on the whole volume. */
  resetView(id: Plane): void {
    const viewport = this.viewport(id);
    const [u, v] = planeAxes[id];
    const a = this.geometry.axes[u];
    const b = this.geometry.axes[v];
    (viewport.camera as OrthographicCamera).setFrame(
      a.translation,
      a.translation + a.size * a.scale,
      b.translation,
      b.translation + b.size * b.scale,
    );
    viewport.updateSize();
  }

  /** Re-target the 3D orbit at a world point. */
  focusOrbit(world: XYZ, radius = this.size_ * 0.6): void {
    if (this.disposed_) return;
    const viewport = this.viewport("3D");
    viewport.cameraControls = this.orbitControls(
      viewport.camera as PerspectiveCamera,
      world,
      radius,
    );
  }

  updateSizes(): void {
    if (this.disposed_) return;
    for (const viewport of this.idetik.viewports) viewport.updateSize();
  }

  start(): void {
    this.idetik.start();
  }

  dispose(): void {
    if (this.disposed_) return;
    this.disposed_ = true;
    this.idetik.stop();
    for (const viewport of [...this.idetik.viewports]) {
      for (const layer of [...viewport.layers]) viewport.removeLayer(layer);
      this.idetik.removeViewport(viewport);
    }
  }
}

export { VIEW_IDS };

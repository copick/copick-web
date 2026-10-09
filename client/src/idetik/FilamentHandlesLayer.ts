/**
 * Control-point handles of the filament set being edited, on one ortho view:
 * handles within the slab around the slice, drawn on the slice and fading with
 * distance; the active filament's handles larger and brighter. Like the other
 * overlays, the layer rebuilds only when its slice changes.
 */

import { Layer, Points, type SliceCoordinates } from "@idetik/core";
import { vec3 } from "gl-matrix";
import { AXES, planeAxes, type Plane, type XYZ } from "./coordinates";

type PointProps = ConstructorParameters<typeof Points>[0][number];
type Rgba255 = [number, number, number, number];

export interface FilamentHandle {
  /** World units. */
  position: XYZ;
  color: Rgba255;
  active: boolean;
}

export interface FilamentHandlesOptions {
  handles: FilamentHandle[];
  view: Plane;
  sliceCoords: SliceCoordinates;
  /** Handles farther than this from the slice (world units) are not drawn. */
  halfThickness: number;
}

const SIZE = 7;
const ACTIVE_SIZE = 10;

export class FilamentHandlesLayer extends Layer {
  public readonly type = "FilamentHandlesLayer";

  private readonly options_: FilamentHandlesOptions;
  private lastSlice_: number | undefined = undefined;
  private built_ = false;

  constructor(options: FilamentHandlesOptions) {
    super({ blendMode: "normal" });
    this.options_ = options;
    this.update();
    this.setState("ready");
  }

  update(): void {
    const { view, sliceCoords } = this.options_;
    const slice = sliceCoords[AXES[planeAxes[view][2]]] ?? 0;
    if (!this.built_ || slice !== this.lastSlice_) this.rebuild(slice);
  }

  private rebuild(slice: number): void {
    this.built_ = true;
    this.lastSlice_ = slice;
    const { handles, view, halfThickness } = this.options_;
    const w = planeAxes[view][2];
    const dpr = window.devicePixelRatio || 1;
    const props: PointProps[] = [];
    const add = (
      xyz: XYZ,
      color: [number, number, number, number],
      size: number,
    ) =>
      props.push({
        position: vec3.fromValues(xyz[0], xyz[1], xyz[2]),
        color,
        size: size * dpr,
        marker: "square",
      });
    // Inactive handles first, so the active filament's are drawn on top.
    for (const pass of [false, true]) {
      for (const h of handles) {
        if (h.active !== pass) continue;
        const distance = Math.abs(h.position[w] - slice);
        if (distance > halfThickness) continue;
        const fade = 1 - (0.6 * distance) / Math.max(halfThickness, 1e-9);
        const onPlane = [...h.position] as XYZ;
        onPlane[w] = slice;
        const size = h.active ? ACTIVE_SIZE : SIZE;
        // An outline (a larger dark square underneath) keeps handles visible on any background.
        add(onPlane, [0, 0, 0, 0.8 * fade], size + 3);
        const c = h.active
          ? [1, 1, 1, fade]
          : [h.color[0] / 255, h.color[1] / 255, h.color[2] / 255, fade];
        add(onPlane, c as [number, number, number, number], size);
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

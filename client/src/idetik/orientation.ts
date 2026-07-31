import type { SliceOrientation } from "@idetik/core";

export type SpatialAxis = "x" | "y" | "z";

export type PlaneAxes = { u: SpatialAxis; v: SpatialAxis; w: SpatialAxis };

export function toSliceOrientation(axis: "xy" | "xz" | "yz"): SliceOrientation {
  switch (axis) {
    case "xy":
      return "XY";
    case "xz":
      return "XZ";
    case "yz":
      return "YZ";
  }
}

export function planeAxes(orientation: SliceOrientation): PlaneAxes {
  switch (orientation) {
    case "XY":
      return { u: "x", v: "y", w: "z" };
    case "XZ":
      return { u: "x", v: "z", w: "y" };
    case "YZ":
      return { u: "y", v: "z", w: "x" };
  }
}

export const AXIS_COMPONENT: Record<SpatialAxis, 0 | 1 | 2> = {
  x: 0,
  y: 1,
  z: 2,
};

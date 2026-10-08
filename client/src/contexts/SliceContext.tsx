/**
 * The crosshair: slice indices along X, Y and Z, and helpers to step a slice
 * or focus a world position. Only slice-dependent UI (sliders, labels)
 * subscribes; layers read the shared `sliceCoords` instead.
 */

import { createContext, useContext } from "react";
import type { XYZ } from "@/idetik/coordinates";

export interface SliceContextType {
  indices: XYZ;
  setIndex: (axis: number, index: number) => void;
  step: (axis: number, delta: number) => void;
  /** Move the crosshair to a position in Å; optionally re-target the 3D orbit. */
  focusAngstrom: (xyz: XYZ, options?: { orbit?: boolean }) => void;
}

export const SliceContext = createContext<SliceContextType | null>(null);

export function useSlice(): SliceContextType {
  const context = useContext(SliceContext);
  if (!context)
    throw new Error("useSlice must be used within a TomogramViewer");
  return context;
}

/** Like useSlice, but returns null outside a viewer (e.g. in the sidebar). */
export function useOptionalSlice(): SliceContextType | null {
  return useContext(SliceContext);
}

/**
 * A bridge from the sidebar (instance browser, filament list) to the viewer:
 * the viewer registers its `focusAngstrom`, the sidebar calls it. A ref keeps
 * slice changes from re-rendering the sidebar.
 */
export interface ViewerBridge {
  focusAngstrom: (xyz: XYZ, options?: { orbit?: boolean }) => void;
  register: (focus: SliceContextType["focusAngstrom"] | null) => void;
}

export const ViewerBridgeContext = createContext<ViewerBridge>({
  focusAngstrom: () => undefined,
  register: () => undefined,
});

export function useViewerBridge(): ViewerBridge {
  return useContext(ViewerBridgeContext);
}

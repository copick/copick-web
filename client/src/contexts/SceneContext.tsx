/**
 * The loaded scene: the idetik runtime, the volume geometry and the shared
 * crosshair `sliceCoords` that every image, label, pick and filament layer
 * reads each frame. Changes only when a tomogram is (re)loaded, its loading
 * stage advances or the visible panes change.
 */

import { createContext, useContext } from "react";
import type {
  ImageLayer,
  OmeZarrImageSource,
  SliceCoordinates,
} from "@idetik/core";
import type { ViewerRuntime } from "@/idetik/ViewerRuntime";
import type { VolumeGeometry, XYZ } from "@/idetik/coordinates";

export type LoadingStage = "xy" | "slices" | "volume" | "ready";

export interface Scene {
  runtime: ViewerRuntime;
  geometry: VolumeGeometry;
  source: OmeZarrImageSource;
  /** Shared crosshair position in world units; mutated in place. */
  sliceCoords: SliceCoordinates;
  /** One image layer per ortho plane (XY, XZ, YZ). */
  images: ImageLayer[];
  maxLod: number;
  /** Points a double-click snaps to (world units), registered by overlays. */
  snapTargets: Map<string, { points: XYZ[]; radius: number }>;
}

export interface SceneContextType {
  scene: Scene | null;
  stage: LoadingStage;
  /** Panes currently shown (XY, XZ, YZ, 3D). */
  visible: boolean[];
}

export const SceneContext = createContext<SceneContextType>({
  scene: null,
  stage: "xy",
  visible: [true, false, false, false],
});

export function useScene(): SceneContextType {
  return useContext(SceneContext);
}

/** The runtime of the current scene, or null while it loads. */
export function useViewerRuntime(): ViewerRuntime | null {
  return useContext(SceneContext).scene?.runtime ?? null;
}

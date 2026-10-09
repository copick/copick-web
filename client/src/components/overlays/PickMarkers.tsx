/**
 * Draws a set of pick markers in every visible view (one PickMarkersLayer per
 * view) and registers them as double-click snap targets.
 */

import { useEffect, useMemo } from "react";
import { VIEW_IDS } from "@/idetik/coordinates";
import {
  PickMarkersLayer,
  type MarkerPoint,
  type MarkerStyle,
} from "@/idetik/PickMarkersLayer";
import { useScene } from "@/contexts/SceneContext";
import { usePerViewportLayers } from "@/components/viewer/usePerViewportLayers";

/** Distance over which dots shrink to half size, in Å (as before the multi-view port). */
const FADE_RADIUS_ANGSTROM = 64;
/** Dot diameter (voxels) when zoomed in, for objects without a radius. */
const DEFAULT_DOT_VOXELS = 4;

interface PickMarkersProps {
  id: string;
  markers: MarkerPoint[];
  style: MarkerStyle;
  /** Object radius in Å, or null. */
  radiusAngstrom: number | null;
  pointSizePixels: number;
}

export function PickMarkers({
  id,
  markers,
  style,
  radiusAngstrom,
  pointSizePixels,
}: PickMarkersProps) {
  const { scene } = useScene();
  const perUnit = scene?.geometry.angstromPerUnit ?? 1;
  const radius =
    radiusAngstrom && radiusAngstrom > 0 ? radiusAngstrom / perUnit : null;
  const fadeRadius = FADE_RADIUS_ANGSTROM / perUnit;
  const voxel = scene
    ? Math.min(...scene.geometry.axes.map((a) => a.scale))
    : null;
  // Zoomed in, a dot covers the object's radius (half its width, so the density stays visible).
  const dotDiameter = radius ?? (voxel ? voxel * DEFAULT_DOT_VOXELS : null);

  usePerViewportLayers(
    VIEW_IDS,
    scene && markers.length > 0
      ? (view) =>
          new PickMarkersLayer({
            points: markers,
            view,
            sliceCoords: scene.sliceCoords,
            style,
            radius,
            pointSizePixels,
            dotDiameter,
            fadeRadius,
          })
      : null,
    [markers, style, radius, pointSizePixels, dotDiameter, fadeRadius],
  );

  const positions = useMemo(() => markers.map((m) => m.position), [markers]);
  useEffect(() => {
    if (!scene) return;
    const voxel = Math.min(...scene.geometry.axes.map((a) => a.scale));
    scene.snapTargets.set(id, {
      points: positions,
      radius: radius ?? voxel * 4,
    });
    return () => {
      scene.snapTargets.delete(id);
    };
  }, [scene, id, positions, radius]);

  return null;
}

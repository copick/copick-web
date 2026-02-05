/**
 * Picks overlay that renders particle locations using idetik's Points layer.
 *
 * Uses the PicksLayer class which integrates with idetik's WebGL rendering
 * for efficient rendering of large numbers of points with z-depth based
 * visibility and scaling.
 */

import { useEffect, useRef } from "react";
import { useIdetik } from "@idetik/react";
import { useCopick } from "@/contexts/CopickContext";
import { usePickPoints } from "@/api/hooks";
import { PicksLayer } from "./layers/PicksLayer";

// Default values that work well visually
const DEFAULT_POINT_SIZE_PIXELS = 30; // Base size in screen pixels
const DEFAULT_Z_FADE_FACTOR = 64.0; // Angstroms - controls how quickly points fade with z-distance

interface PicksOverlayProps {
  currentZIndex: number;
}

export function PicksOverlay({ currentZIndex }: PicksOverlayProps) {
  const { state: copickState } = useCopick();

  // Get all visible picks
  const visiblePicks = copickState.selectedPicks.filter((p) => p.visible);

  if (visiblePicks.length === 0) {
    return null;
  }

  return (
    <>
      {visiblePicks.map((pick) => (
        <PickPointsLayer
          key={`${pick.objectName}-${pick.userId}-${pick.sessionId}`}
          objectName={pick.objectName}
          userId={pick.userId}
          sessionId={pick.sessionId}
          currentZIndex={currentZIndex}
        />
      ))}
    </>
  );
}

interface PickPointsLayerProps {
  objectName: string;
  userId: string;
  sessionId: string;
  currentZIndex: number;
}

function PickPointsLayer({
  objectName,
  userId,
  sessionId,
  currentZIndex,
}: PickPointsLayerProps) {
  const { state } = useCopick();
  const { runtime } = useIdetik();
  const layerRef = useRef<PicksLayer | null>(null);

  // Get voxel spacing to convert slice index to Angstroms
  const voxelSpacing = state.selectedVoxelSize ?? 20;

  // Fetch the pick points
  const { data: picks } = usePickPoints(state.selectedRunName, objectName, userId, sessionId);

  // Create/update layer when picks data changes
  useEffect(() => {
    if (!runtime || !picks || picks.points.length === 0) {
      return;
    }

    const layerManager = runtime.viewports[0]?.layerManager;
    if (!layerManager) {
      return;
    }

    // Remove old layer if it exists
    if (layerRef.current) {
      layerManager.remove(layerRef.current);
      layerRef.current = null;
    }

    // Create new layer with the points using default visual settings
    const layer = new PicksLayer({
      points: picks.points.map((pt) => ({ x: pt.x, y: pt.y, z: pt.z })),
      color: picks.color,
      pointSizePixels: DEFAULT_POINT_SIZE_PIXELS,
      zFadeRadius: DEFAULT_Z_FADE_FACTOR,
    });

    // Convert slice index to Angstroms (same units as point coordinates)
    const currentZInAngstroms = currentZIndex * voxelSpacing;
    layer.setCurrentZ(currentZInAngstroms);

    // Add to layer manager
    layerManager.add(layer);
    layerRef.current = layer;

    // Cleanup on unmount or data change
    return () => {
      if (layerRef.current && layerManager.layers.includes(layerRef.current)) {
        layerManager.remove(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [runtime, picks]);

  // Update z-position when slice changes
  useEffect(() => {
    if (layerRef.current) {
      const currentZInAngstroms = currentZIndex * voxelSpacing;
      layerRef.current.setCurrentZ(currentZInAngstroms);
    }
  }, [currentZIndex, voxelSpacing]);

  return null;
}

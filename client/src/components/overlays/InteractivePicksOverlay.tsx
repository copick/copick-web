/**
 * Interactive picks overlay that supports both viewing and editing modes.
 * Renders both read-only picks and editable picks being modified.
 *
 * When editing, the picks being edited are rendered from local state
 * instead of fetched data, allowing real-time visual feedback.
 */

import { useEffect, useRef } from "react";
import { useIdetik } from "@idetik/react";
import { useCopick } from "@/contexts/CopickContext";
import { usePicking, type PickingPoint } from "@/contexts/PickingContext";
import { usePickPoints } from "@/api/hooks";
import { PicksLayer } from "./layers/PicksLayer";

const DEFAULT_POINT_SIZE_PIXELS = 30;
const DEFAULT_Z_FADE_FACTOR = 64.0;
const SELECTED_POINT_SIZE_PIXELS = 40; // Larger for selected points

interface InteractivePicksOverlayProps {
  currentZIndex: number;
  voxelSpacing: number;
}

export function InteractivePicksOverlay({ currentZIndex, voxelSpacing }: InteractivePicksOverlayProps) {
  const { state: copickState } = useCopick();
  const { state: pickingState, isEditing } = usePicking();

  // Get all visible picks
  const visiblePicks = copickState.selectedPicks.filter((p) => p.visible);

  return (
    <>
      {/* Read-only picks (excluding the one being edited) */}
      {visiblePicks
        .filter(
          (pick) =>
            !isEditing ||
            pick.objectName !== pickingState.editingPicks?.objectName ||
            pick.userId !== pickingState.editingPicks?.userId ||
            pick.sessionId !== pickingState.editingPicks?.sessionId
        )
        .map((pick) => (
          <ReadOnlyPickPointsLayer
            key={`${pick.objectName}-${pick.userId}-${pick.sessionId}`}
            objectName={pick.objectName}
            userId={pick.userId}
            sessionId={pick.sessionId}
            currentZIndex={currentZIndex}
            voxelSpacing={voxelSpacing}
          />
        ))}

      {/* Editable picks layer */}
      {isEditing && pickingState.editingPicks && (
        <EditablePicksLayer
          points={pickingState.localPoints}
          selectedIds={pickingState.selectedPointIds}
          color={pickingState.editingPicks.color}
          currentZIndex={currentZIndex}
          voxelSpacing={voxelSpacing}
        />
      )}
    </>
  );
}

// Read-only layer (same as existing PickPointsLayer)
interface ReadOnlyPickPointsLayerProps {
  objectName: string;
  userId: string;
  sessionId: string;
  currentZIndex: number;
  voxelSpacing: number;
}

function ReadOnlyPickPointsLayer({
  objectName,
  userId,
  sessionId,
  currentZIndex,
  voxelSpacing,
}: ReadOnlyPickPointsLayerProps) {
  const { state } = useCopick();
  const { runtime } = useIdetik();
  const layerRef = useRef<PicksLayer | null>(null);

  const { data: picks } = usePickPoints(state.selectedRunName, objectName, userId, sessionId);

  useEffect(() => {
    if (!runtime || !picks || picks.points.length === 0) {
      return;
    }

    const layerManager = runtime.viewports[0]?.layerManager;
    if (!layerManager) return;

    if (layerRef.current) {
      layerManager.remove(layerRef.current);
      layerRef.current = null;
    }

    const layer = new PicksLayer({
      points: picks.points.map((pt) => ({ x: pt.x, y: pt.y, z: pt.z })),
      color: picks.color,
      pointSizePixels: DEFAULT_POINT_SIZE_PIXELS,
      zFadeRadius: DEFAULT_Z_FADE_FACTOR,
    });

    const currentZInAngstroms = currentZIndex * voxelSpacing;
    layer.setCurrentZ(currentZInAngstroms);

    layerManager.add(layer);
    layerRef.current = layer;

    return () => {
      if (layerRef.current && layerManager.layers.includes(layerRef.current)) {
        layerManager.remove(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [runtime, picks]);

  useEffect(() => {
    if (layerRef.current) {
      const currentZInAngstroms = currentZIndex * voxelSpacing;
      layerRef.current.setCurrentZ(currentZInAngstroms);
    }
  }, [currentZIndex, voxelSpacing]);

  return null;
}

// Editable layer with selection highlighting
interface EditablePicksLayerProps {
  points: PickingPoint[];
  selectedIds: Set<string>;
  color: [number, number, number, number];
  currentZIndex: number;
  voxelSpacing: number;
}

function EditablePicksLayer({ points, selectedIds, color, currentZIndex, voxelSpacing }: EditablePicksLayerProps) {
  const { runtime } = useIdetik();
  const normalLayerRef = useRef<PicksLayer | null>(null);
  const selectedLayerRef = useRef<PicksLayer | null>(null);

  useEffect(() => {
    if (!runtime) return;

    const layerManager = runtime.viewports[0]?.layerManager;
    if (!layerManager) return;

    // Clean up old layers
    if (normalLayerRef.current && layerManager.layers.includes(normalLayerRef.current)) {
      layerManager.remove(normalLayerRef.current);
    }
    if (selectedLayerRef.current && layerManager.layers.includes(selectedLayerRef.current)) {
      layerManager.remove(selectedLayerRef.current);
    }
    normalLayerRef.current = null;
    selectedLayerRef.current = null;

    const normalPoints = points.filter((p) => !selectedIds.has(p.id));
    const selectedPoints = points.filter((p) => selectedIds.has(p.id));
    const currentZInAngstroms = currentZIndex * voxelSpacing;

    // Normal points layer
    if (normalPoints.length > 0) {
      const normalLayer = new PicksLayer({
        points: normalPoints.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        color,
        pointSizePixels: DEFAULT_POINT_SIZE_PIXELS,
        zFadeRadius: DEFAULT_Z_FADE_FACTOR,
      });
      normalLayer.setCurrentZ(currentZInAngstroms);
      layerManager.add(normalLayer);
      normalLayerRef.current = normalLayer;
    }

    // Selected points layer (brighter, larger)
    if (selectedPoints.length > 0) {
      // Use a brighter version of the color for selection
      const highlightColor: [number, number, number, number] = [
        Math.min(255, color[0] + 80),
        Math.min(255, color[1] + 80),
        Math.min(255, color[2] + 80),
        255,
      ];

      const selectedLayer = new PicksLayer({
        points: selectedPoints.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        color: highlightColor,
        pointSizePixels: SELECTED_POINT_SIZE_PIXELS,
        zFadeRadius: DEFAULT_Z_FADE_FACTOR,
      });
      selectedLayer.setCurrentZ(currentZInAngstroms);
      layerManager.add(selectedLayer);
      selectedLayerRef.current = selectedLayer;
    }

    return () => {
      if (normalLayerRef.current && layerManager.layers.includes(normalLayerRef.current)) {
        layerManager.remove(normalLayerRef.current);
      }
      if (selectedLayerRef.current && layerManager.layers.includes(selectedLayerRef.current)) {
        layerManager.remove(selectedLayerRef.current);
      }
      normalLayerRef.current = null;
      selectedLayerRef.current = null;
    };
  }, [runtime, points, selectedIds, color, currentZIndex, voxelSpacing]);

  // Update z-position when slice changes (without recreating layers)
  useEffect(() => {
    const currentZInAngstroms = currentZIndex * voxelSpacing;
    normalLayerRef.current?.setCurrentZ(currentZInAngstroms);
    selectedLayerRef.current?.setCurrentZ(currentZInAngstroms);
  }, [currentZIndex, voxelSpacing]);

  return null;
}

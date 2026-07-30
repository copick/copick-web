import { useMemo } from "react";
import type { SliceOrientation } from "@idetik/core";
import { Idetik } from "@/idetik/Idetik";
import { PointsLayer } from "@/idetik/components/PointsLayer";
import { useCopick } from "@/contexts/CopickContext";
import { usePicking, type PickingPoint } from "@/contexts/PickingContext";
import { usePickPoints } from "@/api/hooks";

const DEFAULT_POINT_SIZE_PIXELS = 30;
const SELECTED_POINT_SIZE_PIXELS = 40; // larger for selected points

type Rgba = [number, number, number, number];

interface InteractivePicksOverlayProps {
  viewer: Idetik | null;
  orientation: SliceOrientation;
  sliceIndex: number;
  voxelSpacing: number;
}

export function InteractivePicksOverlay({
  viewer,
  orientation,
  sliceIndex,
  voxelSpacing,
}: InteractivePicksOverlayProps) {
  const { state: copickState } = useCopick();
  const { state: pickingState, isEditing } = usePicking();

  const slicePosition = sliceIndex * voxelSpacing;
  const visiblePicks = copickState.selectedPicks.filter((p) => p.visible);

  if (!viewer) {
    return null;
  }

  return (
    <>
      {visiblePicks
        .filter(
          (pick) =>
            !isEditing ||
            pick.objectName !== pickingState.editingPicks?.objectName ||
            pick.userId !== pickingState.editingPicks?.userId ||
            pick.sessionId !== pickingState.editingPicks?.sessionId,
        )
        .map((pick) => (
          <ReadOnlyPicks
            key={`${pick.objectName}-${pick.userId}-${pick.sessionId}`}
            viewer={viewer}
            objectName={pick.objectName}
            userId={pick.userId}
            sessionId={pick.sessionId}
            orientation={orientation}
            slicePosition={slicePosition}
          />
        ))}

      {isEditing && pickingState.editingPicks && (
        <EditablePicks
          viewer={viewer}
          points={pickingState.localPoints}
          selectedIds={pickingState.selectedPointIds}
          color={pickingState.editingPicks.color}
          orientation={orientation}
          slicePosition={slicePosition}
        />
      )}
    </>
  );
}

function ReadOnlyPicks({
  viewer,
  objectName,
  userId,
  sessionId,
  orientation,
  slicePosition,
}: {
  viewer: Idetik;
  objectName: string;
  userId: string;
  sessionId: string;
  orientation: SliceOrientation;
  slicePosition: number;
}) {
  const { state } = useCopick();
  const { data: picks } = usePickPoints(
    state.selectedRunName,
    objectName,
    userId,
    sessionId,
  );
  return (
    <PointsLayer
      viewer={viewer}
      points={picks?.points}
      color={picks?.color}
      pointSizePixels={DEFAULT_POINT_SIZE_PIXELS}
      orientation={orientation}
      slicePosition={slicePosition}
    />
  );
}

function EditablePicks({
  viewer,
  points,
  selectedIds,
  color,
  orientation,
  slicePosition,
}: {
  viewer: Idetik;
  points: PickingPoint[];
  selectedIds: Set<string>;
  color: Rgba;
  orientation: SliceOrientation;
  slicePosition: number;
}) {
  const normalPoints = useMemo(
    () => points.filter((p) => !selectedIds.has(p.id)),
    [points, selectedIds],
  );
  const selectedPoints = useMemo(
    () => points.filter((p) => selectedIds.has(p.id)),
    [points, selectedIds],
  );
  const highlightColor = useMemo<Rgba>(
    () => [
      Math.min(255, color[0] + 80),
      Math.min(255, color[1] + 80),
      Math.min(255, color[2] + 80),
      255,
    ],
    [color],
  );

  return (
    <>
      <PointsLayer
        viewer={viewer}
        points={normalPoints}
        color={color}
        pointSizePixels={DEFAULT_POINT_SIZE_PIXELS}
        orientation={orientation}
        slicePosition={slicePosition}
      />
      <PointsLayer
        viewer={viewer}
        points={selectedPoints}
        color={highlightColor}
        pointSizePixels={SELECTED_POINT_SIZE_PIXELS}
        orientation={orientation}
        slicePosition={slicePosition}
      />
    </>
  );
}

import { useMemo } from "react";
import { Idetik } from "@/idetik/Idetik";
import { PointsLayer } from "@/idetik/components/PointsLayer";
import { useCopick, useProjectId } from "@/contexts/CopickContext";
import { usePicking, type PickingPoint } from "@/contexts/PickingContext";
import { usePickPoints } from "@/api/hooks";

const DEFAULT_POINT_SIZE_PIXELS = 30;
const SELECTED_POINT_SIZE_PIXELS = 40; // larger for selected points

type Rgba = [number, number, number, number];

interface InteractivePicksOverlayProps {
  viewer: Idetik | null;
  currentZIndex: number;
  voxelSpacing: number;
}

export function InteractivePicksOverlay({
  viewer,
  currentZIndex,
  voxelSpacing,
}: InteractivePicksOverlayProps) {
  const { state: copickState } = useCopick();
  const { state: pickingState, isEditing } = usePicking();

  const worldZ = currentZIndex * voxelSpacing;
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
            worldZ={worldZ}
          />
        ))}

      {isEditing && pickingState.editingPicks && (
        <EditablePicks
          viewer={viewer}
          points={pickingState.localPoints}
          selectedIds={pickingState.selectedPointIds}
          color={pickingState.editingPicks.color}
          worldZ={worldZ}
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
  worldZ,
}: {
  viewer: Idetik;
  objectName: string;
  userId: string;
  sessionId: string;
  worldZ: number;
}) {
  const { state } = useCopick();
  const projectId = useProjectId();
  const { data: picks } = usePickPoints(
    projectId,
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
      worldZ={worldZ}
    />
  );
}

function EditablePicks({
  viewer,
  points,
  selectedIds,
  color,
  worldZ,
}: {
  viewer: Idetik;
  points: PickingPoint[];
  selectedIds: Set<string>;
  color: Rgba;
  worldZ: number;
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
        worldZ={worldZ}
      />
      <PointsLayer
        viewer={viewer}
        points={selectedPoints}
        color={highlightColor}
        pointSizePixels={SELECTED_POINT_SIZE_PIXELS}
        worldZ={worldZ}
      />
    </>
  );
}

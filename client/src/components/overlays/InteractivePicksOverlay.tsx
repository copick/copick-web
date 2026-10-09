/**
 * Pick overlays: read-only picks for every visible picks set, and the set
 * being edited (from PickingContext). Points are drawn at their particle
 * centre (location + transform translation). Filament objects, and sets with
 * "colour by instance" on, colour each point by its instance ID with the
 * shared instance palette.
 */

import { useMemo } from "react";
import { useCopick, type PickSelection } from "@/contexts/CopickContext";
import {
  pointCentre,
  usePicking,
  type PickingPoint,
} from "@/contexts/PickingContext";
import { useLayout } from "@/contexts/LayoutContext";
import { useScene } from "@/contexts/SceneContext";
import { useObjects, usePickPoints } from "@/api/hooks";
import type { PickableObjectResponse } from "@/api/types";
import { angstromToWorld } from "@/idetik/coordinates";
import type { MarkerPoint } from "@/idetik/PickMarkersLayer";
import { instanceColor, type Rgba255 } from "@/utils/instanceColors";
import { PickMarkers } from "./PickMarkers";

const POINT_SIZE_PIXELS = 24;
/** Filament picks are dense (one every few voxels along the axis): smaller dots keep them readable. */
const FILAMENT_POINT_SIZE_PIXELS = 10;

export function InteractivePicksOverlay() {
  const { state: copickState } = useCopick();
  const { state: pickingState, isEditing } = usePicking();
  const { data: objects } = useObjects();
  const { scene } = useScene();

  if (!scene) return null;

  const editing = pickingState.editingPicks;
  const visiblePicks = copickState.selectedPicks.filter(
    (pick) =>
      pick.visible &&
      !(
        isEditing &&
        pick.objectName === editing?.objectName &&
        pick.userId === editing?.userId &&
        pick.sessionId === editing?.sessionId
      ),
  );

  return (
    <>
      {visiblePicks.map((pick) => (
        <ReadOnlyPicks
          key={`${pick.objectName}-${pick.userId}-${pick.sessionId}`}
          pick={pick}
          object={objects?.find((o) => o.name === pick.objectName)}
        />
      ))}
      {isEditing && editing && (
        <EditablePicks
          points={pickingState.localPoints}
          selectedIds={pickingState.selectedPointIds}
          color={editing.color}
          byInstance={!!editing.isFilament}
          object={objects?.find((o) => o.name === editing.objectName)}
        />
      )}
    </>
  );
}

function useMarkers(
  points:
    | (
        | PickingPoint
        | {
            x: number;
            y: number;
            z: number;
            instance_id: number | null;
            transformation?: number[][] | null;
            id?: string;
          }
      )[]
    | undefined,
  color: Rgba255 | undefined,
  byInstance: boolean,
  selectedIds?: Set<string>,
): MarkerPoint[] {
  const { scene } = useScene();
  const perUnit = scene?.geometry.angstromPerUnit ?? 1;
  return useMemo(() => {
    if (!points || !color) return [];
    return points.map((p) => ({
      position: angstromToWorld(pointCentre(p), perUnit),
      color: byInstance ? instanceColor(p.instance_id, color) : color,
      selected: !!(selectedIds && "id" in p && p.id && selectedIds.has(p.id)),
    }));
  }, [points, color, byInstance, selectedIds, perUnit]);
}

function ReadOnlyPicks({
  pick,
  object,
}: {
  pick: PickSelection;
  object: PickableObjectResponse | undefined;
}) {
  const { state } = useCopick();
  const { markerStyle } = useLayout();
  const { data } = usePickPoints(
    state.selectedRunName,
    pick.objectName,
    pick.userId,
    pick.sessionId,
  );
  const byInstance =
    pick.colorByInstance ?? (data?.is_filament || !!object?.is_filament);
  const markers = useMarkers(data?.points, data?.color, byInstance);
  return (
    <PickMarkers
      id={`picks:${pick.objectName}:${pick.userId}:${pick.sessionId}`}
      markers={markers}
      style={markerStyle}
      radiusAngstrom={object?.radius ?? null}
      pointSizePixels={
        data?.is_filament || object?.is_filament
          ? FILAMENT_POINT_SIZE_PIXELS
          : POINT_SIZE_PIXELS
      }
    />
  );
}

function EditablePicks({
  points,
  selectedIds,
  color,
  byInstance,
  object,
}: {
  points: PickingPoint[];
  selectedIds: Set<string>;
  color: Rgba255;
  byInstance: boolean;
  object: PickableObjectResponse | undefined;
}) {
  const { markerStyle } = useLayout();
  const markers = useMarkers(points, color, byInstance, selectedIds);
  return (
    <PickMarkers
      id="picks:editing"
      markers={markers}
      style={markerStyle}
      radiusAngstrom={object?.radius ?? null}
      pointSizePixels={
        byInstance ? FILAMENT_POINT_SIZE_PIXELS : POINT_SIZE_PIXELS
      }
    />
  );
}

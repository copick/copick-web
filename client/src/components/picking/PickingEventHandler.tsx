import { useCallback, useEffect } from "react";
import { Idetik } from "@/idetik/Idetik";
import { planeAxes } from "@/idetik/orientation";
import { usePicking, type PickingPoint } from "@/contexts/PickingContext";

type WorldPoint = { x: number; y: number; z: number };

interface PickingEventHandlerProps {
  viewer: Idetik | null;
  sliceIndex: number;
  onSliceIndexChange: (newIndex: number) => void;
  maxSliceIndex: number | undefined;
  voxelSpacing: number;
}

export function PickingEventHandler({
  viewer,
  sliceIndex,
  onSliceIndexChange,
  maxSliceIndex,
  voxelSpacing,
}: PickingEventHandlerProps) {
  const {
    state: pickingState,
    addPoint,
    deletePoint,
    selectPoint,
    clearSelection,
    isEditing,
  } = usePicking();

  const findNearestPoint = useCallback(
    (world: WorldPoint, threshold = 50): PickingPoint | null => {
      if (!isEditing || !viewer) return null;

      const { u, v, w } = planeAxes(viewer.orientation);
      const slicePosition = sliceIndex * voxelSpacing;
      let nearest: PickingPoint | null = null;
      let minDist = threshold;

      for (const point of pickingState.localPoints) {
        if (Math.abs(point[w] - slicePosition) > voxelSpacing * 3) continue;
        const dist = Math.hypot(point[u] - world[u], point[v] - world[v]);
        if (dist < minDist) {
          minDist = dist;
          nearest = point;
        }
      }

      return nearest;
    },
    [isEditing, pickingState.localPoints, viewer, sliceIndex, voxelSpacing],
  );

  const handleClick = useCallback(
    (event: MouseEvent) => {
      if (!viewer || !isEditing) return;
      if ((event.target as HTMLElement).tagName !== "CANVAS") return;

      const { w } = planeAxes(viewer.orientation);
      const world = viewer.screenToWorld(event.clientX, event.clientY);
      world[w] = sliceIndex * voxelSpacing;

      switch (pickingState.activeTool) {
        case "add":
          addPoint({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
            x: world.x,
            y: world.y,
            z: world.z,
            score: 1.0,
          });
          break;
        case "select": {
          const nearest = findNearestPoint(world);
          if (nearest) selectPoint(nearest.id, event.shiftKey);
          else if (!event.shiftKey) clearSelection();
          break;
        }
        case "delete": {
          const nearest = findNearestPoint(world);
          if (nearest) deletePoint(nearest.id);
          break;
        }
      }
    },
    [
      viewer,
      isEditing,
      pickingState.activeTool,
      findNearestPoint,
      addPoint,
      selectPoint,
      deletePoint,
      clearSelection,
      sliceIndex,
      voxelSpacing,
    ],
  );

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (!event.shiftKey || maxSliceIndex === undefined) return;
      if ((event.target as HTMLElement).tagName !== "CANVAS") return;

      event.preventDefault();
      const delta = event.deltaY > 0 ? 1 : -1;
      const newIndex = Math.max(0, Math.min(maxSliceIndex, sliceIndex + delta));
      if (newIndex !== sliceIndex) onSliceIndexChange(newIndex);
    },
    [sliceIndex, maxSliceIndex, onSliceIndexChange],
  );

  useEffect(() => {
    const canvas = viewer?.canvas;
    if (!canvas) return;

    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [viewer, handleClick, handleWheel]);

  useEffect(() => {
    const canvas = viewer?.canvas;
    if (!canvas) return;

    if (!isEditing) {
      canvas.style.cursor = "";
      return;
    }

    switch (pickingState.activeTool) {
      case "add":
        canvas.style.cursor = "crosshair";
        break;
      case "select":
        canvas.style.cursor = "pointer";
        break;
      case "delete":
        canvas.style.cursor = "not-allowed";
        break;
      default:
        canvas.style.cursor = "";
    }

    return () => {
      canvas.style.cursor = "";
    };
  }, [viewer, pickingState.activeTool, isEditing]);

  return null;
}

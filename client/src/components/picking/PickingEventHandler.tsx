import { useCallback, useEffect } from "react";
import { Idetik } from "@/idetik/Idetik";
import { usePicking, type PickingPoint } from "@/contexts/PickingContext";

interface PickingEventHandlerProps {
  viewer: Idetik | null;
  currentZIndex: number;
  onZIndexChange: (newIndex: number) => void;
  maxZIndex: number | undefined;
  voxelSpacing: number;
}

export function PickingEventHandler({
  viewer,
  currentZIndex,
  onZIndexChange,
  maxZIndex,
  voxelSpacing,
}: PickingEventHandlerProps) {
  const { state: pickingState, addPoint, deletePoint, selectPoint, clearSelection, isEditing } = usePicking();

  const findNearestPoint = useCallback(
    (worldX: number, worldY: number, threshold = 50): PickingPoint | null => {
      if (!isEditing) return null;

      const currentZ = currentZIndex * voxelSpacing;
      let nearest: PickingPoint | null = null;
      let minDist = threshold;

      for (const point of pickingState.localPoints) {
        if (Math.abs(point.z - currentZ) > voxelSpacing * 3) continue;
        const dist = Math.hypot(point.x - worldX, point.y - worldY);
        if (dist < minDist) {
          minDist = dist;
          nearest = point;
        }
      }

      return nearest;
    },
    [isEditing, pickingState.localPoints, currentZIndex, voxelSpacing]
  );

  const handleClick = useCallback(
    (event: MouseEvent) => {
      if (!viewer || !isEditing) return;
      if ((event.target as HTMLElement).tagName !== "CANVAS") return;

      const world = viewer.screenToWorld(event.clientX, event.clientY);
      const currentZ = currentZIndex * voxelSpacing;

      switch (pickingState.activeTool) {
        case "add":
          addPoint({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
            x: world.x,
            y: world.y,
            z: currentZ,
            score: 1.0,
          });
          break;
        case "select": {
          const nearest = findNearestPoint(world.x, world.y);
          if (nearest) selectPoint(nearest.id, event.shiftKey);
          else if (!event.shiftKey) clearSelection();
          break;
        }
        case "delete": {
          const nearest = findNearestPoint(world.x, world.y);
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
      currentZIndex,
      voxelSpacing,
    ]
  );

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (!event.shiftKey || maxZIndex === undefined) return;
      if ((event.target as HTMLElement).tagName !== "CANVAS") return;

      event.preventDefault();
      const delta = event.deltaY > 0 ? 1 : -1;
      const newIndex = Math.max(0, Math.min(maxZIndex, currentZIndex + delta));
      if (newIndex !== currentZIndex) onZIndexChange(newIndex);
    },
    [currentZIndex, maxZIndex, onZIndexChange]
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

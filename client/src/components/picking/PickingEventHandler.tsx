/**
 * Handles mouse events for picking interactions.
 * Attaches event listeners to the viewer canvas.
 */

import { useEffect, useCallback, useRef } from "react";
import { OrthographicCamera } from "@idetik/core";
import { useIdetik } from "@idetik/react";
import { usePicking, type PickingPoint } from "@/contexts/PickingContext";

interface PickingEventHandlerProps {
  currentZIndex: number;
  onZIndexChange: (newIndex: number) => void;
  maxZIndex: number | undefined;
  voxelSpacing: number;
}

export function PickingEventHandler({
  currentZIndex,
  onZIndexChange,
  maxZIndex,
  voxelSpacing,
}: PickingEventHandlerProps) {
  const { runtime } = useIdetik();
  const { state: pickingState, addPoint, deletePoint, selectPoint, clearSelection, isEditing } = usePicking();

  // Store canvas reference
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Get canvas when runtime is available
  useEffect(() => {
    if (!runtime) return;
    // Access canvas directly from runtime
    canvasRef.current = runtime.canvas;
  }, [runtime]);

  // Convert screen coordinates to world coordinates
  const screenToWorld = useCallback(
    (screenX: number, screenY: number): { x: number; y: number } | null => {
      if (!runtime || !canvasRef.current) return null;

      const viewport = runtime.viewports[0];
      if (!viewport) return null;

      // Get canvas bounds
      const canvas = runtime.canvas;
      const rect = canvas.getBoundingClientRect();
      const canvasX = screenX - rect.left;
      const canvasY = screenY - rect.top;

      // Get camera for coordinate conversion
      const camera = viewport.camera;
      if (!camera || camera.type !== "OrthographicCamera") return null;

      const orthoCamera = camera as OrthographicCamera;

      // Canvas dimensions
      const canvasWidth = canvas.clientWidth;
      const canvasHeight = canvas.clientHeight;

      // Convert from canvas space to normalized device coordinates (-1 to 1)
      // Note: Don't flip Y - image coordinates have Y increasing downward
      const ndcX = (canvasX / canvasWidth) * 2 - 1;
      const ndcY = (canvasY / canvasHeight) * 2 - 1;

      // For idetik's orthographic camera:
      // cameraWidthWorld = transform.scale[0] * viewportSize[0]
      const cameraWidthWorld = orthoCamera.transform.scale[0] * orthoCamera.viewportSize[0];
      const cameraHeightWorld = orthoCamera.transform.scale[1] * orthoCamera.viewportSize[1];

      // Camera center is at transform.translation
      const centerX = orthoCamera.transform.translation[0];
      const centerY = orthoCamera.transform.translation[1];

      // Convert NDC to world coordinates
      const worldX = centerX + ndcX * (cameraWidthWorld / 2);
      const worldY = centerY + ndcY * (cameraHeightWorld / 2);

      return { x: worldX, y: worldY };
    },
    [runtime]
  );

  // Find nearest point to click location
  const findNearestPoint = useCallback(
    (worldX: number, worldY: number, threshold: number = 50): PickingPoint | null => {
      if (!isEditing) return null;

      const currentZ = currentZIndex * voxelSpacing;
      let nearest: PickingPoint | null = null;
      let minDist = threshold;

      for (const point of pickingState.localPoints) {
        // Only consider points near current z-slice (within 3 slices)
        const zDist = Math.abs(point.z - currentZ);
        if (zDist > voxelSpacing * 3) continue;

        const dist = Math.sqrt(Math.pow(point.x - worldX, 2) + Math.pow(point.y - worldY, 2));

        if (dist < minDist) {
          minDist = dist;
          nearest = point;
        }
      }

      return nearest;
    },
    [isEditing, pickingState.localPoints, currentZIndex, voxelSpacing]
  );

  // Handle mouse click
  const handleClick = useCallback(
    (event: MouseEvent) => {
      if (!isEditing) return;

      // Don't intercept if user is interacting with UI elements
      if ((event.target as HTMLElement).tagName !== "CANVAS") return;

      const worldPos = screenToWorld(event.clientX, event.clientY);
      if (!worldPos) return;

      const currentZ = currentZIndex * voxelSpacing;

      switch (pickingState.activeTool) {
        case "add": {
          // Add new point at click location on current z-slice
          const newPoint: PickingPoint = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            x: worldPos.x,
            y: worldPos.y,
            z: currentZ,
            score: 1.0,
          };
          addPoint(newPoint);
          break;
        }

        case "select": {
          const nearest = findNearestPoint(worldPos.x, worldPos.y);
          if (nearest) {
            selectPoint(nearest.id, event.shiftKey);
          } else if (!event.shiftKey) {
            clearSelection();
          }
          break;
        }

        case "delete": {
          const nearest = findNearestPoint(worldPos.x, worldPos.y);
          if (nearest) {
            deletePoint(nearest.id);
          }
          break;
        }
      }
    },
    [
      isEditing,
      pickingState.activeTool,
      screenToWorld,
      findNearestPoint,
      addPoint,
      selectPoint,
      deletePoint,
      clearSelection,
      currentZIndex,
      voxelSpacing,
    ]
  );

  // Handle wheel for z-navigation (Shift + scroll)
  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (!event.shiftKey || maxZIndex === undefined) return;

      // Only intercept on canvas
      if ((event.target as HTMLElement).tagName !== "CANVAS") return;

      event.preventDefault();

      const delta = event.deltaY > 0 ? 1 : -1;
      const newIndex = Math.max(0, Math.min(maxZIndex, currentZIndex + delta));
      if (newIndex !== currentZIndex) {
        onZIndexChange(newIndex);
      }
    },
    [currentZIndex, maxZIndex, onZIndexChange]
  );

  // Attach event listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [handleClick, handleWheel]);

  // Update cursor based on tool
  useEffect(() => {
    const canvas = canvasRef.current;
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
      if (canvas) {
        canvas.style.cursor = "";
      }
    };
  }, [pickingState.activeTool, isEditing]);

  return null;
}

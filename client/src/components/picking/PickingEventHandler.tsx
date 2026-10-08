/**
 * Turns clicks on the ortho panes into picking edits. Each visible ortho pane
 * is listened to separately and converts the click with its own viewport
 * (`runtime.clientToWorld(plane, …)`), putting the point on that pane's slice.
 * There is no picking in 3D. Drags (pan) are not clicks.
 */

import { useEffect, useRef, type MutableRefObject } from "react";
import {
  pointCentre,
  usePicking,
  type PickingPoint,
} from "@/contexts/PickingContext";
import { useScene } from "@/contexts/SceneContext";
import {
  AXES,
  PLANES,
  planeAxes,
  worldToAngstrom,
  type XYZ,
} from "@/idetik/coordinates";

const DRAG_THRESHOLD_PX = 4;
/** Picking tolerance in Å around a click. */
const NEAREST_THRESHOLD_ANGSTROM = 50;

interface PickingEventHandlerProps {
  paneRefs: MutableRefObject<(HTMLDivElement | null)[]>;
}

export function PickingEventHandler({ paneRefs }: PickingEventHandlerProps) {
  const { scene, visible } = useScene();
  const picking = usePicking();
  const pickingRef = useRef(picking);
  pickingRef.current = picking;
  const visibleKey = visible.map(Number).join("");
  const { isEditing } = picking;
  const tool = picking.state.activeTool;

  useEffect(() => {
    if (!scene) return;
    const { runtime, geometry, sliceCoords } = scene;
    const perUnit = geometry.angstromPerUnit;
    const voxelAngstrom =
      Math.min(...geometry.axes.map((a) => a.scale)) * perUnit;
    const disposers: (() => void)[] = [];

    PLANES.forEach((plane, i) => {
      const element = paneRefs.current[i];
      if (!element || !visible[i]) return;
      const [u, v, w] = planeAxes[plane];
      let down: [number, number] | null = null;

      const pointerDown = (event: PointerEvent) => {
        down = event.button === 0 ? [event.clientX, event.clientY] : null;
      };

      const click = (event: MouseEvent) => {
        const {
          state,
          isEditing,
          addPoint,
          selectPoint,
          clearSelection,
          deletePoint,
        } = pickingRef.current;
        if (!isEditing || !down) return;
        if (
          Math.hypot(event.clientX - down[0], event.clientY - down[1]) >
          DRAG_THRESHOLD_PX
        )
          return;

        const world = runtime.clientToWorld(
          plane,
          event.clientX,
          event.clientY,
        );
        world[w] = sliceCoords[AXES[w]] ?? world[w];
        const clicked = worldToAngstrom(world as XYZ, perUnit);

        const nearest = (): PickingPoint | null => {
          let best: PickingPoint | null = null;
          let bestDistance = NEAREST_THRESHOLD_ANGSTROM;
          for (const point of state.localPoints) {
            const c = pointCentre(point);
            if (Math.abs(c[w] - clicked[w]) > voxelAngstrom * 3) continue;
            const d = Math.hypot(c[u] - clicked[u], c[v] - clicked[v]);
            if (d < bestDistance) {
              bestDistance = d;
              best = point;
            }
          }
          return best;
        };

        switch (state.activeTool) {
          case "add":
            addPoint({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
              x: clicked[0],
              y: clicked[1],
              z: clicked[2],
              score: 1.0,
              instance_id: state.editingPicks?.isFilament
                ? state.activeInstanceId
                : 0,
              transformation: null,
            });
            break;
          case "select": {
            const hit = nearest();
            if (hit) selectPoint(hit.id, event.shiftKey);
            else if (!event.shiftKey) clearSelection();
            break;
          }
          case "delete": {
            const hit = nearest();
            if (hit) deletePoint(hit.id);
            break;
          }
        }
      };

      element.addEventListener("pointerdown", pointerDown);
      element.addEventListener("click", click);
      disposers.push(() => {
        element.removeEventListener("pointerdown", pointerDown);
        element.removeEventListener("click", click);
      });
    });

    return () => disposers.forEach((dispose) => dispose());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, visibleKey]);

  // Cursor feedback per ortho pane.
  useEffect(() => {
    const cursor = !isEditing
      ? ""
      : tool === "add"
        ? "crosshair"
        : tool === "select"
          ? "pointer"
          : tool === "delete"
            ? "not-allowed"
            : "";
    const panes = paneRefs.current.slice(0, 3);
    for (const pane of panes) if (pane) pane.style.cursor = cursor;
    return () => {
      for (const pane of panes) if (pane) pane.style.cursor = "";
    };
  }, [isEditing, tool, paneRefs, visibleKey]);

  return null;
}

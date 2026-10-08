/**
 * Keyboard and mouse navigation of the ortho panes:
 *
 * - Shift+wheel steps the pane's slice (plain wheel zooms, as before);
 * - ArrowUp/Down step one slice, PageUp/Down ten;
 * - double-click moves the crosshair there, snapping to a nearby pick.
 *
 * Adapted from apex-agent (see idetik/NOTICE.md), keeping copick-web's
 * Shift+wheel slicing convention.
 */

import { useEffect, useRef, type MutableRefObject } from "react";
import {
  PLANES,
  planeAxes,
  worldToIndices,
  type XYZ,
} from "@/idetik/coordinates";
import type { Scene } from "@/contexts/SceneContext";

interface Options {
  scene: Scene | null;
  paneRefs: MutableRefObject<(HTMLDivElement | null)[]>;
  visible: boolean[];
  step: (axis: number, delta: number) => void;
  setIndices: (indices: XYZ) => void;
  /** Whether a double-click may move the crosshair (not while placing or deleting picks). */
  allowFocusRef: MutableRefObject<boolean>;
}

export function usePaneInteractions({
  scene,
  paneRefs,
  visible,
  step,
  setIndices,
  allowFocusRef,
}: Options) {
  const stepRef = useRef(step);
  stepRef.current = step;
  const setIndicesRef = useRef(setIndices);
  setIndicesRef.current = setIndices;
  const visibleKey = visible.map(Number).join("");

  useEffect(() => {
    if (!scene) return;
    const { runtime, geometry } = scene;
    const disposers: (() => void)[] = [];

    PLANES.forEach((plane, i) => {
      const element = paneRefs.current[i];
      if (!element) return;
      const [u, v, w] = planeAxes[plane];

      const wheel = (event: WheelEvent) => {
        if (!event.shiftKey || event.ctrlKey || event.metaKey) return;
        // Shift turns vertical wheels into horizontal ones on some platforms.
        const delta = event.deltaY || event.deltaX;
        if (!delta) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        stepRef.current(w, Math.sign(delta));
      };

      const key = (event: KeyboardEvent) => {
        if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key))
          return;
        event.preventDefault();
        const delta =
          (event.key.includes("Up") ? 1 : -1) *
          (event.key.startsWith("Page") ? 10 : 1);
        stepRef.current(w, delta);
      };

      const focus = (event: MouseEvent) => {
        if (!allowFocusRef.current) return;
        const world = runtime.clientToWorld(
          plane,
          event.clientX,
          event.clientY,
        );
        const current = scene.sliceCoords;
        const target: XYZ = [current.x ?? 0, current.y ?? 0, current.z ?? 0];
        target[u] = world[u];
        target[v] = world[v];
        // Snap to the nearest registered point near this slice.
        let best: XYZ | null = null;
        let bestDistance = Infinity;
        for (const { points, radius } of scene.snapTargets.values()) {
          for (const p of points) {
            if (Math.abs(p[w] - target[w]) > radius) continue;
            const d = Math.hypot(p[u] - target[u], p[v] - target[v]);
            if (d < radius && d < bestDistance) {
              best = p;
              bestDistance = d;
            }
          }
        }
        setIndicesRef.current(worldToIndices(best ?? target, geometry.axes));
      };

      element.addEventListener("wheel", wheel, {
        passive: false,
        capture: true,
      });
      element.addEventListener("keydown", key);
      element.addEventListener("dblclick", focus);
      disposers.push(() => {
        element.removeEventListener("wheel", wheel, true);
        element.removeEventListener("keydown", key);
        element.removeEventListener("dblclick", focus);
      });
    });
    return () => disposers.forEach((dispose) => dispose());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, visibleKey]);
}

/**
 * Mouse and keyboard for filament editing on the ortho panes (as the desktop
 * viewers' trace / cut modes):
 *
 * - Trace: click the slice to add a control point to the active filament;
 *   drag a handle to move it; shift-click a handle to remove it.
 * - Cut: click a filament to split it in two there.
 * - Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z or Ctrl+Y redo.
 *
 * Handle drags are claimed in the capture phase, so the pane's pan control
 * never sees them; other drags still pan.
 */

import { useEffect, useRef, type MutableRefObject } from "react";
import { useFilamentEditing } from "@/contexts/FilamentEditingContext";
import { useScene } from "@/contexts/SceneContext";
import {
  AXES,
  PLANES,
  planeAxes,
  worldToAngstrom,
  type XYZ,
} from "@/idetik/coordinates";
import {
  controls,
  cut,
  insertPoint,
  removePoint,
} from "@/filaments/editSession";

const DRAG_THRESHOLD_PX = 4;
/** Handles within this many pixels of the pointer are hit. */
const HIT_PIXELS = 9;

interface Props {
  paneRefs: MutableRefObject<(HTMLDivElement | null)[]>;
}

export function FilamentEditEventHandler({ paneRefs }: Props) {
  const { scene, visible } = useScene();
  const editing = useFilamentEditing();
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const visibleKey = visible.map(Number).join("");
  const { isEditing, tool } = editing;

  useEffect(() => {
    if (!scene || !isEditing) return;
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
      let dragging = false;

      /** The pointer on this pane's slice (Å), and how many Å a pixel is. */
      const locate = (event: MouseEvent): { at: XYZ; perPixel: number } => {
        const a = runtime.clientToWorld(plane, event.clientX, event.clientY);
        const b = runtime.clientToWorld(
          plane,
          event.clientX + 1,
          event.clientY,
        );
        a[w] = sliceCoords[AXES[w]] ?? a[w];
        const perPixel = Math.hypot(b[u] - a[u], b[v] - a[v]) * perUnit;
        return { at: worldToAngstrom(a as XYZ, perUnit), perPixel };
      };

      const hitHandle = (at: XYZ, perPixel: number, slab: number) => {
        const { edit } = editingRef.current;
        let best: { id: number; index: number; p: XYZ } | null = null;
        let bestDistance = HIT_PIXELS * perPixel;
        const ids = new Set([...edit.filaments.keys(), ...edit.pending.keys()]);
        for (const id of ids) {
          controls(edit, id).forEach((p, index) => {
            if (Math.abs(p[w] - at[w]) > slab) return;
            const d = Math.hypot(p[u] - at[u], p[v] - at[v]);
            // Prefer the active filament's handles when handles overlap.
            const bias = id === edit.activeId ? 0.999 : 1;
            if (d * bias <= bestDistance) {
              best = { id, index, p };
              bestDistance = d * bias;
            }
          });
        }
        return best as { id: number; index: number; p: XYZ } | null;
      };

      const slabAngstrom = () => {
        const radius = editingRef.current.ctx.radius ?? 0;
        return Math.max(voxelAngstrom * 3, radius);
      };

      const pointerDown = (event: PointerEvent) => {
        down = event.button === 0 ? [event.clientX, event.clientY] : null;
        const ed = editingRef.current;
        if (!down || ed.tool !== "trace" || event.altKey) return;
        const { at, perPixel } = locate(event);
        const hit = hitHandle(at, perPixel, slabAngstrom());
        if (!hit) return; // not on a handle: pans as usual, a click adds a point
        event.preventDefault();
        event.stopImmediatePropagation();
        down = null;
        if (event.shiftKey) {
          ed.apply("Delete filament point", (s, ctx) =>
            removePoint(s, ctx, hit.id, hit.index),
          );
          return;
        }
        ed.setActive(hit.id);
        ed.beginDrag(hit.id, hit.index);
        dragging = true;
        element.setPointerCapture(event.pointerId);
        const depth = hit.p[w];
        const move = (e: PointerEvent) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          const { at: p } = locate(e);
          p[w] = depth; // keep the handle's own depth
          editingRef.current.dragTo(p);
        };
        const up = (e: PointerEvent) => {
          e.stopImmediatePropagation();
          dragging = false;
          element.releasePointerCapture(e.pointerId);
          element.removeEventListener("pointermove", move, true);
          element.removeEventListener("pointerup", up, true);
          editingRef.current.endDrag();
        };
        element.addEventListener("pointermove", move, true);
        element.addEventListener("pointerup", up, true);
      };

      const click = (event: MouseEvent) => {
        const ed = editingRef.current;
        if (!down || dragging || event.detail > 1) return;
        if (
          Math.hypot(event.clientX - down[0], event.clientY - down[1]) >
          DRAG_THRESHOLD_PX
        )
          return;
        const { at, perPixel } = locate(event);
        if (ed.tool === "trace") {
          ed.apply(
            "Add filament point",
            (s, ctx) => insertPoint(s, ctx, at, ed.insertMode).state,
          );
        } else if (ed.tool === "cut") {
          const tolerance = Math.max(HIT_PIXELS * perPixel, 2 * ed.ctx.step);
          ed.apply(
            "Cut filament",
            (s, ctx) => cut(s, ctx, at, tolerance).state,
          );
        }
      };

      element.addEventListener("pointerdown", pointerDown, true);
      element.addEventListener("click", click);
      disposers.push(() => {
        element.removeEventListener("pointerdown", pointerDown, true);
        element.removeEventListener("click", click);
      });
    });
    return () => disposers.forEach((dispose) => dispose());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, visibleKey, isEditing]);

  // Undo / redo keys while editing (not while typing in a field).
  useEffect(() => {
    if (!isEditing) return;
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      )
        return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const k = event.key.toLowerCase();
      if (k === "z" && !event.shiftKey) {
        event.preventDefault();
        editingRef.current.undo();
      } else if (
        (k === "z" && event.shiftKey) ||
        (k === "y" && event.ctrlKey)
      ) {
        event.preventDefault();
        editingRef.current.redo();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [isEditing]);

  // Cursor feedback per ortho pane.
  useEffect(() => {
    const cursor = !isEditing || tool === "view" ? "" : "crosshair";
    const panes = paneRefs.current.slice(0, 3);
    for (const pane of panes) if (pane) pane.style.cursor = cursor;
    return () => {
      for (const pane of panes) if (pane) pane.style.cursor = "";
    };
  }, [isEditing, tool, paneRefs, visibleKey]);

  return null;
}

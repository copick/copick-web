/**
 * Slice brush, undo and proposal acceptance for one painting, whichever route owns it (`Painter`).
 *
 * Paint/Erase on any visible ortho pane draws discs of `radius` voxels in that plane, interpolated along the drag;
 * each stroke is saved against the last known revision (a conflict reloads it). Ctrl/Cmd+Z undoes one saved gesture.
 * In the point modes a click is handed to `onPoint` (e.g. an nnInteractive include/exclude click) instead of painting.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  chunkStroke,
  strokeSegment,
  type Accepted,
  type Box3,
  type Painter,
  type PaintingState,
  type ProposalRecord,
  type Saved,
  type Stroke,
  unionBox,
} from "@/api/annotations";
import { useScene } from "@/contexts/SceneContext";
import {
  AXES,
  PLANES,
  planeAxes,
  worldToIndices,
  type XYZ,
} from "@/idetik/coordinates";
import { useLatestRef } from "@/utils/useLatestRef";

export type Mode = "off" | "paint" | "erase" | "include" | "exclude";

export interface Message {
  severity: "error" | "info";
  text: string;
}

interface Options {
  painter: Painter;
  paneRefs: MutableRefObject<(HTMLDivElement | null)[]>;
  /** Latest server state of the painting (adopted while no save is in flight). */
  state: PaintingState | undefined;
  /** Re-read the painting after a refused save. */
  reload: () => Promise<unknown>;
  /** Show the saved labels: what `saved` changed, or (without it, after a refusal) everything. */
  refresh: (saved?: Saved) => Promise<void>;
  enabled: boolean;
  /** Another operation (e.g. training) blocks edits. */
  blocked?: boolean;
  onPoint?: (voxel: [number, number, number], include: boolean) => void;
}

export function usePainting({
  painter,
  paneRefs,
  state,
  reload,
  refresh,
  enabled,
  blocked = false,
  onPoint,
}: Options) {
  const { scene, visible } = useScene();
  const [mode, setMode] = useState<Mode>("off");
  const [label, setLabel] = useState<number | null>(null);
  const [radius, setRadius] = useState(2);
  const [message, setMessage] = useState<Message | null>(null);
  const [saving, setSaving] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [revision, setRevision] = useState<string | null>(null);
  const [lastStroke, setLastStroke] = useState<Stroke | null>(null);
  const editing = useRef(false);
  const drawing = useRef(false);
  const revisionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!state || editing.current) return;
    revisionRef.current = state.revision;
    setRevision(state.revision);
    setCanUndo(state.can_undo);
  }, [state]);

  /** Run one revision-checked change; a refusal re-reads the painting. */
  const change = useCallback(
    async <R extends Saved>(
      run: (base: string | null) => Promise<R>,
    ): Promise<R | null> => {
      if (editing.current) return null;
      editing.current = true;
      setSaving(true);
      setMessage(null);
      try {
        const saved = await run(revisionRef.current);
        revisionRef.current = saved.revision;
        setRevision(saved.revision);
        setCanUndo(saved.can_undo);
        await refresh(saved);
        return saved;
      } catch (e) {
        const error = e as Error & { code?: string };
        setMessage({
          severity: "error",
          text:
            error.code === "revision_conflict"
              ? `${error.message} The painting was reloaded; repeat the last edit.`
              : error.message,
        });
        editing.current = false;
        await reload();
        await refresh();
        return null;
      } finally {
        editing.current = false;
        setSaving(false);
      }
    },
    [refresh, reload],
  );

  const saveStroke = useCallback(
    (stroke: Stroke) =>
      change(async (base) => {
        const strokeId = crypto.randomUUID();
        let saved: Saved = {
          revision: base,
          changed_voxels: 0,
          can_undo: canUndo,
        };
        for (const chunk of chunkStroke(stroke)) {
          const part = await painter.paint(saved.revision, [chunk], strokeId);
          revisionRef.current = part.revision;
          saved = {
            ...part,
            changed_voxels: saved.changed_voxels + part.changed_voxels,
            changed_region: unionBox(saved.changed_region, part.changed_region),
          };
        }
        if (stroke.label !== 0) setLastStroke(stroke);
        return saved;
      }),
    [change, painter, canUndo],
  );

  const undo = useCallback(async () => {
    if (drawing.current || !canUndo || blocked) return;
    await change((base) => painter.undo(base));
  }, [blocked, canUndo, change, painter]);

  const accept = useCallback(
    (
      proposal: ProposalRecord,
      proposalLabel: number,
      into: number,
      box?: Box3 | null,
    ): Promise<Accepted | null> =>
      change((base) =>
        painter.accept(base, proposal, proposalLabel, into, box),
      ),
    [change, painter],
  );

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable=true]"))
        return;
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "z"
      ) {
        event.preventDefault();
        void undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, enabled]);

  const strokeRef = useLatestRef({
    mode,
    label,
    radius,
    enabled,
    busy: saving || blocked,
    saveStroke,
    onPoint,
  });
  const visibleKey = visible.map(Number).join("");

  // Capture-phase listeners keep painting drags from also panning the pane.
  useEffect(() => {
    if (!scene) return;
    const { runtime, geometry, sliceCoords } = scene;
    const disposers: (() => void)[] = [];
    PLANES.forEach((plane, i) => {
      const element = paneRefs.current[i];
      if (!element || !visible[i]) return;
      const w = planeAxes[plane][2];
      let stroke: Stroke | null = null;
      const voxel = (event: PointerEvent): [number, number, number] => {
        const world = runtime.clientToWorld(
          plane,
          event.clientX,
          event.clientY,
        ) as XYZ;
        world[w] = sliceCoords[AXES[w]] ?? world[w];
        return worldToIndices(world, geometry.axes);
      };
      const down = (event: PointerEvent) => {
        const s = strokeRef.current;
        if (
          s.mode === "off" ||
          !s.enabled ||
          s.busy ||
          editing.current ||
          event.button !== 0
        )
          return;
        event.stopPropagation();
        event.preventDefault();
        if (s.mode === "include" || s.mode === "exclude") {
          s.onPoint?.(voxel(event), s.mode === "include");
          return;
        }
        if (s.mode === "paint" && s.label == null) return;
        element.setPointerCapture(event.pointerId);
        drawing.current = true;
        stroke = {
          label: s.mode === "erase" ? 0 : s.label!,
          radius: s.radius,
          plane,
          points: [voxel(event)],
        };
      };
      const move = (event: PointerEvent) => {
        if (!stroke) return;
        event.stopPropagation();
        const last = stroke.points[stroke.points.length - 1];
        stroke.points.push(...strokeSegment(last, voxel(event)).slice(1));
      };
      const up = (event: PointerEvent) => {
        if (!stroke) return;
        event.stopPropagation();
        drawing.current = false;
        const done = stroke;
        stroke = null;
        void strokeRef.current.saveStroke(done);
      };
      const cancel = () => {
        stroke = null;
        drawing.current = false;
      };
      element.addEventListener("pointercancel", cancel, true);
      element.addEventListener("pointerdown", down, true);
      element.addEventListener("pointermove", move, true);
      element.addEventListener("pointerup", up, true);
      disposers.push(() => {
        cancel();
        element.removeEventListener("pointercancel", cancel, true);
        element.removeEventListener("pointerdown", down, true);
        element.removeEventListener("pointermove", move, true);
        element.removeEventListener("pointerup", up, true);
      });
    });
    return () => disposers.forEach((d) => d());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, visibleKey]);

  useEffect(() => {
    const panes = paneRefs.current.slice(0, 3);
    const cursor = mode === "off" || !enabled ? "" : "crosshair";
    for (const pane of panes) if (pane) pane.style.cursor = cursor;
    return () => {
      for (const pane of panes) if (pane) pane.style.cursor = "";
    };
  }, [mode, enabled, paneRefs, visibleKey]);

  return {
    mode,
    setMode,
    label,
    setLabel,
    radius,
    setRadius,
    message,
    setMessage,
    saving,
    canUndo,
    revision,
    lastStroke,
    undo,
    accept,
  };
}

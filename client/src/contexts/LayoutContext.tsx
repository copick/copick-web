/**
 * Viewer layout: single-plane or multi-pane, the single-plane axis, which
 * panes the multi layout shows, and the pick marker style. Persisted in
 * localStorage. Kept apart from the scene and slice contexts so that changing
 * the slice does not re-render layout consumers and vice versa.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  isPaneVisibility,
  readStored,
  readVisiblePanels,
  saveVisiblePanels,
  writeStored,
} from "@/idetik/lifecycle";
import type { MarkerStyle } from "@/idetik/PickMarkersLayer";

export type LayoutMode = "single" | "multi";
export type ViewAxis = "xy" | "xz" | "yz";

const AXIS_PANE: Record<ViewAxis, number> = { xy: 0, xz: 1, yz: 2 };
// Versioned with the pane default (XY + 3D, multi layout), see lifecycle.ts.
const LAYOUT_KEY = "copick-web.viewer.layout.v2";

interface StoredLayout {
  mode: LayoutMode;
  axis: ViewAxis;
  markerStyle: MarkerStyle;
}

function isStoredLayout(value: unknown): value is StoredLayout {
  const v = value as StoredLayout | null;
  return (
    !!v &&
    (v.mode === "single" || v.mode === "multi") &&
    (v.axis === "xy" || v.axis === "xz" || v.axis === "yz") &&
    (v.markerStyle === "dots" || v.markerStyle === "shells")
  );
}

/** Panes shown for a layout: single = the multi layout with one ortho pane. */
// eslint-disable-next-line react-refresh/only-export-components
export function effectiveVisibility(
  mode: LayoutMode,
  axis: ViewAxis,
  multiVisible: boolean[],
): boolean[] {
  if (mode === "single") return [0, 1, 2, 3].map((i) => i === AXIS_PANE[axis]);
  return isPaneVisibility(multiVisible)
    ? multiVisible
    : [true, true, true, true];
}

interface LayoutContextType {
  mode: LayoutMode;
  axis: ViewAxis;
  markerStyle: MarkerStyle;
  /** Panes the multi layout shows (XY, XZ, YZ, 3D). */
  multiVisible: boolean[];
  /** Panes currently shown. */
  visible: boolean[];
  setMode: (mode: LayoutMode) => void;
  setAxis: (axis: ViewAxis) => void;
  setMarkerStyle: (style: MarkerStyle) => void;
  togglePane: (index: number) => void;
}

const LayoutContext = createContext<LayoutContextType | null>(null);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredLayout>(() =>
    readStored(LAYOUT_KEY, isStoredLayout, {
      mode: "multi",
      axis: "xy",
      markerStyle: "dots",
    }),
  );
  const [multiVisible, setMultiVisible] = useState(readVisiblePanels);

  useEffect(() => writeStored(LAYOUT_KEY, stored), [stored]);
  useEffect(() => saveVisiblePanels(multiVisible), [multiVisible]);

  const setMode = useCallback(
    (mode: LayoutMode) => setStored((s) => ({ ...s, mode })),
    [],
  );
  const setAxis = useCallback(
    (axis: ViewAxis) => setStored((s) => ({ ...s, axis })),
    [],
  );
  const setMarkerStyle = useCallback(
    (markerStyle: MarkerStyle) => setStored((s) => ({ ...s, markerStyle })),
    [],
  );
  const togglePane = useCallback((index: number) => {
    setMultiVisible((old) => {
      const next = old.map((v, i) => (i === index ? !v : v));
      return next.some(Boolean) ? next : old;
    });
  }, []);

  const visible = useMemo(
    () => effectiveVisibility(stored.mode, stored.axis, multiVisible),
    [stored.mode, stored.axis, multiVisible],
  );

  const value = useMemo(
    () => ({
      ...stored,
      multiVisible,
      visible,
      setMode,
      setAxis,
      setMarkerStyle,
      togglePane,
    }),
    [
      stored,
      multiVisible,
      visible,
      setMode,
      setAxis,
      setMarkerStyle,
      togglePane,
    ],
  );

  return (
    <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLayout(): LayoutContextType {
  const context = useContext(LayoutContext);
  if (!context)
    throw new Error("useLayout must be used within a LayoutProvider");
  return context;
}

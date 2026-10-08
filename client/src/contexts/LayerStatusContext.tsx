/**
 * Load problems of overlay layers (e.g. a uint64 segmentation idetik cannot
 * draw), reported by the viewer and shown next to the entity in the sidebar.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface LayerStatus {
  kind: "unsupported-dtype" | "error";
  message: string;
}

interface LayerStatusContextType {
  statuses: Record<string, LayerStatus>;
  setStatus: (key: string, status: LayerStatus | null) => void;
}

const LayerStatusContext = createContext<LayerStatusContextType>({
  statuses: {},
  setStatus: () => undefined,
});

export function LayerStatusProvider({ children }: { children: ReactNode }) {
  const [statuses, setStatuses] = useState<Record<string, LayerStatus>>({});
  const setStatus = useCallback((key: string, status: LayerStatus | null) => {
    setStatuses((old) => {
      if (status === null) {
        if (!(key in old)) return old;
        const next = { ...old };
        delete next[key];
        return next;
      }
      const prev = old[key];
      if (prev && prev.kind === status.kind && prev.message === status.message)
        return old;
      return { ...old, [key]: status };
    });
  }, []);
  const value = useMemo(() => ({ statuses, setStatus }), [statuses, setStatus]);
  return (
    <LayerStatusContext.Provider value={value}>
      {children}
    </LayerStatusContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLayerStatus(): LayerStatusContextType {
  return useContext(LayerStatusContext);
}

/** Classify an error thrown while opening a store. */
// eslint-disable-next-line react-refresh/only-export-components
export function layerStatusFromError(error: unknown): LayerStatus {
  const message = String(error);
  if (/Unsupported (zarr )?dtype|int64|uint64/i.test(message)) {
    return { kind: "unsupported-dtype", message };
  }
  return { kind: "error", message };
}

/**
 * Viewer state context for managing slice position and axis.
 */

import { createContext, useContext, useState, type ReactNode } from "react";

export type ViewAxis = "xy" | "xz" | "yz";

interface ViewerState {
  axis: ViewAxis;
  sliceIndex: number;
  maxSliceIndex: number | undefined;
}

interface ViewerContextType {
  state: ViewerState;
  setAxis: (axis: ViewAxis) => void;
  setSliceIndex: (index: number) => void;
  setMaxSliceIndex: (max: number | undefined) => void;
}

const ViewerContext = createContext<ViewerContextType | null>(null);

export function ViewerProvider({ children }: { children: ReactNode }) {
  const [axis, setAxis] = useState<ViewAxis>("xy");
  const [sliceIndex, setSliceIndex] = useState(0);
  const [maxSliceIndex, setMaxSliceIndex] = useState<number | undefined>(undefined);

  const state: ViewerState = {
    axis,
    sliceIndex,
    maxSliceIndex,
  };

  return (
    <ViewerContext.Provider value={{ state, setAxis, setSliceIndex, setMaxSliceIndex }}>
      {children}
    </ViewerContext.Provider>
  );
}

export function useViewer(): ViewerContextType {
  const context = useContext(ViewerContext);
  if (!context) {
    throw new Error("useViewer must be used within a ViewerProvider");
  }
  return context;
}

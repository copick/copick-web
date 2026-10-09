import { useMemo, useRef, type ReactNode } from "react";
import {
  ViewerBridgeContext,
  type ViewerBridge,
  type SliceContextType,
} from "./SliceContext";

export function ViewerBridgeProvider({ children }: { children: ReactNode }) {
  const focusRef = useRef<SliceContextType["focusAngstrom"] | null>(null);
  const bridge = useMemo<ViewerBridge>(
    () => ({
      focusAngstrom: (xyz, options) => focusRef.current?.(xyz, options),
      register: (focus) => {
        focusRef.current = focus;
      },
    }),
    [],
  );
  return (
    <ViewerBridgeContext.Provider value={bridge}>
      {children}
    </ViewerBridgeContext.Provider>
  );
}

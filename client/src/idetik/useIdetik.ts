import { useCallback, useRef, useState } from "react";
import { Idetik } from "./Idetik";

export function useIdetik() {
  const viewerRef = useRef<Idetik | null>(null);
  const [viewer, setViewer] = useState<Idetik | null>(null);

  const canvasRefCallback = useCallback((canvas: HTMLCanvasElement | null) => {
    const current = viewerRef.current;

    if (canvas === null) {
      if (current !== null) {
        current.dispose();
        viewerRef.current = null;
        setViewer(null);
      }
      return;
    }

    if (current !== null) {
      if (current.canvas !== canvas) {
        throw new Error("Only one viewer canvas can be mounted at a time.");
      }
      return;
    }

    const created = new Idetik(canvas);
    viewerRef.current = created;
    setViewer(created);
  }, []);

  return { viewer, canvasRefCallback };
}

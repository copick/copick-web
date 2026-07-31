import { useCallback, useEffect, useRef, useState } from "react";
import type { SliceOrientation } from "@idetik/core";
import { Idetik } from "./Idetik";

export function useIdetik(orientation: SliceOrientation = "XY") {
  const viewerRef = useRef<Idetik | null>(null);
  const [viewer, setViewer] = useState<Idetik | null>(null);
  const orientationRef = useRef(orientation);
  orientationRef.current = orientation;

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

    const created = new Idetik(canvas, orientationRef.current);
    viewerRef.current = created;
    setViewer(created);
  }, []);

  useEffect(() => {
    viewerRef.current?.setOrientation(orientation);
  }, [orientation]);

  return { viewer, canvasRefCallback };
}

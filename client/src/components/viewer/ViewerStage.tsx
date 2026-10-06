/**
 * The viewer stage: one canvas behind a grid of panes (XY, XZ, YZ, 3D).
 * Hidden panes collapse out of the grid; three visible panes put the last one
 * across both columns.
 */

import { Box } from "@mui/material";
import type { MutableRefObject, ReactNode } from "react";
import { VIEW_IDS } from "@/idetik/coordinates";
import { ViewerPane } from "./ViewerPane";
import type { PaneDecor } from "./useTomogramScene";

interface ViewerStageProps {
  canvasRef: MutableRefObject<HTMLCanvasElement | null>;
  paneRefs: MutableRefObject<(HTMLDivElement | null)[]>;
  decorRef: MutableRefObject<PaneDecor>;
  visible: boolean[];
  /** A new canvas per reset: a lost WebGL context cannot be reused. */
  resetKey: number;
  children?: ReactNode;
}

export function ViewerStage({
  canvasRef,
  paneRefs,
  decorRef,
  visible,
  resetKey,
  children,
}: ViewerStageProps) {
  const count = visible.filter(Boolean).length;
  const last = visible.lastIndexOf(true);
  return (
    <Box sx={{ position: "absolute", inset: 0, bgcolor: "#05070b" }}>
      <Box
        component="canvas"
        key={resetKey}
        ref={canvasRef}
        aria-label="Linked tomogram slice and 3D views"
        sx={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gap: "1px",
          gridTemplateColumns: count === 1 ? "1fr" : "1fr 1fr",
          gridTemplateRows: count <= 2 ? "1fr" : "1fr 1fr",
        }}
      >
        {VIEW_IDS.map((view, i) => (
          <ViewerPane
            key={view}
            view={view}
            index={i}
            hidden={!visible[i]}
            spanTwoColumns={count === 3 && i === last}
            paneRef={(el) => {
              paneRefs.current[i] = el;
            }}
            crosshairRef={(el) => {
              decorRef.current.crosshairs[i] = el;
            }}
            scaleLineRef={(el) => {
              decorRef.current.scaleLines[i] = el;
            }}
            scaleLabelRef={(el) => {
              decorRef.current.scaleLabels[i] = el;
            }}
            loadingRef={(el) => {
              decorRef.current.loading[i] = el;
            }}
          />
        ))}
      </Box>
      {children}
    </Box>
  );
}

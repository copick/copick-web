/**
 * One pane of the linked viewer: a DOM element idetik binds a viewport to,
 * with its title, crosshair and scale bar (positioned every frame by the
 * scene overlay, see useTomogramScene).
 */

import { Box } from "@mui/material";
import type { ViewId } from "@/idetik/coordinates";

interface ViewerPaneProps {
  view: ViewId;
  index: number;
  hidden: boolean;
  spanTwoColumns: boolean;
  paneRef: (el: HTMLDivElement | null) => void;
  crosshairRef?: (el: HTMLDivElement | null) => void;
  scaleLineRef?: (el: HTMLDivElement | null) => void;
  scaleLabelRef?: (el: HTMLDivElement | null) => void;
  /** "Loading…" tag, shown by the scene while the pane's slice is incomplete. */
  loadingRef?: (el: HTMLElement | null) => void;
}

const CROSSHAIR = "#67e8f9";

export function ViewerPane({
  view,
  hidden,
  spanTwoColumns,
  paneRef,
  crosshairRef,
  scaleLineRef,
  scaleLabelRef,
  loadingRef,
}: ViewerPaneProps) {
  const is3d = view === "3D";
  return (
    <Box
      ref={paneRef}
      tabIndex={0}
      aria-label={`${view} view`}
      data-view={view}
      hidden={hidden}
      sx={{
        position: "relative",
        overflow: "hidden",
        touchAction: "none",
        border: 1,
        borderColor: "rgba(255,255,255,0.15)",
        outlineOffset: -3,
        gridColumn: spanTwoColumns ? "span 2" : undefined,
        "&:focus-visible": {
          outline: "2px solid",
          outlineColor: "primary.main",
        },
        // idetik skips viewports whose element is visibility:hidden (silently, unlike off-canvas ones).
        "&[hidden]": { display: "none", visibility: "hidden" },
      }}
    >
      <Box
        component="span"
        sx={{
          position: "absolute",
          left: 8,
          top: 8,
          px: 0.75,
          py: 0.25,
          borderRadius: 0.5,
          bgcolor: "rgba(0,0,0,0.55)",
          color: "common.white",
          fontSize: 12,
          fontWeight: 700,
          pointerEvents: "none",
          userSelect: "none",
          zIndex: 2,
        }}
      >
        {view}
        {!is3d && (
          <Box
            component="span"
            ref={loadingRef}
            data-testid={`loading-${view}`}
            style={{ display: "none" }}
            sx={{ ml: 1, fontWeight: 400, opacity: 0.8 }}
          >
            loading…
          </Box>
        )}
      </Box>
      {!is3d && (
        <>
          <Box
            ref={crosshairRef}
            data-testid={`crosshair-${view}`}
            sx={{
              position: "absolute",
              width: 0,
              height: 0,
              pointerEvents: "none",
              opacity: 0.75,
              "&::before, &::after": {
                content: '""',
                position: "absolute",
                bgcolor: CROSSHAIR,
              },
              "&::before": { width: 23, height: "1px", left: -11 },
              "&::after": { height: 23, width: "1px", top: -11 },
            }}
          />
          <Box
            sx={{
              position: "absolute",
              left: 12,
              bottom: 10,
              pointerEvents: "none",
              userSelect: "none",
              color: "common.white",
              textShadow: "0 1px 3px #000",
              fontSize: 11,
              fontFamily: "monospace",
            }}
          >
            <Box ref={scaleLabelRef} />
            <Box
              ref={scaleLineRef}
              sx={{
                height: 3,
                bgcolor: "common.white",
                border: "1px solid black",
                width: 0,
              }}
            />
          </Box>
        </>
      )}
      {is3d && (
        <Box
          component="span"
          sx={{
            position: "absolute",
            left: 9,
            bottom: 7,
            fontSize: 10,
            color: "#aebad0",
            pointerEvents: "none",
          }}
        >
          Drag to rotate · scroll to zoom
        </Box>
      )}
    </Box>
  );
}

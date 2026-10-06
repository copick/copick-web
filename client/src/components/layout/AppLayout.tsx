/**
 * Main application layout with a resizable sidebar and the main content area.
 */

import { useCallback, useEffect, useState, type PointerEvent } from "react";
import { Box } from "@mui/material";
import { Sidebar } from "./Sidebar";
import { MainContent } from "./MainContent";
import { readStored, writeStored } from "@/idetik/lifecycle";

const SIDEBAR_KEY = "copick-web.sidebar.width";
const DEFAULT_SIDEBAR_WIDTH = 340;
const MIN_SIDEBAR_WIDTH = 260;

function maxSidebarWidth(): number {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(760, window.innerWidth * 0.6));
}

function clampWidth(width: number): number {
  return Math.round(
    Math.min(maxSidebarWidth(), Math.max(MIN_SIDEBAR_WIDTH, width)),
  );
}

const isWidth = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function AppLayout() {
  const [width, setWidth] = useState(() =>
    clampWidth(readStored(SIDEBAR_KEY, isWidth, DEFAULT_SIDEBAR_WIDTH)),
  );
  const [dragging, setDragging] = useState(false);

  useEffect(() => writeStored(SIDEBAR_KEY, width), [width]);
  useEffect(() => {
    const onResize = () => setWidth((w) => clampWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }, []);
  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (dragging) setWidth(clampWidth(e.clientX));
    },
    [dragging],
  );
  const onPointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  }, []);

  return (
    <Box
      sx={{
        display: "flex",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        userSelect: dragging ? "none" : undefined,
      }}
    >
      <Box
        component="aside"
        sx={{
          width,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <Sidebar />
      </Box>
      <Box
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize · double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => setWidth(clampWidth(DEFAULT_SIDEBAR_WIDTH))}
        sx={{
          width: 5,
          flexShrink: 0,
          cursor: "col-resize",
          borderLeft: 1,
          borderColor: "divider",
          bgcolor: dragging ? "primary.main" : "transparent",
          "&:hover": { bgcolor: "action.hover" },
          touchAction: "none",
        }}
      />
      <Box
        component="main"
        sx={{ flexGrow: 1, overflow: "hidden", position: "relative" }}
      >
        <MainContent />
      </Box>
    </Box>
  );
}

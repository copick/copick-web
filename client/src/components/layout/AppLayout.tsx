/**
 * Main application layout with sidebar and main content area.
 */

import { Box } from "@mui/material";
import { Sidebar } from "./Sidebar";
import { MainContent } from "./MainContent";

const SIDEBAR_WIDTH = 320;

export function AppLayout() {
  return (
    <Box sx={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
      <Box
        component="aside"
        sx={{
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <Sidebar />
      </Box>
      <Box component="main" sx={{ flexGrow: 1, overflow: "hidden", position: "relative" }}>
        <MainContent />
      </Box>
    </Box>
  );
}

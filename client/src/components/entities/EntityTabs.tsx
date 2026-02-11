/**
 * Tabbed view for picks and segmentations.
 */

import { useState } from "react";
import { Box, Tabs, Tab, Typography } from "@mui/material";
import { useCopick } from "@/contexts/CopickContext";
import { PicksPanel } from "./PicksPanel";
import { SegmentationsTable } from "./SegmentationsTable";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <Box role="tabpanel" hidden={value !== index} sx={{ overflow: "auto", flexGrow: 1 }}>
      {value === index && children}
    </Box>
  );
}

export function EntityTabs() {
  const [tabIndex, setTabIndex] = useState(0);
  const { state } = useCopick();

  if (!state.selectedRunName) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Select a run to view entities
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)} variant="fullWidth" sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tab label="Picks" />
        <Tab label="Segmentations" />
      </Tabs>
      <TabPanel value={tabIndex} index={0}>
        <PicksPanel runName={state.selectedRunName} />
      </TabPanel>
      <TabPanel value={tabIndex} index={1}>
        <SegmentationsTable runName={state.selectedRunName} />
      </TabPanel>
    </Box>
  );
}

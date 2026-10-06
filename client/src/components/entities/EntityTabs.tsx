/**
 * Tabbed view for picks, segmentations and (on a copick with filaments)
 * filaments.
 */

import { useState } from "react";
import { Box, Tabs, Tab, Typography } from "@mui/material";
import { useCopick } from "@/contexts/CopickContext";
import { useFeatures } from "@/api/hooks";
import { PicksPanel } from "./PicksPanel";
import { SegmentationsTable } from "./SegmentationsTable";
import { FilamentsTable } from "./FilamentsTable";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <Box
      role="tabpanel"
      hidden={value !== index}
      sx={{ overflow: "auto", flexGrow: 1 }}
    >
      {value === index && children}
    </Box>
  );
}

export function EntityTabs() {
  const [tabIndex, setTabIndex] = useState(0);
  // One search per table, kept while switching tabs (the panels unmount).
  const [search, setSearch] = useState({
    picks: "",
    segmentations: "",
    filaments: "",
  });
  const searchProps = (table: keyof typeof search) => ({
    search: search[table],
    onSearchChange: (value: string) =>
      setSearch((s) => ({ ...s, [table]: value })),
  });
  const { state } = useCopick();
  const features = useFeatures();

  if (!state.selectedRunName) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Select a tomogram to view its run's annotations
        </Typography>
      </Box>
    );
  }

  const index = features.filaments ? tabIndex : Math.min(tabIndex, 1);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Tabs
        value={index}
        onChange={(_, v) => setTabIndex(v)}
        variant="fullWidth"
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          minHeight: 40,
          "& .MuiTab-root": {
            minWidth: 0,
            minHeight: 40,
            px: 0.5,
            textTransform: "none",
            fontSize: "0.8125rem",
          },
        }}
      >
        <Tab label="Picks" />
        <Tab label="Segmentations" />
        {features.filaments && <Tab label="Filaments" />}
      </Tabs>
      <TabPanel value={index} index={0}>
        <PicksPanel runName={state.selectedRunName} {...searchProps("picks")} />
      </TabPanel>
      <TabPanel value={index} index={1}>
        <SegmentationsTable
          runName={state.selectedRunName}
          {...searchProps("segmentations")}
        />
      </TabPanel>
      {features.filaments && (
        <TabPanel value={index} index={2}>
          <FilamentsTable
            runName={state.selectedRunName}
            {...searchProps("filaments")}
          />
        </TabPanel>
      )}
    </Box>
  );
}

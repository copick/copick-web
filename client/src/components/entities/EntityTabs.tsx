/**
 * Tabbed view for picks, segmentations and (on a copick with filaments)
 * filaments. Each tab counts what of it is shown in the viewer, and each table
 * can be limited to those rows.
 */

import { useState, type ReactNode } from "react";
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
  const [shownOnly, setShownOnly] = useState({
    picks: false,
    segmentations: false,
    filaments: false,
  });
  const searchProps = (table: keyof typeof search) => ({
    search: search[table],
    onSearchChange: (value: string) =>
      setSearch((s) => ({ ...s, [table]: value })),
    shownOnly: shownOnly[table],
    onShownOnlyChange: (value: boolean) =>
      setShownOnly((s) => ({ ...s, [table]: value })),
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
  const shownCount = {
    picks: state.selectedPicks.filter((p) => p.visible).length,
    segmentations: state.selectedSegmentations.filter((s) => s.visible).length,
    filaments: state.selectedFilaments.filter((f) => f.visible).length,
  };

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
        <Tab label={<TabLabel name="Picks" shown={shownCount.picks} />} />
        <Tab
          label={
            <TabLabel name="Segmentations" shown={shownCount.segmentations} />
          }
        />
        {features.filaments && (
          <Tab
            label={<TabLabel name="Filaments" shown={shownCount.filaments} />}
          />
        )}
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

/** A tab's name and, when any are shown in the viewer, how many. */
function TabLabel({ name, shown }: { name: string; shown: number }): ReactNode {
  return (
    <Box
      component="span"
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
      title={shown ? `${shown} shown in the viewer` : undefined}
    >
      {name}
      {shown > 0 && (
        <Box
          component="span"
          aria-label={`${shown} shown`}
          sx={{
            px: 0.6,
            minWidth: 18,
            lineHeight: "18px",
            borderRadius: 9,
            fontSize: 11,
            fontWeight: 600,
            bgcolor: "primary.main",
            color: "primary.contrastText",
          }}
        >
          {shown}
        </Box>
      )}
    </Box>
  );
}

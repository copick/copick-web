/**
 * Tabbed view for picks, segmentations, (on a copick with filaments)
 * filaments and meshes. Each tab counts what of it is shown in the viewer, and
 * each table can be limited to those rows.
 */

import { useState, type ReactNode } from "react";
import { Box, Tabs, Tab, Typography } from "@mui/material";
import { useCopick } from "@/contexts/CopickContext";
import { useFeatures } from "@/api/hooks";
import { PicksPanel } from "./PicksPanel";
import { SegmentationsTable } from "./SegmentationsTable";
import { FilamentsTable } from "./FilamentsTable";
import { MeshesTable } from "./MeshesTable";

type TabName = "picks" | "segmentations" | "filaments" | "meshes";

interface TabPanelProps {
  children?: React.ReactNode;
  name: TabName;
  value: TabName;
}

function TabPanel({ children, value, name }: TabPanelProps) {
  return (
    <Box
      role="tabpanel"
      hidden={value !== name}
      sx={{ overflow: "auto", flexGrow: 1 }}
    >
      {value === name && children}
    </Box>
  );
}

export function EntityTabs() {
  const [tab, setTab] = useState<TabName>("picks");
  // One search per table, kept while switching tabs (the panels unmount).
  const [search, setSearch] = useState({
    picks: "",
    segmentations: "",
    filaments: "",
    meshes: "",
  });
  const [shownOnly, setShownOnly] = useState({
    picks: false,
    segmentations: false,
    filaments: false,
    meshes: false,
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
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
          }}
        >
          Select a tomogram to view its run's annotations
        </Typography>
      </Box>
    );
  }

  const current = tab === "filaments" && !features.filaments ? "picks" : tab;
  const shownCount = {
    picks: state.selectedPicks.filter((p) => p.visible).length,
    segmentations: state.selectedSegmentations.filter((s) => s.visible).length,
    filaments: state.selectedFilaments.filter((f) => f.visible).length,
    meshes: state.selectedMeshes.filter((m) => m.visible).length,
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Tabs
        value={current}
        onChange={(_, v: TabName) => setTab(v)}
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          minHeight: 40,
          // Four tabs share the sidebar by the width of their labels (equal widths would cut "Segmentations").
          "& .MuiTab-root": {
            flex: "1 1 auto",
            minWidth: 0,
            minHeight: 40,
            px: 0.25,
            textTransform: "none",
            fontSize: "0.8125rem",
          },
        }}
      >
        <Tab
          value="picks"
          label={<TabLabel name="Picks" shown={shownCount.picks} />}
        />
        <Tab
          value="segmentations"
          label={
            <TabLabel name="Segmentations" shown={shownCount.segmentations} />
          }
        />
        {features.filaments && (
          <Tab
            value="filaments"
            label={<TabLabel name="Filaments" shown={shownCount.filaments} />}
          />
        )}
        <Tab
          value="meshes"
          label={<TabLabel name="Meshes" shown={shownCount.meshes} />}
        />
      </Tabs>
      <TabPanel value={current} name="picks">
        <PicksPanel runName={state.selectedRunName} {...searchProps("picks")} />
      </TabPanel>
      <TabPanel value={current} name="segmentations">
        <SegmentationsTable
          runName={state.selectedRunName}
          {...searchProps("segmentations")}
        />
      </TabPanel>
      {features.filaments && (
        <TabPanel value={current} name="filaments">
          <FilamentsTable
            runName={state.selectedRunName}
            {...searchProps("filaments")}
          />
        </TabPanel>
      )}
      <TabPanel value={current} name="meshes">
        <MeshesTable
          runName={state.selectedRunName}
          {...searchProps("meshes")}
        />
      </TabPanel>
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

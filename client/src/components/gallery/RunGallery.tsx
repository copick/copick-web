/**
 * Run gallery: a grid of the runs' central XY slices in the main area (as the
 * desktop viewers' gallery and apex-agent's tomogram gallery). Clicking a run
 * opens its tomogram; the viewer's Gallery button comes back here.
 */

import { useEffect, useRef } from "react";
import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Typography,
} from "@mui/material";
import { ArrowBack as BackIcon } from "@mui/icons-material";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useRuns } from "@/api/hooks";
import { useTomogramSelection } from "@/contexts/CopickContext";
import { useNavigation } from "@/contexts/NavigationContext";
import { TableSearch } from "@/components/entities/TableSearch";
import { useOpenTomogram } from "@/components/navigation/useOpenTomogram";
import { matchesSearch } from "@/utils/tableSearch";
import { chooseTomogram } from "@/utils/tomogramChoice";
import { requestThumbnail, useThumbnail } from "./thumbnails";

export function RunGallery() {
  const { data: runs, isLoading, error } = useRuns();
  const { runSearch, setRunSearch, showViewer } = useNavigation();
  const selection = useTomogramSelection();
  const openTomogram = useOpenTomogram();
  const queryClient = useQueryClient();
  const shown = (runs ?? []).filter((r) => matchesSearch(runSearch, [r.name]));
  const hasTomogram =
    !!selection.selectedRunName &&
    selection.selectedVoxelSize !== null &&
    !!selection.selectedTomoType;

  const open = async (runName: string) => {
    const run = await queryClient.fetchQuery({
      queryKey: ["run", runName],
      queryFn: () => api.getRun(runName),
    });
    const choice = chooseTomogram(run, {
      voxelSize: selection.selectedVoxelSize,
      tomoType: selection.selectedTomoType,
    });
    if (choice) openTomogram(runName, choice.voxelSize, choice.tomoType);
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          px: 2,
          py: 1,
          borderBottom: 1,
          borderColor: "divider",
          backgroundColor: "background.paper",
          flexWrap: "wrap",
        }}
      >
        <Typography variant="h6">Runs</Typography>
        <Box sx={{ width: 300, display: "flex" }}>
          {!!runs?.length && (
            <TableSearch
              value={runSearch}
              onChange={setRunSearch}
              what="runs"
              shown={shown.length}
              total={runs.length}
            />
          )}
        </Box>
        <Typography variant="body2" color="text.secondary">
          Central XY slices. Click a run to open it.
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        {hasTomogram && (
          <Button startIcon={<BackIcon />} onClick={showViewer}>
            Back to {selection.selectedRunName}
          </Button>
        )}
      </Box>
      <Box sx={{ flexGrow: 1, overflow: "auto", p: 2 }}>
        {isLoading && <CircularProgress size={24} />}
        {error && <Typography color="error">Failed to load runs</Typography>}
        {runs && shown.length === 0 && (
          <Typography color="text.secondary">
            {runs.length
              ? `No runs match “${runSearch.trim()}”`
              : "No runs found"}
          </Typography>
        )}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 1.5,
          }}
        >
          {shown.map((run) => (
            <RunCard
              key={run.name}
              runName={run.name}
              selected={run.name === selection.selectedRunName}
              onOpen={() => open(run.name)}
            />
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function RunCard({
  runName,
  selected,
  onOpen,
}: {
  runName: string;
  selected: boolean;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const thumbnail = useThumbnail(runName);

  // Load the thumbnail when the card comes into view.
  useEffect(() => {
    const element = ref.current;
    if (!element || thumbnail) return;
    if (typeof IntersectionObserver === "undefined") {
      requestThumbnail(runName);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          requestThumbnail(runName);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [runName, thumbnail]);

  return (
    <ButtonBase
      ref={ref}
      onClick={onOpen}
      aria-label={`Open run ${runName}`}
      data-run={runName}
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        textAlign: "left",
        borderRadius: 1,
        border: 2,
        borderColor: selected ? "primary.main" : "divider",
        overflow: "hidden",
        backgroundColor: "background.paper",
        "&:hover": {
          borderColor: selected ? "primary.light" : "text.secondary",
        },
      }}
    >
      <Box
        sx={{
          aspectRatio: "1",
          backgroundColor: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {thumbnail?.state === "ready" ? (
          <Box
            component="img"
            src={thumbnail.url}
            alt={`Central XY slice of run ${runName}`}
            sx={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: "block",
            }}
          />
        ) : thumbnail?.state === "error" ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ p: 1, textAlign: "center" }}
          >
            {thumbnail.message}
          </Typography>
        ) : (
          <CircularProgress size={20} />
        )}
      </Box>
      <Box sx={{ px: 1, py: 0.75 }}>
        <Typography
          variant="body2"
          noWrap
          sx={{ fontWeight: 600 }}
          title={runName}
        >
          {runName}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          component="div"
        >
          {thumbnail?.state === "ready"
            ? `${thumbnail.tomoType} · ${thumbnail.voxelSize} Å`
            : " "}
        </Typography>
      </Box>
    </ButtonBase>
  );
}

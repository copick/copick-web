/**
 * Main content area with the tomogram viewer.
 */

import { useEffect } from "react";
import { Box, Typography } from "@mui/material";
import { useTomogramSelection } from "@/contexts/CopickContext";
import { useConfig, useTomogram } from "@/api/hooks";
import { tomogramLabel } from "@/components/viewer/CurrentTomogram";
import { TomogramViewer } from "@/components/viewer/TomogramViewer";
import { RunGallery } from "@/components/gallery/RunGallery";
import { useNavigation } from "@/contexts/NavigationContext";

export function MainContent() {
  // Use selective hook to prevent re-renders when picks/segmentation visibility changes
  const { selectedRunName, selectedVoxelSize, selectedTomoType } =
    useTomogramSelection();

  const { view } = useNavigation();
  const { data: config } = useConfig();

  // The browser tab names the shown tomogram (several sessions are often open side by side).
  const label = tomogramLabel(
    selectedRunName,
    selectedVoxelSize,
    selectedTomoType,
  );
  const project = config?.name ?? "Copick Web";
  useEffect(() => {
    document.title = label ? `${label} — ${project}` : project;
  }, [label, project]);

  const { data: tomogram, isLoading } = useTomogram(
    selectedRunName,
    selectedVoxelSize,
    selectedTomoType,
  );

  // The run gallery until a tomogram is opened, and whenever the viewer's Gallery button is used.
  if (
    view === "gallery" ||
    !selectedRunName ||
    !selectedVoxelSize ||
    !selectedTomoType
  ) {
    return <RunGallery />;
  }

  if (isLoading) {
    return (
      <Box
        sx={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "text.secondary",
        }}
      >
        <Typography>Loading tomogram...</Typography>
      </Box>
    );
  }

  if (!tomogram) {
    return (
      <Box
        sx={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "error.main",
        }}
      >
        <Typography>Failed to load tomogram</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: "100%", position: "relative" }}>
      <TomogramViewer key={tomogram.zarr_url} zarrUrl={tomogram.zarr_url} />
    </Box>
  );
}

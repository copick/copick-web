/**
 * Main content area with the tomogram viewer.
 */

import { Box, Typography } from "@mui/material";
import { useTomogramSelection } from "@/contexts/CopickContext";
import { useTomogram } from "@/api/hooks";
import { TomogramViewer } from "@/components/viewer/TomogramViewer";

export function MainContent() {
  // Use selective hook to prevent re-renders when picks/segmentation visibility changes
  const { selectedRunName, selectedVoxelSize, selectedTomoType } = useTomogramSelection();

  const { data: tomogram, isLoading } = useTomogram(selectedRunName, selectedVoxelSize, selectedTomoType);

  // Show placeholder when no tomogram is selected
  if (!selectedRunName || !selectedVoxelSize || !selectedTomoType) {
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
        <Typography variant="h6">Select a tomogram from the sidebar to begin</Typography>
      </Box>
    );
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
      <TomogramViewer zarrUrl={tomogram.zarr_url} />
    </Box>
  );
}

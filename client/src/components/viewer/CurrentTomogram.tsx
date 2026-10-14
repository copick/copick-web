/**
 * Which run and tomogram the viewer shows, in its toolbar: run · voxel spacing · tomogram type, with the run's info.
 */

import { useState } from "react";
import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import { InfoOutlined } from "@mui/icons-material";
import { useTomogramSelection } from "@/contexts/CopickContext";
import { RunInfoDialog } from "@/components/navigation/RunInfoDialog";
import { useOpenTomogram } from "@/components/navigation/useOpenTomogram";

/** "36250 · 21.60 Å · wbp", or null while no tomogram is open. */
// eslint-disable-next-line react-refresh/only-export-components
export function tomogramLabel(
  runName: string | null,
  voxelSize: number | null,
  tomoType: string | null,
): string | null {
  if (!runName || voxelSize === null || !tomoType) return null;
  return `${runName} · ${voxelSize.toFixed(2)} Å · ${tomoType}`;
}

export function CurrentTomogram() {
  const { selectedRunName, selectedVoxelSize, selectedTomoType } =
    useTomogramSelection();
  const openTomogram = useOpenTomogram();
  const [infoOpen, setInfoOpen] = useState(false);
  if (!selectedRunName || selectedVoxelSize === null || !selectedTomoType)
    return null;

  return (
    <Box
      data-testid="current-tomogram"
      sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}
    >
      <Tooltip
        title={`Run ${selectedRunName}, voxel spacing ${selectedVoxelSize.toFixed(2)} Å, tomogram ${selectedTomoType}`}
      >
        <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
          <Box component="span" sx={{ fontWeight: 600 }}>
            {selectedRunName}
          </Box>
          <Box component="span" sx={{ color: "text.secondary" }}>
            {` · ${selectedVoxelSize.toFixed(2)} Å · ${selectedTomoType}`}
          </Box>
        </Typography>
      </Tooltip>
      <IconButton
        size="small"
        aria-label="Info for the shown run"
        title="Run info: paths, portal links, tomograms"
        onClick={() => setInfoOpen(true)}
        sx={{ color: "text.secondary" }}
      >
        <InfoOutlined fontSize="small" />
      </IconButton>
      <RunInfoDialog
        runName={infoOpen ? selectedRunName : null}
        onClose={() => setInfoOpen(false)}
        onOpenTomogram={(voxelSize, tomoType) =>
          openTomogram(selectedRunName, voxelSize, tomoType)
        }
      />
    </Box>
  );
}

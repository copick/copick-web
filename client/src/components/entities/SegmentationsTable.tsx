/**
 * Table of segmentations with visibility toggles.
 */

import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Box,
  Typography,
  CircularProgress,
} from "@mui/material";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import { useSegmentations } from "@/api/hooks";
import { useCopick, useProjectId } from "@/contexts/CopickContext";
import { rgbaToHex } from "@/utils/colorUtils";

interface SegmentationsTableProps {
  runName: string;
}

export function SegmentationsTable({ runName }: SegmentationsTableProps) {
  const projectId = useProjectId();
  const { data: segmentations, isLoading, error } = useSegmentations(projectId, runName);
  const { state, toggleSegmentationVisibility, addSegmentation } = useCopick();

  if (isLoading) {
    return (
      <Box sx={{ p: 2, display: "flex", justifyContent: "center" }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (error) {
    return (
      <Typography color="error" sx={{ p: 2 }}>
        Failed to load segmentations
      </Typography>
    );
  }

  if (!segmentations || segmentations.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ p: 2 }}>
        No segmentations found
      </Typography>
    );
  }

  const handleToggle = (seg: (typeof segmentations)[0]) => {
    const existing = state.selectedSegmentations.find(
      (s) =>
        s.name === seg.name &&
        s.userId === seg.user_id &&
        s.sessionId === seg.session_id &&
        s.voxelSize === seg.voxel_size,
    );

    if (existing) {
      toggleSegmentationVisibility(
        seg.name,
        seg.user_id,
        seg.session_id,
        seg.voxel_size,
      );
    } else {
      addSegmentation({
        name: seg.name,
        userId: seg.user_id,
        sessionId: seg.session_id,
        voxelSize: seg.voxel_size,
      });
    }
  };

  const isVisible = (seg: (typeof segmentations)[0]) => {
    const existing = state.selectedSegmentations.find(
      (s) =>
        s.name === seg.name &&
        s.userId === seg.user_id &&
        s.sessionId === seg.session_id &&
        s.voxelSize === seg.voxel_size,
    );
    return existing?.visible ?? false;
  };

  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox" sx={{ py: 0.5 }} />
            <TableCell sx={{ py: 0.5, px: 1 }}>Name</TableCell>
            <TableCell sx={{ py: 0.5, px: 1 }}>User</TableCell>
            <TableCell sx={{ py: 0.5, px: 1 }}>Session</TableCell>
            <TableCell align="right" sx={{ py: 0.5, px: 1 }}>
              Voxel Size
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {segmentations.map((seg) => {
            const color = seg.color ?? [100, 100, 100, 255];
            return (
              <TableRow
                key={`${seg.name}-${seg.user_id}-${seg.session_id}-${seg.voxel_size}`}
                hover
                sx={{
                  backgroundColor: `${rgbaToHex(color as [number, number, number, number])}20`,
                }}
              >
                <TableCell padding="checkbox" sx={{ py: 0.5 }}>
                  <IconButton size="small" onClick={() => handleToggle(seg)}>
                    {isVisible(seg) ? (
                      <Visibility fontSize="small" />
                    ) : (
                      <VisibilityOff fontSize="small" />
                    )}
                  </IconButton>
                </TableCell>
                <TableCell sx={{ py: 0.5, px: 1, maxWidth: 100 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        background: seg.is_multilabel
                          ? "conic-gradient(red, orange, yellow, green, blue, violet, red)"
                          : rgbaToHex(
                              color as [number, number, number, number],
                            ),
                        flexShrink: 0,
                      }}
                    />
                    <Typography
                      variant="body2"
                      noWrap
                      sx={{ overflow: "hidden", textOverflow: "ellipsis" }}
                    >
                      {seg.name}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell sx={{ py: 0.5, px: 1 }}>
                  <Typography variant="body2" noWrap>
                    {seg.user_id}
                  </Typography>
                </TableCell>
                <TableCell sx={{ py: 0.5, px: 1 }}>
                  <Typography variant="body2" noWrap>
                    {seg.session_id}
                  </Typography>
                </TableCell>
                <TableCell align="right" sx={{ py: 0.5, px: 1 }}>
                  <Typography variant="body2">
                    {seg.voxel_size.toFixed(2)}
                  </Typography>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

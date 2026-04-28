/**
 * Table of picks with visibility toggles.
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
import { usePicks } from "@/api/hooks";
import { useCopick, useProjectId } from "@/contexts/CopickContext";
import { rgbaToHex } from "@/utils/colorUtils";

interface PicksTableProps {
  runName: string;
}

export function PicksTable({ runName }: PicksTableProps) {
  const projectId = useProjectId();
  const { data: picks, isLoading, error } = usePicks(projectId, runName);
  const { state, togglePickVisibility, addPick } = useCopick();

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
        Failed to load picks
      </Typography>
    );
  }

  if (!picks || picks.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ p: 2 }}>
        No picks found
      </Typography>
    );
  }

  const handleToggle = (pick: (typeof picks)[0]) => {
    const existing = state.selectedPicks.find(
      (p) => p.objectName === pick.object_name && p.userId === pick.user_id && p.sessionId === pick.session_id
    );

    if (existing) {
      togglePickVisibility(pick.object_name, pick.user_id, pick.session_id);
    } else {
      addPick({
        objectName: pick.object_name,
        userId: pick.user_id,
        sessionId: pick.session_id,
      });
    }
  };

  const isVisible = (pick: (typeof picks)[0]) => {
    const existing = state.selectedPicks.find(
      (p) => p.objectName === pick.object_name && p.userId === pick.user_id && p.sessionId === pick.session_id
    );
    return existing?.visible ?? false;
  };

  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox" sx={{ py: 0.5 }} />
            <TableCell sx={{ py: 0.5, px: 1 }}>Object</TableCell>
            <TableCell sx={{ py: 0.5, px: 1 }}>User</TableCell>
            <TableCell sx={{ py: 0.5, px: 1 }}>Session</TableCell>
            <TableCell align="right" sx={{ py: 0.5, px: 1 }}>Count</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {picks.map((pick) => (
            <TableRow
              key={`${pick.object_name}-${pick.user_id}-${pick.session_id}`}
              hover
              sx={{
                backgroundColor: `${rgbaToHex(pick.color)}20`,
              }}
            >
              <TableCell padding="checkbox" sx={{ py: 0.5 }}>
                <IconButton size="small" onClick={() => handleToggle(pick)}>
                  {isVisible(pick) ? <Visibility fontSize="small" /> : <VisibilityOff fontSize="small" />}
                </IconButton>
              </TableCell>
              <TableCell sx={{ py: 0.5, px: 1, maxWidth: 100 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      backgroundColor: rgbaToHex(pick.color),
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="body2" noWrap sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    {pick.object_name}
                  </Typography>
                </Box>
              </TableCell>
              <TableCell sx={{ py: 0.5, px: 1 }}>
                <Typography variant="body2" noWrap>
                  {pick.user_id}
                </Typography>
              </TableCell>
              <TableCell sx={{ py: 0.5, px: 1 }}>
                <Typography variant="body2" noWrap>
                  {pick.session_id}
                </Typography>
              </TableCell>
              <TableCell align="right" sx={{ py: 0.5, px: 1 }}>
                <Typography variant="body2">{pick.point_count}</Typography>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

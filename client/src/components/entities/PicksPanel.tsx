/**
 * Enhanced picks panel with editing capabilities.
 * Extends PicksTable with create, edit, and delete functionality.
 */

import { useState } from "react";
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Typography,
  CircularProgress,
  Button,
  Tooltip,
} from "@mui/material";
import {
  Visibility,
  VisibilityOff,
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Lock as LockIcon,
} from "@mui/icons-material";
import {
  usePicks,
  usePickPoints,
  useCreatePicks,
  useDeletePicks,
} from "@/api/hooks";
import { useCopick } from "@/contexts/CopickContext";
import { usePicking, type PickingPoint } from "@/contexts/PickingContext";
import { rgbaToHex } from "@/utils/colorUtils";
import { NewPickDialog } from "@/components/picking/NewPickDialog";
import type { PicksSummaryResponse } from "@/api/types";

interface PicksPanelProps {
  runName: string;
}

export function PicksPanel({ runName }: PicksPanelProps) {
  const { data: picks, isLoading, error } = usePicks(runName);
  const { state, togglePickVisibility, addPick } = useCopick();
  const { state: pickingState, isEditing } = usePicking();
  const createPicks = useCreatePicks();
  const deletePicks = useDeletePicks();

  const [dialogOpen, setDialogOpen] = useState(false);

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

  const handleCreatePicks = async (
    objectName: string,
    userId: string,
    sessionId: string,
  ) => {
    await createPicks.mutateAsync({
      runName,
      data: { object_name: objectName, user_id: userId, session_id: sessionId },
    });
  };

  const handleDeletePicks = async (pick: PicksSummaryResponse) => {
    if (
      window.confirm(`Delete picks for ${pick.object_name} by ${pick.user_id}?`)
    ) {
      await deletePicks.mutateAsync({
        runName,
        objectName: pick.object_name,
        userId: pick.user_id,
        sessionId: pick.session_id,
      });
    }
  };

  const handleToggle = (pick: PicksSummaryResponse) => {
    const existing = state.selectedPicks.find(
      (p) =>
        p.objectName === pick.object_name &&
        p.userId === pick.user_id &&
        p.sessionId === pick.session_id,
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

  const isVisible = (pick: PicksSummaryResponse) => {
    const existing = state.selectedPicks.find(
      (p) =>
        p.objectName === pick.object_name &&
        p.userId === pick.user_id &&
        p.sessionId === pick.session_id,
    );
    return existing?.visible ?? false;
  };

  const isToolPick = (pick: PicksSummaryResponse) => pick.session_id === "0";

  const isCurrentlyEditing = (pick: PicksSummaryResponse) =>
    pickingState.editingPicks?.objectName === pick.object_name &&
    pickingState.editingPicks?.userId === pick.user_id &&
    pickingState.editingPicks?.sessionId === pick.session_id;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Toolbar */}
      <Box
        sx={{
          p: 1,
          display: "flex",
          gap: 1,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Button
          startIcon={<AddIcon />}
          size="small"
          onClick={() => setDialogOpen(true)}
          disabled={isEditing}
        >
          New
        </Button>
      </Box>

      {/* Table */}
      {!picks || picks.length === 0 ? (
        <Typography color="text.secondary" sx={{ p: 2 }}>
          No picks found
        </Typography>
      ) : (
        <TableContainer sx={{ flexGrow: 1 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" sx={{ py: 0.5 }} />
                <TableCell sx={{ py: 0.5, px: 1 }}>Object</TableCell>
                <TableCell sx={{ py: 0.5, px: 1 }}>User</TableCell>
                <TableCell sx={{ py: 0.5, px: 1 }}>Session</TableCell>
                <TableCell align="right" sx={{ py: 0.5, px: 1 }}>
                  Count
                </TableCell>
                <TableCell padding="checkbox" sx={{ py: 0.5 }}>
                  Actions
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {picks.map((pick) => (
                <PickRow
                  key={`${pick.object_name}-${pick.user_id}-${pick.session_id}`}
                  pick={pick}
                  runName={runName}
                  isVisible={isVisible(pick)}
                  isToolPick={isToolPick(pick)}
                  isCurrentlyEditing={isCurrentlyEditing(pick)}
                  isAnyEditing={isEditing}
                  onToggle={() => handleToggle(pick)}
                  onDelete={() => handleDeletePicks(pick)}
                />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* New Pick Dialog */}
      <NewPickDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleCreatePicks}
        runName={runName}
      />
    </Box>
  );
}

// Separate row component for editing functionality
interface PickRowProps {
  pick: PicksSummaryResponse;
  runName: string;
  isVisible: boolean;
  isToolPick: boolean;
  isCurrentlyEditing: boolean;
  isAnyEditing: boolean;
  onToggle: () => void;
  onDelete: () => void;
}

function PickRow({
  pick,
  runName,
  isVisible,
  isToolPick,
  isCurrentlyEditing,
  isAnyEditing,
  onToggle,
  onDelete,
}: PickRowProps) {
  const { startEditing } = usePicking();
  const { data: pickDetail } = usePickPoints(
    runName,
    pick.object_name,
    pick.user_id,
    pick.session_id,
  );

  const handleEdit = () => {
    if (!pickDetail) return;

    // Convert points to PickingPoint format
    const points: PickingPoint[] = pickDetail.points.map((p, index) => ({
      id: `${p.x.toFixed(2)}-${p.y.toFixed(2)}-${p.z.toFixed(2)}-${index}`,
      x: p.x,
      y: p.y,
      z: p.z,
      instance_id: p.instance_id,
      score: p.score,
    }));

    startEditing(
      {
        runName,
        objectName: pick.object_name,
        userId: pick.user_id,
        sessionId: pick.session_id,
        color: pick.color,
      },
      points,
    );
  };

  return (
    <TableRow
      hover
      sx={{
        backgroundColor: isCurrentlyEditing
          ? `${rgbaToHex(pick.color)}40`
          : `${rgbaToHex(pick.color)}20`,
      }}
    >
      <TableCell padding="checkbox" sx={{ py: 0.5 }}>
        <IconButton size="small" onClick={onToggle}>
          {isVisible ? (
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
              backgroundColor: rgbaToHex(pick.color),
              flexShrink: 0,
            }}
          />
          <Typography
            variant="body2"
            noWrap
            sx={{ overflow: "hidden", textOverflow: "ellipsis" }}
          >
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
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Typography variant="body2" noWrap>
            {pick.session_id}
          </Typography>
          {isToolPick && (
            <Tooltip title="Tool picks are read-only">
              <LockIcon fontSize="inherit" sx={{ color: "text.secondary" }} />
            </Tooltip>
          )}
        </Box>
      </TableCell>
      <TableCell align="right" sx={{ py: 0.5, px: 1 }}>
        <Typography variant="body2">{pick.point_count}</Typography>
      </TableCell>
      <TableCell padding="checkbox" sx={{ py: 0.5 }}>
        <Box sx={{ display: "flex" }}>
          {!isToolPick && (
            <>
              <Tooltip
                title={
                  isAnyEditing ? "Finish current edit first" : "Edit picks"
                }
              >
                <span>
                  <IconButton
                    size="small"
                    onClick={handleEdit}
                    disabled={isAnyEditing && !isCurrentlyEditing}
                    color={isCurrentlyEditing ? "primary" : "default"}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Delete picks">
                <span>
                  <IconButton
                    size="small"
                    onClick={onDelete}
                    disabled={isAnyEditing}
                    color="error"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </>
          )}
        </Box>
      </TableCell>
    </TableRow>
  );
}

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
  Palette as PaletteIcon,
  Timeline as FilamentIcon,
} from "@mui/icons-material";
import {
  usePicks,
  usePickPoints,
  useCreatePicks,
  useDeletePicks,
} from "@/api/hooks";
import { useCopick } from "@/contexts/CopickContext";
import { rowDoubleClick, toggleRowSx } from "@/utils/rowToggle";
import { EntityNameCell } from "./EntityNameCell";
import { COL, entityTableSx, swatchSx } from "./entityTableStyles";
import { usePicking, type PickingPoint } from "@/contexts/PickingContext";
import { useFilamentEditing } from "@/contexts/FilamentEditingContext";
import { rgbaToHex } from "@/utils/colorUtils";
import { matchesSearch } from "@/utils/tableSearch";
import { TableSearch } from "./TableSearch";
import { NewPickDialog } from "@/components/picking/NewPickDialog";
import type { PicksSummaryResponse } from "@/api/types";

interface PicksPanelProps {
  runName: string;
  /** Search text (see TableSearch). */
  search: string;
  onSearchChange: (value: string) => void;
}

export function PicksPanel({
  runName,
  search,
  onSearchChange,
}: PicksPanelProps) {
  const { data: picks, isLoading, error } = usePicks(runName);
  const shownPicks = (picks ?? []).filter((p) =>
    matchesSearch(search, [p.object_name, p.user_id, p.session_id]),
  );
  const { state, togglePickVisibility, addPick, setPickColorByInstance } =
    useCopick();
  const { state: pickingState, isEditing: isEditingPicks } = usePicking();
  const { isEditing: isEditingFilaments } = useFilamentEditing();
  // Picks and filaments are never edited at the same time.
  const isEditing = isEditingPicks || isEditingFilaments;
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

  const selectionOf = (pick: PicksSummaryResponse) =>
    state.selectedPicks.find(
      (p) =>
        p.objectName === pick.object_name &&
        p.userId === pick.user_id &&
        p.sessionId === pick.session_id,
    );

  const isToolPick = (pick: PicksSummaryResponse) => pick.session_id === "0";
  // Width of the actions column: palette (sets with instance IDs) + edit and delete (user sets).
  const actionColumns = Math.max(
    1,
    ...(picks ?? []).map(
      (p) => ((p.instance_count ?? 0) > 0 ? 1 : 0) + (isToolPick(p) ? 0 : 2),
    ),
  );

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
        {!!picks?.length && (
          <TableSearch
            value={search}
            onChange={onSearchChange}
            what="picks"
            shown={shownPicks.length}
            total={picks.length}
          />
        )}
      </Box>

      {/* Table */}
      {!picks || picks.length === 0 ? (
        <Typography color="text.secondary" sx={{ p: 2 }}>
          No picks found
        </Typography>
      ) : shownPicks.length === 0 ? (
        <Typography color="text.secondary" sx={{ p: 2 }}>
          No picks match “{search.trim()}”
        </Typography>
      ) : (
        <TableContainer sx={{ flexGrow: 1 }}>
          <Table size="small" stickyHeader sx={entityTableSx}>
            <TableHead>
              <TableRow>
                <TableCell padding="none" sx={{ width: COL.toggle }} />
                <TableCell sx={{ py: 0.5, px: 0.5 }}>Object</TableCell>
                <TableCell
                  align="right"
                  sx={{ py: 0.5, px: 0.5, width: COL.count }}
                >
                  Count
                </TableCell>
                <TableCell
                  padding="none"
                  sx={{ width: COL.icon * actionColumns }}
                />
              </TableRow>
            </TableHead>
            <TableBody>
              {shownPicks.map((pick) => (
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
                  colorByInstance={
                    selectionOf(pick)?.colorByInstance ?? !!pick.is_filament
                  }
                  onToggleColorByInstance={() => {
                    if (!selectionOf(pick)) {
                      addPick({
                        objectName: pick.object_name,
                        userId: pick.user_id,
                        sessionId: pick.session_id,
                      });
                    }
                    setPickColorByInstance(
                      pick.object_name,
                      pick.user_id,
                      pick.session_id,
                      !(
                        selectionOf(pick)?.colorByInstance ?? !!pick.is_filament
                      ),
                    );
                  }}
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
  colorByInstance: boolean;
  onToggleColorByInstance: () => void;
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
  colorByInstance,
  onToggleColorByInstance,
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
      transformation: p.transformation ?? null,
    }));

    startEditing(
      {
        runName,
        objectName: pick.object_name,
        userId: pick.user_id,
        sessionId: pick.session_id,
        color: pick.color,
        isFilament: !!pick.is_filament,
      },
      points,
    );
  };

  return (
    <TableRow
      hover
      onDoubleClick={rowDoubleClick(onToggle)}
      sx={{
        ...toggleRowSx,
        backgroundColor: isCurrentlyEditing
          ? `${rgbaToHex(pick.color)}40`
          : `${rgbaToHex(pick.color)}20`,
      }}
    >
      <TableCell padding="none" align="center">
        <IconButton size="small" onClick={onToggle}>
          {isVisible ? (
            <Visibility fontSize="small" />
          ) : (
            <VisibilityOff fontSize="small" />
          )}
        </IconButton>
      </TableCell>
      <EntityNameCell
        name={pick.object_name}
        userId={pick.user_id}
        sessionId={pick.session_id}
        swatch={<Box sx={swatchSx(rgbaToHex(pick.color))} />}
        badges={
          pick.is_filament && (
            <Tooltip title="Filament object: instance_id is the filament ID">
              <FilamentIcon
                fontSize="inherit"
                sx={{ color: "text.secondary", flexShrink: 0 }}
              />
            </Tooltip>
          )
        }
        caption={
          isToolPick && (
            <Tooltip title="Tool picks are read-only">
              <LockIcon fontSize="inherit" />
            </Tooltip>
          )
        }
      />
      <TableCell align="right" sx={{ py: 0.25, px: 0.5 }}>
        <Tooltip
          title={
            pick.instance_count
              ? `${pick.point_count} points, ${pick.instance_count} instance IDs`
              : `${pick.point_count} points`
          }
        >
          <Typography variant="body2">{pick.point_count}</Typography>
        </Tooltip>
      </TableCell>
      <TableCell padding="none">
        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
          {(pick.instance_count ?? 0) > 0 && (
            <Tooltip
              title={
                colorByInstance
                  ? "Colour by object"
                  : "Colour by instance ID (matches instance segmentations)"
              }
            >
              <IconButton
                size="small"
                onClick={onToggleColorByInstance}
                color={colorByInstance ? "primary" : "default"}
                aria-label="Colour by instance"
              >
                <PaletteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
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

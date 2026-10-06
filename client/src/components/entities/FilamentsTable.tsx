/**
 * Filament sets of the run (one per object, user and session) with
 * visibility toggles. A row expands into its filaments, coloured by ID;
 * clicking one highlights it and moves the crosshair to its midpoint.
 * New starts tracing a new set; the pencil opens a set in the filament editor.
 */

import { Fragment, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  List,
  ListItemButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Add as AddIcon,
  Edit as EditIcon,
  ExpandLess,
  ExpandMore,
  Lock as LockIcon,
  Visibility,
  VisibilityOff,
} from "@mui/icons-material";
import { useFilamentDetail, useFilaments } from "@/api/hooks";
import type { FilamentsSummaryResponse } from "@/api/types";
import { rowDoubleClick, toggleRowSx } from "@/utils/rowToggle";
import { EntityNameCell } from "./EntityNameCell";
import { COL, entityTableSx, swatchSx } from "./entityTableStyles";
import { useFilamentEditing } from "@/contexts/FilamentEditingContext";
import { matchesSearch } from "@/utils/tableSearch";
import { TableSearch } from "./TableSearch";
import { usePicking } from "@/contexts/PickingContext";
import { NewFilamentsDialog } from "@/components/filaments/NewFilamentsDialog";
import { useStartFilamentEditing } from "@/components/filaments/useStartFilamentEditing";
import { filamentsKey, useCopick } from "@/contexts/CopickContext";
import { useViewerBridge } from "@/contexts/SliceContext";
import { rgbaToCss, rgbaToHex } from "@/utils/colorUtils";
import { instanceColor } from "@/utils/instanceColors";

interface FilamentsTableProps {
  runName: string;
  /** Search text (see TableSearch). */
  search: string;
  onSearchChange: (value: string) => void;
}

export function FilamentsTable({
  runName,
  search,
  onSearchChange,
}: FilamentsTableProps) {
  const { data: sets, isLoading, error } = useFilaments(runName);
  const shownSets = (sets ?? []).filter((f) =>
    matchesSearch(search, [f.object_name, f.user_id, f.session_id]),
  );
  const { state, toggleFilamentsVisibility, addFilaments } = useCopick();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const filamentEditing = useFilamentEditing();
  const picking = usePicking();
  const startEditing = useStartFilamentEditing();
  const busy = filamentEditing.isEditing || picking.isEditing;
  const editedKey = filamentEditing.editing
    ? filamentsKey(filamentEditing.editing)
    : null;

  const header = (
    <Box sx={{ px: 1, py: 0.5, display: "flex", alignItems: "center" }}>
      <Tooltip
        title={
          busy
            ? "Finish the current edit first"
            : "Trace a new set of filaments"
        }
      >
        <span>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setNewOpen(true)}
            disabled={busy}
          >
            New
          </Button>
        </span>
      </Tooltip>
      <NewFilamentsDialog
        open={newOpen}
        runName={runName}
        onClose={() => setNewOpen(false)}
        onCreate={(set) => startEditing(set, true)}
      />
      {!!sets?.length && (
        <Box sx={{ ml: 1, flexGrow: 1, display: "flex", minWidth: 0 }}>
          <TableSearch
            value={search}
            onChange={onSearchChange}
            what="filaments"
            shown={shownSets.length}
            total={sets.length}
          />
        </Box>
      )}
    </Box>
  );

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
        Failed to load filaments
      </Typography>
    );
  }
  if (!sets || sets.length === 0) {
    return (
      <Box>
        {header}
        <Typography color="text.secondary" sx={{ p: 2 }}>
          No filaments found
        </Typography>
      </Box>
    );
  }

  const identity = (f: FilamentsSummaryResponse) => ({
    objectName: f.object_name,
    userId: f.user_id,
    sessionId: f.session_id,
  });
  const selectionOf = (f: FilamentsSummaryResponse) =>
    state.selectedFilaments.find(
      (s) => filamentsKey(s) === filamentsKey(identity(f)),
    );

  return (
    <Box>
      {header}
      {shownSets.length === 0 && (
        <Typography color="text.secondary" sx={{ p: 2 }}>
          No filaments match “{search.trim()}”
        </Typography>
      )}
      {shownSets.length > 0 && (
        <TableContainer>
          <Table size="small" sx={entityTableSx}>
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
                <TableCell padding="none" sx={{ width: COL.icon * 2 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {shownSets.map((f) => {
                const key = filamentsKey(identity(f));
                const selection = selectionOf(f);
                const isExpanded = expanded === key;
                return (
                  <Fragment key={key}>
                    <TableRow
                      hover
                      onDoubleClick={rowDoubleClick(() =>
                        selection
                          ? toggleFilamentsVisibility(key)
                          : addFilaments(identity(f)),
                      )}
                      sx={{
                        ...toggleRowSx,
                        backgroundColor: `${rgbaToHex(f.color)}${key === editedKey ? "50" : "20"}`,
                      }}
                    >
                      <TableCell padding="none" align="center">
                        <IconButton
                          size="small"
                          aria-label={`Toggle filaments ${f.object_name} ${f.user_id} ${f.session_id}`}
                          onClick={() =>
                            selection
                              ? toggleFilamentsVisibility(key)
                              : addFilaments(identity(f))
                          }
                        >
                          {selection?.visible ? (
                            <Visibility fontSize="small" />
                          ) : (
                            <VisibilityOff fontSize="small" />
                          )}
                        </IconButton>
                      </TableCell>
                      <EntityNameCell
                        name={f.object_name}
                        userId={f.user_id}
                        sessionId={f.session_id}
                        swatch={<Box sx={swatchSx(rgbaToHex(f.color))} />}
                        caption={
                          f.session_id === "0" && (
                            <Tooltip title="Tool filaments are read-only">
                              <LockIcon fontSize="inherit" />
                            </Tooltip>
                          )
                        }
                      />
                      <TableCell align="right" sx={{ py: 0.25, px: 0.5 }}>
                        <Typography variant="body2">
                          {f.filament_count}
                        </Typography>
                      </TableCell>
                      <TableCell padding="none">
                        <Box
                          sx={{ display: "flex", justifyContent: "flex-end" }}
                        >
                          <Tooltip
                            title={
                              busy
                                ? "Finish the current edit first"
                                : f.session_id === "0"
                                  ? "Edit (tool output: saved under your own session)"
                                  : "Edit filaments"
                            }
                          >
                            <span>
                              <IconButton
                                size="small"
                                aria-label={`Edit filaments ${f.object_name} ${f.user_id} ${f.session_id}`}
                                disabled={busy}
                                color={
                                  key === editedKey ? "primary" : "default"
                                }
                                onClick={() => startEditing(identity(f))}
                              >
                                <EditIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <IconButton
                            size="small"
                            onClick={() => setExpanded(isExpanded ? null : key)}
                          >
                            {isExpanded ? (
                              <ExpandLess fontSize="small" />
                            ) : (
                              <ExpandMore fontSize="small" />
                            )}
                          </IconButton>
                        </Box>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={4} sx={{ p: 0, pl: 1 }}>
                          <FilamentList runName={runName} summary={f} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

function FilamentList({
  runName,
  summary,
}: {
  runName: string;
  summary: FilamentsSummaryResponse;
}) {
  const { data, isLoading } = useFilamentDetail(
    runName,
    summary.object_name,
    summary.user_id,
    summary.session_id,
  );
  const { state, addFilaments, selectFilament } = useCopick();
  const bridge = useViewerBridge();
  const identity = {
    objectName: summary.object_name,
    userId: summary.user_id,
    sessionId: summary.session_id,
  };
  const key = filamentsKey(identity);
  const selection = state.selectedFilaments.find(
    (s) => filamentsKey(s) === key,
  );

  if (isLoading || !data) {
    return (
      <Box sx={{ p: 1 }}>
        <CircularProgress size={14} />
      </Box>
    );
  }
  return (
    <List dense disablePadding sx={{ maxHeight: 200, overflow: "auto" }}>
      {data.filaments.map((f) => {
        const color = instanceColor(f.instance_id, data.color);
        let length = 0;
        for (let i = 1; i < f.points.length; i++) {
          const [a, b] = [f.points[i - 1], f.points[i]];
          length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        }
        return (
          <ListItemButton
            key={f.instance_id}
            selected={selection?.selectedId === f.instance_id}
            sx={{ py: 0, pl: 1 }}
            onClick={() => {
              if (!selection) addFilaments(identity);
              selectFilament(
                key,
                selection?.selectedId === f.instance_id ? null : f.instance_id,
              );
              const mid = f.points[Math.floor(f.points.length / 2)];
              bridge.focusAngstrom(mid, { orbit: true });
            }}
          >
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: "2px",
                bgcolor: rgbaToCss(color),
                mr: 1,
                flexShrink: 0,
              }}
            />
            <Typography variant="body2" sx={{ flexGrow: 1 }}>
              #{f.instance_id}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
              {(length / 10).toFixed(0)} nm
              {f.curve_kind ? ` · ${f.curve_kind}` : ""}
            </Typography>
          </ListItemButton>
        );
      })}
    </List>
  );
}

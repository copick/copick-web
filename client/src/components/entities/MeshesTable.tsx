/**
 * Meshes of the run (one per object, user and session) with visibility
 * toggles. Meshes are drawn in the 3D view only, in their object's colour.
 */

import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import { Visibility, VisibilityOff, WarningAmber } from "@mui/icons-material";
import { useMeshes } from "@/api/hooks";
import type { MeshSummaryResponse } from "@/api/types";
import { meshKey, useCopick } from "@/contexts/CopickContext";
import { useLayerStatus } from "@/contexts/LayerStatusContext";
import { rgbaToHex } from "@/utils/colorUtils";
import { rowDoubleClick, toggleRowSx } from "@/utils/rowToggle";
import { matchesSearch, noMatchText } from "@/utils/tableSearch";
import { EntityNameCell } from "./EntityNameCell";
import { COL, entityTableSx, shownRowSx, swatchSx } from "./entityTableStyles";
import { TableSearch } from "./TableSearch";

interface MeshesTableProps {
  runName: string;
  /** Search text (see TableSearch). */
  search: string;
  onSearchChange: (value: string) => void;
  /** List only the rows shown in the viewer (see TableSearch). */
  shownOnly: boolean;
  onShownOnlyChange: (value: boolean) => void;
}

const identity = (m: MeshSummaryResponse) => ({
  objectName: m.object_name,
  userId: m.user_id,
  sessionId: m.session_id,
});

export function MeshesTable({
  runName,
  search,
  onSearchChange,
  shownOnly,
  onShownOnlyChange,
}: MeshesTableProps) {
  const { data: meshes, isLoading, error } = useMeshes(runName);
  const { state, toggleMeshVisibility, addMesh } = useCopick();
  const { statuses } = useLayerStatus();
  const selectionOf = (m: MeshSummaryResponse) =>
    state.selectedMeshes.find((s) => meshKey(s) === meshKey(identity(m)));
  const isDisplayed = (m: MeshSummaryResponse) => !!selectionOf(m)?.visible;
  const toggle = (m: MeshSummaryResponse) =>
    selectionOf(m)
      ? toggleMeshVisibility(meshKey(identity(m)))
      : addMesh(identity(m));
  const shownMeshes = (meshes ?? []).filter(
    (m) =>
      (!shownOnly || isDisplayed(m)) &&
      matchesSearch(search, [m.object_name, m.user_id, m.session_id]),
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
        Failed to load meshes
      </Typography>
    );
  }
  if (!meshes || meshes.length === 0) {
    return (
      <Typography sx={{ color: "text.secondary", p: 2 }}>
        No meshes found
      </Typography>
    );
  }

  return (
    <Box>
      <Box sx={{ px: 1, py: 0.5, display: "flex", minWidth: 0 }}>
        <TableSearch
          value={search}
          onChange={onSearchChange}
          what="meshes"
          shown={shownMeshes.length}
          total={meshes.length}
          shownOnly={shownOnly}
          onShownOnlyChange={onShownOnlyChange}
          displayed={meshes.filter(isDisplayed).length}
        />
      </Box>
      <Typography
        variant="caption"
        component="p"
        sx={{ color: "text.secondary", px: 1.5, pb: 0.5 }}
      >
        Meshes are drawn in the 3D view.
      </Typography>
      {shownMeshes.length === 0 ? (
        <Typography sx={{ color: "text.secondary", p: 2 }}>
          {noMatchText("meshes", search, shownOnly)}
        </Typography>
      ) : (
        <TableContainer>
          <Table size="small" sx={entityTableSx}>
            <TableHead>
              <TableRow>
                <TableCell padding="none" sx={{ width: COL.toggle }} />
                <TableCell sx={{ py: 0.5, px: 0.5 }}>Object</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shownMeshes.map((m) => {
                const key = meshKey(identity(m));
                const visible = isDisplayed(m);
                const status = statuses[key];
                return (
                  <TableRow
                    key={key}
                    hover
                    onDoubleClick={rowDoubleClick(() => toggle(m))}
                    sx={{
                      ...toggleRowSx,
                      ...shownRowSx(visible),
                      backgroundColor: `${rgbaToHex(m.color)}20`,
                    }}
                  >
                    <TableCell padding="none" align="center">
                      <IconButton
                        size="small"
                        aria-label={`Toggle mesh ${m.object_name} ${m.user_id} ${m.session_id}`}
                        onClick={() => toggle(m)}
                      >
                        {visible ? (
                          <Visibility fontSize="small" />
                        ) : (
                          <VisibilityOff fontSize="small" />
                        )}
                      </IconButton>
                    </TableCell>
                    <EntityNameCell
                      name={m.object_name}
                      userId={m.user_id}
                      sessionId={m.session_id}
                      swatch={<Box sx={swatchSx(rgbaToHex(m.color))} />}
                      caption={
                        status && (
                          <Tooltip title={status.message}>
                            <Chip
                              size="small"
                              color="warning"
                              icon={<WarningAmber />}
                              label="error"
                              sx={{ height: 18, fontSize: 10, flexShrink: 0 }}
                            />
                          </Tooltip>
                        )
                      }
                    />
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

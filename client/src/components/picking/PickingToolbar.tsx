/**
 * Toolbar for selecting picking tools and displaying current edit state.
 */

import {
  Box,
  ToggleButtonGroup,
  ToggleButton,
  Button,
  Chip,
  Tooltip,
} from "@mui/material";
import PanToolIcon from "@mui/icons-material/PanTool";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import HighlightAltIcon from "@mui/icons-material/HighlightAlt";
import DeleteIcon from "@mui/icons-material/Delete";
import SaveIcon from "@mui/icons-material/Save";
import CloseIcon from "@mui/icons-material/Close";
import { usePicking, type PickingTool } from "@/contexts/PickingContext";
import { useProjectId } from "@/contexts/CopickContext";
import { useUpdatePicks } from "@/api/hooks";
import { rgbaToCss } from "@/utils/colorUtils";

export function PickingToolbar() {
  const { state, setTool, stopEditing, markSaved, deleteSelectedPoints } =
    usePicking();
  const projectId = useProjectId();
  const updatePicks = useUpdatePicks();

  const handleToolChange = (
    _: React.MouseEvent<HTMLElement>,
    tool: PickingTool | null,
  ) => {
    if (tool) {
      setTool(tool);
    }
  };

  const handleSave = async () => {
    if (!state.editingPicks) return;

    await updatePicks.mutateAsync({
      projectId,
      runName: state.editingPicks.runName,
      objectName: state.editingPicks.objectName,
      userId: state.editingPicks.userId,
      sessionId: state.editingPicks.sessionId,
      points: state.localPoints.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        instance_id: p.instance_id,
        score: p.score,
      })),
    });

    markSaved();
  };

  const handleCancel = () => {
    stopEditing();
  };

  const handleDeleteSelected = () => {
    if (state.selectedPointIds.size > 0) {
      deleteSelectedPoints();
    }
  };

  if (!state.editingPicks) {
    return null; // Don't show toolbar when not editing
  }

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        p: 1,
        borderBottom: 1,
        borderColor: "divider",
        backgroundColor: "background.paper",
        flexWrap: "wrap",
      }}
    >
      {/* Current editing info */}
      <Chip
        label={`Editing: ${state.editingPicks.objectName}`}
        size="small"
        sx={{
          backgroundColor: rgbaToCss(state.editingPicks.color, 0.2),
          fontWeight: "bold",
        }}
      />

      {/* Tool selector */}
      <ToggleButtonGroup
        value={state.activeTool}
        exclusive
        onChange={handleToolChange}
        size="small"
      >
        <Tooltip title="View mode (pan/zoom)">
          <ToggleButton value="view">
            <PanToolIcon fontSize="small" />
          </ToggleButton>
        </Tooltip>
        <Tooltip title="Add point (click to place)">
          <ToggleButton value="add">
            <AddCircleOutlineIcon fontSize="small" />
          </ToggleButton>
        </Tooltip>
        <Tooltip title="Select points">
          <ToggleButton value="select">
            <HighlightAltIcon fontSize="small" />
          </ToggleButton>
        </Tooltip>
        <Tooltip title="Delete point (click to remove)">
          <ToggleButton value="delete">
            <DeleteIcon fontSize="small" />
          </ToggleButton>
        </Tooltip>
      </ToggleButtonGroup>

      {/* Point count */}
      <Chip
        label={`${state.localPoints.length} points`}
        size="small"
        variant="outlined"
      />

      {/* Selection info and delete button */}
      {state.selectedPointIds.size > 0 && (
        <>
          <Chip
            label={`${state.selectedPointIds.size} selected`}
            size="small"
            color="primary"
            onDelete={handleDeleteSelected}
            deleteIcon={<DeleteIcon />}
          />
        </>
      )}

      {/* Spacer */}
      <Box sx={{ flexGrow: 1 }} />

      {/* Unsaved changes indicator */}
      {state.hasUnsavedChanges && (
        <Chip label="Unsaved changes" size="small" color="warning" />
      )}

      {/* Save/Cancel buttons */}
      <Button
        startIcon={<SaveIcon />}
        onClick={handleSave}
        variant="contained"
        size="small"
        disabled={!state.hasUnsavedChanges || updatePicks.isPending}
      >
        {updatePicks.isPending ? "Saving..." : "Save"}
      </Button>
      <Button startIcon={<CloseIcon />} onClick={handleCancel} size="small">
        Cancel
      </Button>
    </Box>
  );
}

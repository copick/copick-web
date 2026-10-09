/**
 * Toolbar of the filament editor: tools (view / trace / cut), the active
 * filament and its actions, insert mode, undo / redo and saving.
 */

import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from "@mui/material";
import {
  AddCircleOutline as NewFilamentIcon,
  ChevronLeft,
  ChevronRight,
  Close as CloseIcon,
  ContentCut as CutIcon,
  Delete as DeleteIcon,
  Gesture as TraceIcon,
  PanTool as ViewIcon,
  Redo as RedoIcon,
  Save as SaveIcon,
  SwapHoriz as ReverseIcon,
  Undo as UndoIcon,
} from "@mui/icons-material";
import { useCopick } from "@/contexts/CopickContext";
import {
  useFilamentEditing,
  type FilamentTool,
} from "@/contexts/FilamentEditingContext";
import {
  useConfig,
  useFilaments,
  useObjects,
  useSaveFilaments,
} from "@/api/hooks";
import { ApiError } from "@/api/client";
import type { InsertMode } from "@/filaments/editing";
import {
  convertToCatmullRom,
  deleteFilament,
  ids,
  kindOf,
  newFilament,
  reverse,
  toSaveRequest,
} from "@/filaments/editSession";
import { instanceColor } from "@/utils/instanceColors";
import { rgbaToCss } from "@/utils/colorUtils";
import { generateSessionId, validateCopickName } from "@/utils/validation";

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export function FilamentEditToolbar() {
  const ed = useFilamentEditing();
  const [saveOpen, setSaveOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const { editing, edit } = ed;
  if (!editing) return null;

  const all = ids(edit);
  const active = edit.activeId;
  const exists = all.includes(active);
  const step = (delta: number) => {
    if (!all.length) return;
    const i = all.indexOf(active);
    const next = all[(i + delta + all.length) % all.length] ?? all[0];
    ed.setActive(next);
  };
  const isBspline = kindOf(edit, active) === "bspline";
  const nFilaments = edit.filaments.size;

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        p: 1,
        borderBottom: 1,
        borderColor: "divider",
        backgroundColor: "background.paper",
        flexWrap: "wrap",
      }}
    >
      <Chip
        label={`Filaments: ${editing.objectName} (${editing.userId}/${editing.sessionId})`}
        size="small"
        sx={{
          backgroundColor: rgbaToCss(editing.color, 0.2),
          fontWeight: "bold",
        }}
      />

      <ToggleButtonGroup
        value={ed.tool}
        exclusive
        size="small"
        onChange={(_, tool: FilamentTool | null) => tool && ed.setTool(tool)}
      >
        <Tooltip title="View (pan / zoom)">
          <ToggleButton value="view" aria-label="View">
            <ViewIcon fontSize="small" />
          </ToggleButton>
        </Tooltip>
        <Tooltip title="Trace: click to add control points, drag a handle to move it, shift-click a handle to remove it">
          <ToggleButton value="trace" aria-label="Trace">
            <TraceIcon fontSize="small" />
          </ToggleButton>
        </Tooltip>
        <Tooltip title="Cut: click a filament to split it in two there">
          <ToggleButton value="cut" aria-label="Cut">
            <CutIcon fontSize="small" />
          </ToggleButton>
        </Tooltip>
      </ToggleButtonGroup>

      <Box sx={{ display: "flex", alignItems: "center" }}>
        <IconButton
          size="small"
          aria-label="Previous filament"
          onClick={() => step(-1)}
          disabled={all.length < 2}
        >
          <ChevronLeft fontSize="small" />
        </IconButton>
        <Chip
          size="small"
          label={`#${active}${exists ? "" : " (new)"}`}
          sx={{
            borderLeft: `6px solid ${rgbaToCss(instanceColor(active, editing.color))}`,
            minWidth: 64,
          }}
          aria-label="Active filament"
        />
        <IconButton
          size="small"
          aria-label="Next filament"
          onClick={() => step(1)}
          disabled={all.length < 2}
        >
          <ChevronRight fontSize="small" />
        </IconButton>
        <Tooltip title="New filament">
          <IconButton
            size="small"
            aria-label="New filament"
            onClick={() => ed.apply("New filament", (s) => newFilament(s))}
          >
            <NewFilamentIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Reverse the active filament">
          <span>
            <IconButton
              size="small"
              aria-label="Reverse filament"
              disabled={!exists}
              onClick={() =>
                ed.apply("Reverse filament", (s) => reverse(s, active))
              }
            >
              <ReverseIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Delete the active filament">
          <span>
            <IconButton
              size="small"
              aria-label="Delete filament"
              disabled={!exists}
              onClick={() =>
                ed.apply("Delete filament", (s) => deleteFilament(s, active))
              }
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        {isBspline && (
          <Tooltip title="This filament is a B-spline fit: its control points can be moved but not added or removed. Convert it to an editable Catmull-Rom curve.">
            <Button
              size="small"
              onClick={() =>
                ed.apply("Convert filament to Catmull-Rom", (s) =>
                  convertToCatmullRom(s, active),
                )
              }
            >
              → Catmull-Rom
            </Button>
          </Tooltip>
        )}
      </Box>

      <TextField
        select
        size="small"
        label="Insert"
        value={ed.insertMode}
        onChange={(e) => ed.setInsertMode(e.target.value as InsertMode)}
        sx={{ width: 120 }}
        SelectProps={{
          title:
            "Where a new control point goes: after the last, before the first, or into the nearest segment",
        }}
      >
        <MenuItem value="append">append</MenuItem>
        <MenuItem value="prepend">prepend</MenuItem>
        <MenuItem value="nearest">nearest</MenuItem>
      </TextField>

      <Box>
        <Tooltip
          title={
            ed.undoLabel
              ? `Undo ${ed.undoLabel.toLowerCase()} (${MOD}Z)`
              : "Nothing to undo"
          }
        >
          <span>
            <IconButton
              size="small"
              aria-label="Undo"
              onClick={ed.undo}
              disabled={!ed.canUndo}
            >
              <UndoIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip
          title={
            ed.redoLabel
              ? `Redo ${ed.redoLabel.toLowerCase()} (${MOD}⇧Z)`
              : "Nothing to redo"
          }
        >
          <span>
            <IconButton
              size="small"
              aria-label="Redo"
              onClick={ed.redo}
              disabled={!ed.canRedo}
            >
              <RedoIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Chip label={`${nFilaments} filaments`} size="small" variant="outlined" />
      {ed.message && (
        <Alert
          severity="warning"
          onClose={() => ed.setMessage(null)}
          sx={{ py: 0 }}
        >
          {ed.message}
        </Alert>
      )}

      <Box sx={{ flexGrow: 1 }} />
      {ed.dirty && (
        <Chip label="Unsaved changes" size="small" color="warning" />
      )}
      <Button
        startIcon={<SaveIcon />}
        variant="contained"
        size="small"
        onClick={() => setSaveOpen(true)}
        disabled={!ed.dirty}
      >
        Save
      </Button>
      <Button
        startIcon={<CloseIcon />}
        size="small"
        onClick={() => (ed.dirty ? setConfirmClose(true) : ed.stop())}
      >
        Close
      </Button>

      <SaveFilamentsDialog open={saveOpen} onClose={() => setSaveOpen(false)} />
      <Dialog open={confirmClose} onClose={() => setConfirmClose(false)}>
        <DialogContent>
          <DialogContentText>
            Discard the unsaved filament edits?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClose(false)}>Keep editing</Button>
          <Button
            color="error"
            onClick={() => {
              setConfirmClose(false);
              ed.stop();
            }}
          >
            Discard
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function SaveFilamentsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const ed = useFilamentEditing();
  const { addFilaments } = useCopick();
  const { data: config } = useConfig();
  const { data: objects } = useObjects();
  const { data: sets } = useFilaments(ed.editing?.runName ?? null);
  const save = useSaveFilaments();
  const editing = ed.editing;
  const object = objects?.find((o) => o.name === editing?.objectName);
  const toolOutput = editing?.sessionId === "0";
  const usedSessions = (sets ?? [])
    .filter((s) => s.object_name === editing?.objectName)
    .map((s) => s.session_id);
  const [userId, setUserId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [writePicks, setWritePicks] = useState(false);
  const [spacing, setSpacing] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Defaults when the dialog opens: the set's own identity, or a new session for tool output.
  useEffect(() => {
    if (!open || !editing) return;
    setUserId(toolOutput ? config?.user_id || "user" : editing.userId);
    setSessionId(
      toolOutput ? generateSessionId(usedSessions) : editing.sessionId,
    );
    setSpacing(String(object?.radius ?? 100));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!editing) return null;

  const userCheck = validateCopickName(userId);
  const sessionCheck = validateCopickName(sessionId);
  const spacingValue = Number(spacing);
  const spacingOk =
    !writePicks || (Number.isFinite(spacingValue) && spacingValue > 0);
  const valid =
    userCheck.isValid && sessionCheck.isValid && sessionId !== "0" && spacingOk;

  const submit = () => {
    if (!valid) return;
    const key = {
      runName: editing.runName,
      objectName: editing.objectName,
      userId,
      sessionId,
    };
    save.mutate(
      {
        key,
        data: {
          filaments: toSaveRequest(ed.edit),
          voxel_spacing: ed.ctx.step,
          pick_spacing: writePicks ? spacingValue : null,
        },
      },
      {
        onSuccess: () => {
          ed.markSaved({ ...editing, userId, sessionId, isNew: false });
          addFilaments({ objectName: editing.objectName, userId, sessionId });
          ed.setMessage(null);
          onClose();
        },
        onError: (e) => setError(e instanceof ApiError ? e.detail : String(e)),
      },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Save filaments</DialogTitle>
      <DialogContent
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          pt: "8px !important",
        }}
      >
        {toolOutput && (
          <Alert severity="info">
            Tool output (session 0) is read-only: save the edits under your own
            session.
          </Alert>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          size="small"
          label="User"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          error={!userCheck.isValid}
          helperText={userCheck.isValid ? " " : userCheck.errorMessage}
        />
        <TextField
          size="small"
          label="Session"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          error={!sessionCheck.isValid || sessionId === "0"}
          helperText={
            sessionId === "0"
              ? "Session 0 is reserved for tool output"
              : sessionCheck.isValid
                ? " "
                : sessionCheck.errorMessage
          }
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={writePicks}
              onChange={(e) => setWritePicks(e.target.checked)}
            />
          }
          label="Also write picks sampled along the filaments"
        />
        {writePicks && (
          <>
            <TextField
              size="small"
              label="Pick spacing (Å)"
              type="number"
              value={spacing}
              onChange={(e) => setSpacing(e.target.value)}
              error={!spacingOk}
              helperText={
                spacingOk ? "Default: the object's radius" : "A positive number"
              }
            />
            <Alert severity="warning">
              The sampled picks replace all picks of {editing.objectName} (
              {userId}/{sessionId}).
            </Alert>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={!valid || save.isPending}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

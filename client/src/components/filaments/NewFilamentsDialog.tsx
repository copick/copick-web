/**
 * Start tracing a new filament set: object (filament objects first), user and
 * session. Nothing is written until the set is saved.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
} from "@mui/material";
import { useConfig, useFilaments, useObjects } from "@/api/hooks";
import { generateSessionId, validateCopickName } from "@/utils/validation";
import { rgbaToHex } from "@/utils/colorUtils";
import type { FilamentSetIdentity } from "./useStartFilamentEditing";

interface Props {
  open: boolean;
  runName: string;
  onClose: () => void;
  onCreate: (set: FilamentSetIdentity) => void;
}

export function NewFilamentsDialog({
  open,
  runName,
  onClose,
  onCreate,
}: Props) {
  const { data: config } = useConfig();
  const { data: objects } = useObjects();
  const { data: sets } = useFilaments(runName);
  const [objectName, setObjectName] = useState("");
  const [userId, setUserId] = useState("");
  const [sessionId, setSessionId] = useState("");

  // Filament objects first; other particles can be traced too (the desktop viewers warn the same way).
  const choices = useMemo(() => {
    const particles = (objects ?? []).filter((o) => o.is_particle);
    return [
      ...particles.filter((o) => o.is_filament),
      ...particles.filter((o) => !o.is_filament),
    ];
  }, [objects]);

  useEffect(() => {
    if (!open) return;
    const first = choices[0]?.name ?? "";
    setObjectName(first);
    setUserId(config?.user_id || "user");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const used = (sets ?? [])
      .filter((s) => s.object_name === objectName)
      .map((s) => s.session_id);
    setSessionId(generateSessionId(used));
  }, [open, objectName, sets]);

  const object = choices.find((o) => o.name === objectName);
  const userCheck = validateCopickName(userId);
  const sessionCheck = validateCopickName(sessionId);
  const exists = (sets ?? []).some(
    (s) =>
      s.object_name === objectName &&
      s.user_id === userId &&
      s.session_id === sessionId,
  );
  const valid =
    !!object &&
    userCheck.isValid &&
    sessionCheck.isValid &&
    sessionId !== "0" &&
    !exists;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>New filament set</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          <TextField
            select
            size="small"
            label="Object"
            value={objectName}
            onChange={(e) => setObjectName(e.target.value)}
          >
            {choices.map((o) => (
              <MenuItem key={o.name} value={o.name}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      bgcolor: rgbaToHex(o.color),
                    }}
                  />
                  {o.name}
                  {!o.is_filament && (
                    <Box component="span" sx={{ color: "text.secondary" }}>
                      (not a filament)
                    </Box>
                  )}
                </Box>
              </MenuItem>
            ))}
          </TextField>
          {object && !object.is_filament && (
            <Alert severity="info">
              {object.name} is not declared a filament. You can declare it in
              the object types (the shapes button next to the project name).
            </Alert>
          )}
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
            error={!sessionCheck.isValid || sessionId === "0" || exists}
            helperText={
              exists
                ? "This filament set exists already: edit it from the table"
                : sessionId === "0"
                  ? "Session 0 is reserved for tool output"
                  : sessionCheck.isValid
                    ? " "
                    : sessionCheck.errorMessage
            }
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!valid}
          onClick={() => {
            onCreate({ objectName, userId, sessionId });
            onClose();
          }}
        >
          Start tracing
        </Button>
      </DialogActions>
    </Dialog>
  );
}

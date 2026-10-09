/**
 * Dialog for creating a new picks collection.
 * Inspired by chimerax-copick's NewPickDialog.py
 */

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
} from "@mui/material";
import { useConfig, useObjects, usePicks } from "@/api/hooks";
import { validateCopickName, generateSessionId } from "@/utils/validation";
import { rgbaToHex } from "@/utils/colorUtils";

interface NewPickDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (objectName: string, userId: string, sessionId: string) => void;
  runName: string;
}

export function NewPickDialog({
  open,
  onClose,
  onSubmit,
  runName,
}: NewPickDialogProps) {
  const { data: config } = useConfig();
  const { data: objects } = useObjects();
  const { data: existingPicks } = usePicks(runName);

  // Form state
  const [objectName, setObjectName] = useState("");
  const [userId, setUserId] = useState("");
  const [sessionId, setSessionId] = useState("");

  // Initialize defaults when dialog opens
  useEffect(() => {
    if (open) {
      // Default user ID from config
      setUserId(config?.user_id || "user");

      // Auto-generate session ID
      const existingSessionIds = existingPicks?.map((p) => p.session_id) || [];
      setSessionId(generateSessionId(existingSessionIds));

      // Select first object by default
      if (objects && objects.length > 0) {
        setObjectName(objects[0].name);
      }
    }
  }, [open, config, existingPicks, objects]);

  // Validation
  const userValidation = validateCopickName(userId);
  const sessionValidation = validateCopickName(sessionId);

  const isValid =
    objectName && userValidation.isValid && sessionValidation.isValid;

  const handleSubmit = () => {
    if (isValid) {
      onSubmit(objectName, userId, sessionId);
      handleClose();
    }
  };

  const handleClose = () => {
    setObjectName("");
    setUserId("");
    setSessionId("");
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create New Pick</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Create a new set of picks with the specified parameters.
          </Typography>

          {/* Object selector */}
          <FormControl fullWidth>
            <InputLabel>Object</InputLabel>
            <Select
              value={objectName}
              onChange={(e) => setObjectName(e.target.value)}
              label="Object"
            >
              {objects?.map((obj) => (
                <MenuItem
                  key={obj.name}
                  value={obj.name}
                  sx={{ backgroundColor: `${rgbaToHex(obj.color)}20` }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Box
                      sx={{
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        backgroundColor: rgbaToHex(obj.color),
                        flexShrink: 0,
                      }}
                    />
                    {obj.name}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* User ID */}
          <TextField
            label="User ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            error={!userValidation.isValid && userId.length > 0}
            helperText={
              !userValidation.isValid && userId.length > 0
                ? userValidation.errorMessage
                : ""
            }
            fullWidth
          />

          {/* Session ID */}
          <TextField
            label="Session ID"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            error={!sessionValidation.isValid && sessionId.length > 0}
            helperText={
              !sessionValidation.isValid && sessionId.length > 0
                ? sessionValidation.errorMessage
                : "Auto-generated session identifier"
            }
            fullWidth
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={!isValid}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

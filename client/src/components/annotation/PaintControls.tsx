/** Navigate/Paint/Erase, class, brush radius, Undo and the latest message, for any painting. */

import { useEffect, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Select,
  Slider,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import type { PaintClass } from "@/api/annotations";
import type { Mode, usePainting } from "./usePainting";

interface Props {
  tools: ReturnType<typeof usePainting>;
  classes: PaintClass[];
  geometryOk: boolean;
  problem?: string | null;
  /** Extra edit-blocking state (e.g. a pending training). */
  busy?: boolean;
  children?: ReactNode;
}

export function PaintControls({
  tools,
  classes,
  geometryOk,
  problem,
  busy = false,
  children,
}: Props) {
  const { mode, setMode, label, setLabel, radius, setRadius } = tools;
  useEffect(() => {
    if (label == null || !classes.some((c) => c.id === label))
      setLabel(classes[0]?.id ?? null);
  }, [classes, label, setLabel]);
  return (
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          flexWrap: "wrap",
        }}
      >
        {children}
        {problem && (
          <Alert severity="warning" sx={{ py: 0 }}>
            {problem}
          </Alert>
        )}
        <ToggleButtonGroup
          size="small"
          exclusive
          value={mode === "include" || mode === "exclude" ? "off" : mode}
          onChange={(_, v: Mode | null) => v && setMode(v)}
          disabled={!geometryOk}
        >
          <ToggleButton value="off" aria-label="Navigate">
            Navigate
          </ToggleButton>
          <ToggleButton value="paint" aria-label="Paint">
            Paint
          </ToggleButton>
          <ToggleButton value="erase" aria-label="Erase to unannotated">
            Erase
          </ToggleButton>
        </ToggleButtonGroup>
        <Select
          size="small"
          value={label ?? ""}
          onChange={(e) => setLabel(Number(e.target.value))}
          disabled={mode === "erase"}
          inputProps={{ "aria-label": "Class" }}
        >
          {classes.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.id} · {c.name}
            </MenuItem>
          ))}
        </Select>
        <Box sx={{ width: 120, display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="caption">r={radius}</Typography>
          <Slider
            size="small"
            min={0}
            max={16}
            value={radius}
            onChange={(_, v) => setRadius(v as number)}
            aria-label="Brush radius (voxels)"
          />
        </Box>
        <Button
          size="small"
          variant="outlined"
          disabled={!geometryOk || busy || tools.saving || !tools.canUndo}
          title="Undo the last saved stroke or acceptance (Ctrl/Cmd+Z). Up to 20, including erase."
          onClick={() => void tools.undo()}
        >
          Undo
        </Button>
        {tools.saving && <Typography variant="caption">Saving…</Typography>}
      </Box>
      {tools.message && (
        <Alert
          severity={tools.message.severity}
          onClose={() => tools.setMessage(null)}
          sx={{ py: 0 }}
        >
          {tools.message.text}
        </Alert>
      )}
    </>
  );
}

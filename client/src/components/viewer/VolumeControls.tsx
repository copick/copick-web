/** Controls of the 3D volume view: threshold, opacity and detail level. */

import {
  Box,
  MenuItem,
  Paper,
  Select,
  Slider,
  Typography,
} from "@mui/material";
import type { VolumeSettings } from "./useVolumeView";

interface VolumeControlsProps {
  settings: VolumeSettings;
  maxLod: number;
  onChange: (settings: VolumeSettings) => void;
}

export function VolumeControls({
  settings,
  maxLod,
  onChange,
}: VolumeControlsProps) {
  const lod = settings.lod ?? maxLod;
  return (
    <Paper
      elevation={3}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 1.5,
        py: 0.5,
        bgcolor: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(4px)",
      }}
      aria-label="3D volume controls"
    >
      <Typography variant="caption" sx={{ color: "common.white" }}>
        3D
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          Threshold
        </Typography>
        <Slider
          size="small"
          sx={{ width: 80, color: "white" }}
          min={0}
          max={0.99}
          step={0.01}
          value={settings.threshold}
          onChange={(_, v) => onChange({ ...settings, threshold: v as number })}
          aria-label="3D density threshold"
        />
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          Opacity
        </Typography>
        <Slider
          size="small"
          sx={{ width: 80, color: "white" }}
          min={0.001}
          max={0.3}
          step={0.001}
          value={settings.opacity}
          onChange={(_, v) => onChange({ ...settings, opacity: v as number })}
          aria-label="3D opacity"
        />
      </Box>
      <Select
        size="small"
        variant="standard"
        value={lod}
        onChange={(e) => onChange({ ...settings, lod: Number(e.target.value) })}
        sx={{ color: "common.white", fontSize: 12 }}
        aria-label="3D detail"
      >
        {Array.from({ length: maxLod + 1 }, (_, i) => (
          <MenuItem key={i} value={i} sx={{ fontSize: 12 }}>
            Level {i}
            {i === maxLod ? " · coarsest" : ""}
            {i === 0 ? " · finest" : ""}
          </MenuItem>
        ))}
      </Select>
    </Paper>
  );
}

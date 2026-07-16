import { Box, IconButton, Paper, Slider } from "@mui/material";
import { RestartAlt } from "@mui/icons-material";

interface ChannelControlsProps {
  color: string;
  contrastLimits: [number, number];
  contrastRange: [number, number];
  onColorChange: (color: string) => void;
  onContrastChange: (limits: [number, number]) => void;
  onResetContrast: () => void;
}

const formatValue = (v: number) =>
  Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.01) ? v.toExponential(1) : v.toFixed(2);

export function ChannelControls({
  color,
  contrastLimits,
  contrastRange,
  onColorChange,
  onContrastChange,
  onResetContrast,
}: ChannelControlsProps) {
  const [min, max] = contrastRange;

  return (
    <Paper
      elevation={3}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1.5,
        py: 0.5,
        bgcolor: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(4px)",
      }}
    >
      <Box
        component="input"
        type="color"
        value={color}
        onChange={(e) => onColorChange(e.target.value)}
        sx={{ width: 24, height: 24, p: 0, border: 0, bgcolor: "transparent", cursor: "pointer" }}
      />
      <Slider
        size="small"
        sx={{ width: 160, color: "white" }}
        value={contrastLimits}
        min={min}
        max={max}
        step={(max - min) / 512 || 1}
        valueLabelDisplay="auto"
        valueLabelFormat={formatValue}
        onChange={(_, value) => {
          const [lo, hi] = value as number[];
          if (lo < hi) onContrastChange([lo, hi]);
        }}
      />
      <IconButton size="small" onClick={onResetContrast} title="Reset contrast" sx={{ color: "white" }}>
        <RestartAlt fontSize="small" />
      </IconButton>
    </Paper>
  );
}

/**
 * Viewer controls: axis selector and slice slider.
 *
 * Z-index is passed via props (not context) to ensure direct state flow
 * and avoid race conditions. Axis selection still uses context.
 */

import { Box, Slider, Typography, ToggleButtonGroup, ToggleButton } from "@mui/material";
import { useViewer, type ViewAxis } from "@/contexts/ViewerContext";

interface ViewerControlsProps {
  currentZIndex: number;
  maxZIndex: number | undefined;
  onZIndexChange: (newZIndex: number) => void;
}

export function ViewerControls({ currentZIndex, maxZIndex, onZIndexChange }: ViewerControlsProps) {
  // Axis selection still uses context (independent of z-index issues)
  const { state, setAxis } = useViewer();

  const handleAxisChange = (_: React.MouseEvent<HTMLElement>, newAxis: ViewAxis | null) => {
    if (newAxis) {
      setAxis(newAxis);
    }
  };

  const handleSliceChange = (_: Event, value: number | number[]) => {
    // Use prop callback directly - no context involved
    onZIndexChange(value as number);
  };

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
      }}
    >
      {/* Axis selector - uses context */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="body2" color="text.secondary">
          View:
        </Typography>
        <ToggleButtonGroup value={state.axis} exclusive onChange={handleAxisChange} size="small">
          <ToggleButton value="xy">XY</ToggleButton>
          <ToggleButton value="xz" disabled title="Coming soon">
            XZ
          </ToggleButton>
          <ToggleButton value="yz" disabled title="Coming soon">
            YZ
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Slice slider - uses props (not context) */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexGrow: 1, minWidth: 200 }}>
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
          Z: {currentZIndex}
        </Typography>
        <Slider
          value={currentZIndex}
          onChange={handleSliceChange}
          min={0}
          max={maxZIndex ?? 0}
          disabled={maxZIndex === undefined}
          size="small"
          sx={{ flexGrow: 1 }}
        />
        <Typography variant="body2" color="text.secondary">
          / {maxZIndex ?? "?"}
        </Typography>
      </Box>
    </Box>
  );
}

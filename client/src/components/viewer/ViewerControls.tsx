/**
 * Viewer controls: axis selector and slice slider.
 *
 * Slice index is passed via props (not context) to ensure direct state flow
 * and avoid race conditions. Axis selection still uses context.
 */

import {
  Box,
  Slider,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
} from "@mui/material";
import { useViewer, type ViewAxis } from "@/contexts/ViewerContext";

const SLICE_AXIS_LABEL: Record<ViewAxis, string> = {
  xy: "Z",
  xz: "Y",
  yz: "X",
};

interface ViewerControlsProps {
  sliceIndex: number;
  maxSliceIndex: number | undefined;
  onSliceIndexChange: (newIndex: number) => void;
}

export function ViewerControls({
  sliceIndex,
  maxSliceIndex,
  onSliceIndexChange,
}: ViewerControlsProps) {
  // Axis selection still uses context (independent of slice-index issues)
  const { state, setAxis } = useViewer();

  const handleAxisChange = (
    _: React.MouseEvent<HTMLElement>,
    newAxis: ViewAxis | null,
  ) => {
    if (newAxis) {
      setAxis(newAxis);
    }
  };

  const handleSliceChange = (_: Event, value: number | number[]) => {
    // Use prop callback directly - no context involved
    onSliceIndexChange(value as number);
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
        <ToggleButtonGroup
          value={state.axis}
          exclusive
          onChange={handleAxisChange}
          size="small"
        >
          <ToggleButton value="xy">XY</ToggleButton>
          <ToggleButton value="xz">XZ</ToggleButton>
          <ToggleButton value="yz">YZ</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Slice slider - uses props (not context) */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexGrow: 1,
          minWidth: 200,
        }}
      >
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ whiteSpace: "nowrap" }}
        >
          {SLICE_AXIS_LABEL[state.axis]}: {sliceIndex}
        </Typography>
        <Slider
          value={sliceIndex}
          onChange={handleSliceChange}
          min={0}
          max={maxSliceIndex ?? 0}
          disabled={maxSliceIndex === undefined}
          size="small"
          sx={{ flexGrow: 1 }}
        />
        <Typography variant="body2" color="text.secondary">
          / {maxSliceIndex ?? "?"}
        </Typography>
      </Box>
    </Box>
  );
}

/**
 * Viewer controls: Single / Multi layout, the single-plane axis (as before),
 * which panes the multi layout shows, the pick marker style, and slice sliders
 * (one in single-plane mode, X/Y/Z in multi mode).
 */

import {
  Button,
  Box,
  Checkbox,
  FormControlLabel,
  IconButton,
  Slider,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  CenterFocusStrong,
  GridView as GalleryIcon,
} from "@mui/icons-material";
import { useNavigation } from "@/contexts/NavigationContext";
import {
  useLayout,
  type LayoutMode,
  type ViewAxis,
} from "@/contexts/LayoutContext";
import { useScene } from "@/contexts/SceneContext";
import { useSlice } from "@/contexts/SliceContext";
import { AXES, VIEW_IDS, indexToWorld } from "@/idetik/coordinates";
import type { MarkerStyle } from "@/idetik/PickMarkersLayer";

/** Slice axis (XYZ index) of each single-plane axis. */
const SLICE_AXIS: Record<ViewAxis, number> = { xy: 2, xz: 1, yz: 0 };

interface ViewerControlsProps {
  onResetViews: () => void;
}

export function ViewerControls({ onResetViews }: ViewerControlsProps) {
  const layout = useLayout();
  const { scene } = useScene();
  const { indices, setIndex } = useSlice();
  const { showGallery } = useNavigation();
  const geometry = scene?.geometry ?? null;
  const sliderAxes =
    layout.mode === "single" ? [SLICE_AXIS[layout.axis]] : [0, 1, 2];

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        columnGap: 2,
        rowGap: 0.5,
        px: 1,
        py: 0.5,
        borderBottom: 1,
        borderColor: "divider",
        backgroundColor: "background.paper",
      }}
    >
      <Tooltip title="Back to the run gallery">
        <Button
          size="small"
          startIcon={<GalleryIcon fontSize="small" />}
          onClick={showGallery}
        >
          Gallery
        </Button>
      </Tooltip>
      <ToggleButtonGroup
        value={layout.mode}
        exclusive
        size="small"
        onChange={(_, mode: LayoutMode | null) => mode && layout.setMode(mode)}
        aria-label="Layout"
      >
        <ToggleButton value="single">Single</ToggleButton>
        <ToggleButton value="multi">Multi</ToggleButton>
      </ToggleButtonGroup>

      {layout.mode === "single" ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            View:
          </Typography>
          <ToggleButtonGroup
            value={layout.axis}
            exclusive
            size="small"
            onChange={(_, axis: ViewAxis | null) =>
              axis && layout.setAxis(axis)
            }
            aria-label="Slice orientation"
          >
            <ToggleButton value="xy">XY</ToggleButton>
            <ToggleButton value="xz">XZ</ToggleButton>
            <ToggleButton value="yz">YZ</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      ) : (
        <Box
          sx={{ display: "flex", alignItems: "center" }}
          aria-label="Visible views"
        >
          <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
            Show:
          </Typography>
          {VIEW_IDS.map((view, i) => (
            <FormControlLabel
              key={view}
              sx={{ mr: 1 }}
              control={
                <Checkbox
                  size="small"
                  checked={layout.multiVisible[i]}
                  disabled={
                    layout.multiVisible[i] &&
                    layout.multiVisible.filter(Boolean).length === 1
                  }
                  onChange={() => layout.togglePane(i)}
                  inputProps={{ "aria-label": `Show ${view} view` }}
                />
              }
              label={<Typography variant="body2">{view}</Typography>}
            />
          ))}
        </Box>
      )}

      <ToggleButtonGroup
        value={layout.markerStyle}
        exclusive
        size="small"
        onChange={(_, style: MarkerStyle | null) =>
          style && layout.setMarkerStyle(style)
        }
        aria-label="Pick markers"
      >
        <Tooltip title="Picks as dots that fade with distance">
          <ToggleButton value="dots">Dots</ToggleButton>
        </Tooltip>
        <Tooltip title="Picks as the cross-section of the object's radius">
          <ToggleButton value="shells">Shells</ToggleButton>
        </Tooltip>
      </ToggleButtonGroup>

      <Tooltip title="Reset views">
        <IconButton
          size="small"
          onClick={onResetViews}
          aria-label="Reset views"
        >
          <CenterFocusStrong fontSize="small" />
        </IconButton>
      </Tooltip>

      <Box sx={{ display: "flex", flexGrow: 1, gap: 2, minWidth: 220 }}>
        {sliderAxes.map((axis) => {
          const g = geometry?.axes[axis];
          const max = g ? g.size - 1 : 0;
          const world = g
            ? indexToWorld(indices[axis], g) * (geometry?.angstromPerUnit ?? 1)
            : null;
          return (
            <Box
              key={axis}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                flex: 1,
                minWidth: 140,
              }}
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  whiteSpace: "nowrap",
                  fontVariantNumeric: "tabular-nums",
                }}
                title={world !== null ? `${world.toFixed(1)} Å` : undefined}
              >
                {AXES[axis].toUpperCase()}: {g ? indices[axis] : "?"} /{" "}
                {g ? max : "?"}
              </Typography>
              <Slider
                size="small"
                value={indices[axis]}
                min={0}
                max={max}
                disabled={!g}
                onChange={(_, value) => setIndex(axis, value as number)}
                aria-label={`${AXES[axis].toUpperCase()} slice`}
                sx={{ flexGrow: 1 }}
              />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

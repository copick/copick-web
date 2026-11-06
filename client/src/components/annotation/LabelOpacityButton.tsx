/** "Opacity" toolbar button: per-class display opacity of painted and proposed labels (display only). */

import { useState } from "react";
import { Box, Button, Popover, Slider, Typography } from "@mui/material";
import { Opacity as OpacityIcon } from "@mui/icons-material";
import { useProjectId } from "@/contexts/CopickContext";
import {
  defaultLabelOpacity,
  labelOpacity,
  MESH_MIN_OPACITY,
  useLabelOpacities,
} from "@/utils/labelOpacity";

interface LabelClass {
  id: number;
  name: string;
  color?: readonly number[] | null;
}

const percent = (v: number) => `${Math.round(v * 100)}%`;

export function LabelOpacityButton({ classes }: { classes: LabelClass[] }) {
  const projectId = useProjectId();
  const { saved, setOpacity, reset } = useLabelOpacities(projectId);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<OpacityIcon fontSize="small" />}
        onClick={(e) => setAnchor(e.currentTarget)}
        title="Display opacity of each class; background is fainter by default. Annotations are not changed."
        aria-haspopup="dialog"
      >
        Opacity
      </Button>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{
          paper: {
            role: "dialog",
            "aria-label": "Label opacity",
            sx: { p: 1.5, width: 300 },
          },
        }}
      >
        <Typography variant="subtitle2">Label opacity</Typography>
        <Typography
          variant="caption"
          sx={{ color: "text.secondary", display: "block", mb: 1 }}
        >
          Display only, saved in this browser for this project. Unannotated
          voxels are always transparent. 3D meshes are opaque, so classes below{" "}
          {percent(MESH_MIN_OPACITY)} are left out of them.
        </Typography>
        {classes.map((c) => {
          const value = labelOpacity(saved, c.id, c.name);
          const [r, g, b] = c.color ?? [128, 128, 128];
          return (
            <Box
              key={c.id}
              sx={{ display: "flex", alignItems: "center", gap: 1 }}
            >
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  flexShrink: 0,
                  borderRadius: 0.5,
                  bgcolor: `rgb(${r},${g},${b})`,
                  border: 1,
                  borderColor: "divider",
                }}
              />
              <Typography variant="body2" sx={{ width: 110 }} noWrap>
                {c.id} · {c.name}
              </Typography>
              <Slider
                size="small"
                min={0}
                max={1}
                step={0.05}
                value={value}
                onChange={(_, v) => setOpacity(c.id, v as number)}
                aria-label={`${c.name} opacity`}
                getAriaValueText={percent}
                sx={{ flex: 1 }}
              />
              <Typography
                variant="caption"
                sx={{ width: 34, textAlign: "right" }}
                data-testid={`opacity-value-${c.id}`}
              >
                {percent(value)}
              </Typography>
            </Box>
          );
        })}
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            mt: 1,
          }}
        >
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            Defaults: background {percent(defaultLabelOpacity("background"))},
            others {percent(defaultLabelOpacity(null))}
          </Typography>
          <Button size="small" onClick={reset}>
            Reset
          </Button>
        </Box>
      </Popover>
    </>
  );
}

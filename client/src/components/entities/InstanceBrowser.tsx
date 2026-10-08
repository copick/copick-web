/**
 * Instances of an instance or panoptic segmentation, measured by the server on
 * a coarse level: colour, ID, voxel count. Clicking an instance moves the
 * crosshair and the 3D orbit to its centroid and outlines it; the eye hides it
 * and the target solos it.
 */

import { useMemo } from "react";
import {
  Box,
  CircularProgress,
  IconButton,
  List,
  ListItemButton,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  FilterCenterFocus,
  Visibility,
  VisibilityOff,
} from "@mui/icons-material";
import { useInstances, useObjects } from "@/api/hooks";
import {
  MAX_HIDDEN_IDS,
  segmentationKey,
  useCopick,
  type SegmentationIdentity,
} from "@/contexts/CopickContext";
import { useViewerBridge } from "@/contexts/SliceContext";
import { instanceColor } from "@/utils/instanceColors";
import { rgbaToCss } from "@/utils/colorUtils";

interface InstanceBrowserProps {
  runName: string;
  identity: SegmentationIdentity;
}

export function InstanceBrowser({ runName, identity }: InstanceBrowserProps) {
  const { data, isLoading, error } = useInstances(runName, identity);
  const { data: objects } = useObjects();
  const { state, addSegmentation, updateSegmentation } = useCopick();
  const bridge = useViewerBridge();
  const key = segmentationKey(identity);
  const selection = state.selectedSegmentations.find(
    (s) => segmentationKey(s) === key,
  );
  const panoptic = identity.segmentationType === "panoptic";

  const objectName = useMemo(() => {
    const names = new Map<number, string>();
    for (const o of objects ?? [])
      if (o.label !== null) names.set(o.label, o.name);
    return (label: number | null) =>
      label === null ? identity.name : (names.get(label) ?? `label ${label}`);
  }, [objects, identity.name]);

  if (isLoading) {
    return (
      <Box sx={{ p: 1, display: "flex", alignItems: "center", gap: 1 }}>
        <CircularProgress size={14} />
        <Typography variant="caption" color="text.secondary">
          Measuring instances…
        </Typography>
      </Box>
    );
  }
  if (error || !data) {
    return (
      <Typography
        variant="caption"
        color="error"
        sx={{ p: 1, display: "block" }}
      >
        Could not measure instances: {String(error ?? "no data")}
      </Typography>
    );
  }
  if (data.instances.length === 0) {
    return (
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ p: 1, display: "block" }}
      >
        No instances.
      </Typography>
    );
  }

  const ensureSelected = () => {
    if (!selection) addSegmentation(identity);
  };
  const hidden = new Set(selection?.hiddenIds ?? []);
  const soloId = selection?.soloId ?? null;

  return (
    <Box sx={{ maxHeight: 220, overflow: "auto" }}>
      <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
        {data.instances.length} {panoptic ? "segments" : "instances"} · level{" "}
        {data.level}
      </Typography>
      <List dense disablePadding>
        {data.instances.map((inst) => {
          const id = inst.instance_id;
          const isThing = id > 0;
          const color = isThing
            ? instanceColor(id, [128, 128, 128, 255])
            : (objects?.find((o) => o.label === inst.label)?.color ?? [
                128, 128, 128, 255,
              ]);
          const label = panoptic
            ? isThing
              ? `${objectName(inst.label)} #${id}`
              : `${objectName(inst.label)} (stuff)`
            : `#${id}`;
          const selected = isThing && selection?.selectedId === id;
          return (
            <ListItemButton
              key={`${inst.label ?? ""}:${id}`}
              selected={selected}
              sx={{ py: 0, pl: 1, pr: 0.5 }}
              onClick={() => {
                ensureSelected();
                updateSegmentation(key, { selectedId: isThing ? id : null });
                bridge.focusAngstrom(inst.centroid, { orbit: true });
              }}
            >
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "2px",
                  bgcolor: rgbaToCss(color as [number, number, number, number]),
                  mr: 1,
                  flexShrink: 0,
                }}
              />
              <Typography variant="body2" sx={{ flexGrow: 1 }} noWrap>
                {label}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mx: 0.5 }}
              >
                {inst.voxel_count.toLocaleString()}
              </Typography>
              {isThing && (
                <>
                  <Tooltip title={hidden.has(id) ? "Show" : "Hide"}>
                    <span>
                      <IconButton
                        size="small"
                        disabled={
                          !hidden.has(id) && hidden.size >= MAX_HIDDEN_IDS
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          ensureSelected();
                          const next = hidden.has(id)
                            ? [...hidden].filter((h) => h !== id)
                            : [...hidden, id];
                          updateSegmentation(key, { hiddenIds: next });
                        }}
                      >
                        {hidden.has(id) ? (
                          <VisibilityOff sx={{ fontSize: 14 }} />
                        ) : (
                          <Visibility sx={{ fontSize: 14 }} />
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip
                    title={soloId === id ? "Show all" : "Show only this"}
                  >
                    <IconButton
                      size="small"
                      color={soloId === id ? "primary" : "default"}
                      onClick={(e) => {
                        e.stopPropagation();
                        ensureSelected();
                        updateSegmentation(key, {
                          soloId: soloId === id ? null : id,
                        });
                      }}
                    >
                      <FilterCenterFocus sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                </>
              )}
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}

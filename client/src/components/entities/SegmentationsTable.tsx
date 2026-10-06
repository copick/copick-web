/**
 * Table of segmentations with visibility toggles, type chips and a type
 * filter. Instance and panoptic rows expand into an instance browser;
 * panoptic rows choose objects / instances / both.
 */

import { Fragment, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Box,
  Chip,
  Typography,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from "@mui/material";
import {
  ExpandLess,
  ExpandMore,
  Visibility,
  VisibilityOff,
  WarningAmber,
} from "@mui/icons-material";
import { useSegmentations } from "@/api/hooks";
import {
  SEGMENTATION_TYPES,
  segmentationTypeOf,
  type SegmentationSummaryResponse,
  type SegmentationType,
} from "@/api/types";
import {
  segmentationKey,
  useCopick,
  type PanopticMode,
  type SegmentationIdentity,
} from "@/contexts/CopickContext";
import { rowDoubleClick, toggleRowSx } from "@/utils/rowToggle";
import { matchesSearch } from "@/utils/tableSearch";
import { TableSearch } from "./TableSearch";
import { EntityNameCell } from "./EntityNameCell";
import { COL, entityTableSx, swatchSx } from "./entityTableStyles";
import { useLayerStatus } from "@/contexts/LayerStatusContext";
import { rgbaToHex } from "@/utils/colorUtils";
import { InstanceBrowser } from "./InstanceBrowser";

interface SegmentationsTableProps {
  runName: string;
  /** Search text (see TableSearch). */
  search: string;
  onSearchChange: (value: string) => void;
}

const TYPE_LABEL: Record<SegmentationType, string> = {
  binary: "binary",
  multilabel: "multi",
  instance: "inst",
  panoptic: "pan",
};

const TYPE_COLOR: Record<
  SegmentationType,
  "default" | "primary" | "secondary" | "info"
> = {
  binary: "default",
  multilabel: "info",
  instance: "primary",
  panoptic: "secondary",
};

function identityOf(seg: SegmentationSummaryResponse): SegmentationIdentity {
  return {
    name: seg.name,
    userId: seg.user_id,
    sessionId: seg.session_id,
    voxelSize: seg.voxel_size,
    segmentationType: segmentationTypeOf(seg),
  };
}

export function SegmentationsTable({
  runName,
  search,
  onSearchChange,
}: SegmentationsTableProps) {
  const { data: segmentations, isLoading, error } = useSegmentations(runName);
  const {
    state,
    toggleSegmentationVisibility,
    addSegmentation,
    updateSegmentation,
  } = useCopick();
  const { statuses } = useLayerStatus();
  const [filter, setFilter] = useState<SegmentationType[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Box sx={{ p: 2, display: "flex", justifyContent: "center" }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (error) {
    return (
      <Typography color="error" sx={{ p: 2 }}>
        Failed to load segmentations
      </Typography>
    );
  }

  if (!segmentations || segmentations.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ p: 2 }}>
        No segmentations found
      </Typography>
    );
  }

  const present = SEGMENTATION_TYPES.filter((t) =>
    segmentations.some((s) => segmentationTypeOf(s) === t),
  );
  const shown = segmentations.filter(
    (s) =>
      (filter.length === 0 || filter.includes(segmentationTypeOf(s))) &&
      matchesSearch(search, [
        s.name,
        s.user_id,
        s.session_id,
        TYPE_LABEL[segmentationTypeOf(s)],
        s.voxel_size.toFixed(2),
      ]),
  );

  const selectionOf = (seg: SegmentationSummaryResponse) => {
    const key = segmentationKey(identityOf(seg));
    return state.selectedSegmentations.find((s) => segmentationKey(s) === key);
  };

  const handleToggle = (seg: SegmentationSummaryResponse) => {
    const identity = identityOf(seg);
    if (selectionOf(seg))
      toggleSegmentationVisibility(segmentationKey(identity));
    else addSegmentation(identity);
  };

  return (
    <Box>
      <Box sx={{ px: 1, pt: 1, display: "flex" }}>
        <TableSearch
          value={search}
          onChange={onSearchChange}
          what="segmentations"
          shown={shown.length}
          total={segmentations.length}
        />
      </Box>
      {present.length > 1 && (
        <Box
          sx={{ px: 1, py: 0.5, display: "flex", gap: 0.5, flexWrap: "wrap" }}
        >
          {present.map((t) => (
            <Chip
              key={t}
              size="small"
              label={t}
              color={filter.includes(t) ? TYPE_COLOR[t] : "default"}
              variant={filter.includes(t) ? "filled" : "outlined"}
              onClick={() =>
                setFilter((old) =>
                  old.includes(t) ? old.filter((x) => x !== t) : [...old, t],
                )
              }
            />
          ))}
        </Box>
      )}
      {shown.length === 0 && (
        <Typography color="text.secondary" sx={{ p: 2 }}>
          {search.trim()
            ? `No segmentations match “${search.trim()}”`
            : "No segmentations of the selected types"}
        </Typography>
      )}
      <TableContainer>
        <Table size="small" sx={entityTableSx}>
          <TableHead>
            <TableRow>
              <TableCell padding="none" sx={{ width: COL.toggle }} />
              <TableCell sx={{ py: 0.5, px: 0.5 }}>Name</TableCell>
              <TableCell padding="none" sx={{ width: COL.icon }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((seg) => {
              const type = segmentationTypeOf(seg);
              const identity = identityOf(seg);
              const key = segmentationKey(identity);
              const selection = selectionOf(seg);
              const visible = selection?.visible ?? false;
              const status = statuses[key];
              const color = (seg.color ?? [100, 100, 100, 255]) as [
                number,
                number,
                number,
                number,
              ];
              const hasInstances = type === "instance" || type === "panoptic";
              const isExpanded = expanded === key;
              return (
                <Fragment key={key}>
                  <TableRow
                    hover
                    onDoubleClick={rowDoubleClick(() => handleToggle(seg))}
                    sx={{
                      ...toggleRowSx,
                      backgroundColor: `${rgbaToHex(color)}20`,
                    }}
                  >
                    <TableCell padding="none" align="center">
                      <IconButton
                        size="small"
                        onClick={() => handleToggle(seg)}
                        aria-label={`Toggle ${seg.name} ${type}`}
                      >
                        {visible ? (
                          <Visibility fontSize="small" />
                        ) : (
                          <VisibilityOff fontSize="small" />
                        )}
                      </IconButton>
                    </TableCell>
                    <EntityNameCell
                      name={seg.name}
                      userId={seg.user_id}
                      sessionId={seg.session_id}
                      swatch={
                        <Box
                          sx={swatchSx(
                            type === "binary"
                              ? rgbaToHex(color)
                              : "conic-gradient(red, orange, yellow, green, blue, violet, red)",
                          )}
                        />
                      }
                      badges={
                        <>
                          <Chip
                            size="small"
                            label={TYPE_LABEL[type]}
                            color={TYPE_COLOR[type]}
                            variant="outlined"
                            sx={{
                              height: 18,
                              fontSize: 10,
                              flexShrink: 0,
                              "& .MuiChip-label": { px: 0.5 },
                            }}
                          />
                          {status && (
                            <Tooltip title={status.message}>
                              <Chip
                                size="small"
                                color="warning"
                                icon={<WarningAmber />}
                                label={
                                  status.kind === "unsupported-dtype"
                                    ? "dtype"
                                    : "error"
                                }
                                sx={{ height: 18, fontSize: 10, flexShrink: 0 }}
                              />
                            </Tooltip>
                          )}
                        </>
                      }
                      caption={
                        <Typography
                          variant="caption"
                          noWrap
                          sx={{ flexShrink: 0, lineHeight: 1.3 }}
                        >
                          · {seg.voxel_size.toFixed(2)} Å
                        </Typography>
                      }
                    />
                    <TableCell padding="none">
                      {hasInstances && (
                        <IconButton
                          size="small"
                          onClick={() => setExpanded(isExpanded ? null : key)}
                          aria-label={`Instances of ${seg.name}`}
                        >
                          {isExpanded ? (
                            <ExpandLess fontSize="small" />
                          ) : (
                            <ExpandMore fontSize="small" />
                          )}
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                  {hasInstances && isExpanded && (
                    <TableRow>
                      <TableCell colSpan={3} sx={{ p: 0, pl: 1 }}>
                        {type === "panoptic" && (
                          <Box sx={{ px: 1, pt: 0.5 }}>
                            <ToggleButtonGroup
                              size="small"
                              exclusive
                              value={selection?.panopticMode ?? "both"}
                              onChange={(_, mode: PanopticMode | null) => {
                                if (!mode) return;
                                if (!selection) addSegmentation(identity);
                                updateSegmentation(key, { panopticMode: mode });
                              }}
                              aria-label="Panoptic channels"
                            >
                              <ToggleButton value="objects">
                                Objects
                              </ToggleButton>
                              <ToggleButton value="instances">
                                Instances
                              </ToggleButton>
                              <ToggleButton value="both">Both</ToggleButton>
                            </ToggleButtonGroup>
                          </Box>
                        )}
                        <InstanceBrowser
                          runName={runName}
                          identity={identity}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

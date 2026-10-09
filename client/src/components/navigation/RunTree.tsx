/**
 * Tree view for navigating runs, voxel spacings, and tomograms.
 */

import { useState } from "react";
import {
  Box,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse,
  CircularProgress,
  Typography,
} from "@mui/material";
import {
  ExpandLess,
  ExpandMore,
  Folder,
  FolderOpen,
  Image,
  InfoOutlined,
} from "@mui/icons-material";
import { useRuns, useRun } from "@/api/hooks";
import { useCopick } from "@/contexts/CopickContext";
import { TableSearch } from "@/components/entities/TableSearch";
import { matchesSearch } from "@/utils/tableSearch";
import { RunInfoDialog } from "./RunInfoDialog";
import { useOpenTomogram } from "./useOpenTomogram";
import { useNavigation } from "@/contexts/NavigationContext";

export function RunTree() {
  const { data: runs, isLoading, error } = useRuns();
  // Shared with the run gallery.
  const { runSearch: search, setRunSearch: setSearch } = useNavigation();
  const [infoRun, setInfoRun] = useState<string | null>(null);
  const openTomogram = useOpenTomogram();

  if (isLoading) {
    return (
      <List dense>
        <ListItemButton disabled>
          <CircularProgress size={16} sx={{ mr: 1 }} />
          <ListItemText primary="Loading runs..." />
        </ListItemButton>
      </List>
    );
  }

  if (error) {
    return (
      <Typography color="error" sx={{ p: 2 }}>
        Failed to load runs
      </Typography>
    );
  }

  if (!runs || runs.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ p: 2 }}>
        No runs found
      </Typography>
    );
  }

  const shown = runs.filter((run) => matchesSearch(search, [run.name]));
  return (
    <>
      <Box
        sx={{
          px: 1,
          py: 0.5,
          display: "flex",
          position: "sticky",
          top: 0,
          zIndex: 1,
          bgcolor: "background.default",
        }}
      >
        <TableSearch
          value={search}
          onChange={setSearch}
          what="runs"
          shown={shown.length}
          total={runs.length}
        />
      </Box>
      {shown.length === 0 && (
        <Typography color="text.secondary" variant="body2" sx={{ p: 2 }}>
          No runs match “{search.trim()}”
        </Typography>
      )}
      <List dense disablePadding>
        {shown.map((run) => (
          <RunTreeNode
            key={run.name}
            runName={run.name}
            onInfo={() => setInfoRun(run.name)}
          />
        ))}
      </List>
      <RunInfoDialog
        runName={infoRun}
        onClose={() => setInfoRun(null)}
        onOpenTomogram={(voxelSize, tomoType) =>
          infoRun && openTomogram(infoRun, voxelSize, tomoType)
        }
      />
    </>
  );
}

interface RunTreeNodeProps {
  runName: string;
  onInfo: () => void;
}

function RunTreeNode({ runName, onInfo }: RunTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const { state } = useCopick();

  // Expanding a run only navigates; the shown tomogram (and its run's annotations) change when a tomogram is picked.
  const handleClick = () => setExpanded(!expanded);

  const holdsShownTomogram = state.selectedRunName === runName;

  return (
    <>
      <ListItemButton onClick={handleClick}>
        <ListItemIcon sx={{ minWidth: 32 }}>
          {expanded ? <FolderOpen /> : <Folder />}
        </ListItemIcon>
        <ListItemText
          primary={runName}
          primaryTypographyProps={{
            noWrap: true,
            fontWeight: holdsShownTomogram ? 600 : undefined,
          }}
        />
        <IconButton
          size="small"
          aria-label={`Run ${runName} info`}
          title="Run info: paths, portal links, tomograms"
          onClick={(e) => {
            e.stopPropagation();
            onInfo();
          }}
          sx={{ color: "text.secondary", mr: 0.5 }}
        >
          <InfoOutlined fontSize="small" />
        </IconButton>
        {expanded ? <ExpandLess /> : <ExpandMore />}
      </ListItemButton>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <VoxelSpacingList runName={runName} />
      </Collapse>
    </>
  );
}

interface VoxelSpacingListProps {
  runName: string;
}

function VoxelSpacingList({ runName }: VoxelSpacingListProps) {
  const { data: run, isLoading } = useRun(runName);

  if (isLoading) {
    return (
      <List dense disablePadding sx={{ pl: 2 }}>
        <ListItemButton disabled>
          <CircularProgress size={14} sx={{ mr: 1 }} />
          <ListItemText primary="Loading..." />
        </ListItemButton>
      </List>
    );
  }

  if (!run || run.voxel_spacings.length === 0) {
    return (
      <List dense disablePadding sx={{ pl: 2 }}>
        <ListItemButton disabled>
          <ListItemText
            primary="No voxel spacings"
            primaryTypographyProps={{ color: "text.secondary" }}
          />
        </ListItemButton>
      </List>
    );
  }

  return (
    <List dense disablePadding sx={{ pl: 2 }}>
      {run.voxel_spacings.map((vs) => (
        <VoxelSpacingNode
          key={vs.voxel_size}
          runName={runName}
          voxelSpacing={vs}
        />
      ))}
    </List>
  );
}

interface VoxelSpacingNodeProps {
  runName: string;
  voxelSpacing: {
    voxel_size: number;
    tomograms: { tomo_type: string }[];
  };
}

function VoxelSpacingNode({ runName, voxelSpacing }: VoxelSpacingNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const { state } = useCopick();
  const openTomogram = useOpenTomogram();

  const handleTomogramClick = (tomoType: string) =>
    openTomogram(runName, voxelSpacing.voxel_size, tomoType);

  return (
    <>
      <ListItemButton onClick={() => setExpanded(!expanded)}>
        <ListItemText
          primary={`${voxelSpacing.voxel_size.toFixed(2)} Å`}
          primaryTypographyProps={{ variant: "body2" }}
        />
        {expanded ? (
          <ExpandLess fontSize="small" />
        ) : (
          <ExpandMore fontSize="small" />
        )}
      </ListItemButton>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <List dense disablePadding sx={{ pl: 2 }}>
          {voxelSpacing.tomograms.map((tomo) => {
            const isSelected =
              state.selectedRunName === runName &&
              state.selectedVoxelSize === voxelSpacing.voxel_size &&
              state.selectedTomoType === tomo.tomo_type;

            return (
              <ListItemButton
                key={tomo.tomo_type}
                onClick={() => handleTomogramClick(tomo.tomo_type)}
                selected={isSelected}
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <Image fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={tomo.tomo_type}
                  primaryTypographyProps={{ variant: "body2", noWrap: true }}
                />
              </ListItemButton>
            );
          })}
        </List>
      </Collapse>
    </>
  );
}

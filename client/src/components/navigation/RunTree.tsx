/**
 * Tree view for navigating runs, voxel spacings, and tomograms.
 */

import { useState } from "react";
import {
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
} from "@mui/icons-material";
import { useRuns, useRun } from "@/api/hooks";
import { useCopick, useProjectId } from "@/contexts/CopickContext";

export function RunTree() {
  const projectId = useProjectId();
  const { data: runs, isLoading, error } = useRuns(projectId);

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

  return (
    <List dense disablePadding>
      {runs.map((run) => (
        <RunTreeNode key={run.name} runName={run.name} />
      ))}
    </List>
  );
}

interface RunTreeNodeProps {
  runName: string;
}

function RunTreeNode({ runName }: RunTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const { state, selectRun } = useCopick();

  const handleClick = () => {
    if (!expanded) {
      selectRun(runName);
    }
    setExpanded(!expanded);
  };

  const isSelected = state.selectedRunName === runName;

  return (
    <>
      <ListItemButton
        onClick={handleClick}
        selected={isSelected && !state.selectedTomoType}
      >
        <ListItemIcon sx={{ minWidth: 32 }}>
          {expanded ? <FolderOpen /> : <Folder />}
        </ListItemIcon>
        <ListItemText
          primary={runName}
          primaryTypographyProps={{ noWrap: true }}
        />
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
  const projectId = useProjectId();
  const { data: run, isLoading } = useRun(projectId, runName);

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
  const { state, selectTomogram } = useCopick();

  const handleTomogramClick = (tomoType: string) => {
    selectTomogram(voxelSpacing.voxel_size, tomoType);
  };

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

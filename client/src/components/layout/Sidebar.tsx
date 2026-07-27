/**
 * Sidebar with navigation tree and entity tables.
 */

import { Box, Typography, Divider, Button, IconButton, Tooltip, CircularProgress } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import RefreshIcon from "@mui/icons-material/Refresh";
import { Link } from "react-router-dom";
import { useConfig, useProjects, useReloadProject } from "@/api/hooks";
import { useProjectId } from "@/contexts/CopickContext";
import { useResetProjectUI } from "@/pages/ProjectPage";
import { RunTree } from "@/components/navigation/RunTree";
import { EntityTabs } from "@/components/entities/EntityTabs";

export function Sidebar() {
  const projectId = useProjectId();
  const { data: config } = useConfig(projectId);
  const { data: projects } = useProjects();
  const resetProjectUI = useResetProjectUI();
  const reloadProject = useReloadProject();
  const showBackLink = (projects?.length ?? 0) > 1;

  const handleReload = () => {
    resetProjectUI();
    reloadProject.mutate(projectId);
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
        {showBackLink && (
          <Button
            component={Link}
            to="/"
            size="small"
            startIcon={<ArrowBackIcon />}
            sx={{ mb: 1, ml: -0.5 }}
          >
            Projects
          </Button>
        )}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.5 }}>
          <Box
            component="img"
            src={`${import.meta.env.BASE_URL}copick-logo.png`}
            alt="Copick"
            sx={{ width: 32, height: 32, flexShrink: 0 }}
          />
          <Typography variant="h6" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
            {config?.name ?? projectId}
          </Typography>
          <Tooltip title="Reload project (drops server cache and SSH connection)">
            <span>
              <IconButton
                size="small"
                onClick={handleReload}
                disabled={reloadProject.isPending}
                aria-label="Reload project"
              >
                {reloadProject.isPending ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
        {config?.description && (
          <Typography variant="caption" color="text.secondary" noWrap>
            {config.description}
          </Typography>
        )}
      </Box>

      {/* Navigation tree */}
      <Box sx={{ flexGrow: 1, overflow: "auto", minHeight: 0 }}>
        <Box sx={{ p: 1 }}>
          <Typography
            variant="subtitle2"
            sx={{ px: 1, py: 0.5, color: "text.secondary" }}
          >
            Runs
          </Typography>
          <RunTree />
        </Box>
      </Box>

      <Divider />

      {/* Entity tabs */}
      <Box sx={{ flexShrink: 0, height: "50%", overflow: "auto" }}>
        <EntityTabs />
      </Box>
    </Box>
  );
}

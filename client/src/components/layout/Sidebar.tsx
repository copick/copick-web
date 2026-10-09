/**
 * Sidebar with navigation tree and entity tables.
 */

import { useState } from "react";
import {
  Box,
  Typography,
  Divider,
  Button,
  IconButton,
  Tooltip,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Category as ObjectTypesIcon } from "@mui/icons-material";
import { Link } from "react-router-dom";
import { useConfig, useProjects } from "@/api/hooks";
import { appUrl } from "@/api/client";
import { useProjectId } from "@/contexts/CopickContext";
import { RunTree } from "@/components/navigation/RunTree";
import { EntityTabs } from "@/components/entities/EntityTabs";
import { ObjectTypesDialog } from "@/components/config/ObjectTypesDialog";
import { ReloadProjectButton } from "./ReloadProjectButton";

export function Sidebar() {
  const projectId = useProjectId();
  const { data: config } = useConfig();
  const { data: projects } = useProjects();
  const [objectTypesOpen, setObjectTypesOpen] = useState(false);
  const showBackLink = (projects?.length ?? 0) > 1;

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
            src={appUrl("copick-logo.png")}
            alt="Copick"
            sx={{ width: 32, height: 32, flexShrink: 0 }}
          />
          <Typography variant="h6" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
            {config?.name ?? projectId}
          </Typography>
          <ReloadProjectButton />
          <Tooltip title="Object types: names, colours, labels…">
            <IconButton
              size="small"
              aria-label="Edit object types"
              onClick={() => setObjectTypesOpen(true)}
            >
              <ObjectTypesIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        {config?.description && (
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            title={config.description}
            sx={{ display: "block" }}
          >
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

      <ObjectTypesDialog
        open={objectTypesOpen}
        onClose={() => setObjectTypesOpen(false)}
      />

      {/* Entity tabs */}
      <Box sx={{ flexShrink: 0, height: "50%", overflow: "auto" }}>
        <EntityTabs />
      </Box>
    </Box>
  );
}

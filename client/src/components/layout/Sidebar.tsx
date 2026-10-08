/**
 * Sidebar with navigation tree and entity tables.
 */

import { useState } from "react";
import { Box, Typography, Divider, IconButton, Tooltip } from "@mui/material";
import { Category as ObjectTypesIcon } from "@mui/icons-material";
import { useConfig } from "@/api/hooks";
import { RunTree } from "@/components/navigation/RunTree";
import { EntityTabs } from "@/components/entities/EntityTabs";
import { ObjectTypesDialog } from "@/components/config/ObjectTypesDialog";
import { ReloadProjectButton } from "./ReloadProjectButton";

export function Sidebar() {
  const { data: config } = useConfig();
  const [objectTypesOpen, setObjectTypesOpen] = useState(false);

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
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.5 }}>
          <Box
            component="img"
            src={`${import.meta.env.BASE_URL}copick-logo.png`}
            alt="Copick"
            sx={{ width: 32, height: 32, flexShrink: 0 }}
          />
          <Typography variant="h6" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
            {config?.name ?? "Copick Web"}
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

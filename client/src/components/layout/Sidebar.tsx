/**
 * Sidebar with navigation tree and entity tables.
 */

import { Box, Typography, Divider } from "@mui/material";
import { useConfig } from "@/api/hooks";
import { RunTree } from "@/components/navigation/RunTree";
import { EntityTabs } from "@/components/entities/EntityTabs";

export function Sidebar() {
  const { data: config } = useConfig();

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.5 }}>
          <Box
            component="img"
            src="/copick-logo.png"
            alt="Copick"
            sx={{ width: 32, height: 32, flexShrink: 0 }}
          />
          <Typography variant="h6" noWrap>
            {config?.name ?? "Copick Web"}
          </Typography>
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
          <Typography variant="subtitle2" sx={{ px: 1, py: 0.5, color: "text.secondary" }}>
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

/**
 * Compact name cell of the entity tables: swatch, name and badges on the first
 * line, "user · session" (and extras) as a caption below, so the tables fit the
 * sidebar without separate user / session columns. Long names are truncated
 * (full text in the tooltip).
 */

import type { ReactNode } from "react";
import { Box, TableCell, Typography } from "@mui/material";

interface EntityNameCellProps {
  name: string;
  userId: string;
  sessionId: string;
  swatch?: ReactNode;
  /** After the name (type chips, filament icon...). */
  badges?: ReactNode;
  /** After "user · session" (lock icon, voxel size...). */
  caption?: ReactNode;
}

export function EntityNameCell({
  name,
  userId,
  sessionId,
  swatch,
  badges,
  caption,
}: EntityNameCellProps) {
  return (
    <TableCell sx={{ py: 0.25, px: 0.5, overflow: "hidden" }}>
      <Box
        sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}
      >
        {swatch}
        <Typography
          variant="body2"
          noWrap
          title={name}
          sx={{ minWidth: 0, flexShrink: 1 }}
        >
          {name}
        </Typography>
        {badges}
      </Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          minWidth: 0,
          color: "text.secondary",
        }}
      >
        <Typography
          variant="caption"
          noWrap
          title={`user ${userId} · session ${sessionId}`}
          sx={{ minWidth: 0, flexShrink: 1, lineHeight: 1.3 }}
        >
          {userId} · {sessionId}
        </Typography>
        {caption}
      </Box>
    </TableCell>
  );
}

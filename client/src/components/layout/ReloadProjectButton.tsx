/**
 * Reload the project: picks up runs, tomograms and annotations that other tools (the CLI, napari, ChimeraX…) added
 * or removed since the project was opened, like the desktop plugins' Reload.
 */

import { useState } from "react";
import {
  Alert,
  CircularProgress,
  IconButton,
  Snackbar,
  Tooltip,
} from "@mui/material";
import { Refresh as ReloadIcon } from "@mui/icons-material";
import { useReloadProject } from "@/api/hooks";

type Notice = { severity: "success" | "error"; text: string };

export function ReloadProjectButton() {
  const reload = useReloadProject();
  const [notice, setNotice] = useState<Notice | null>(null);

  const onClick = () =>
    reload.mutate(undefined, {
      onSuccess: ({ runs }) =>
        setNotice({
          severity: "success",
          text: `Reloaded the project (${runs} run${runs === 1 ? "" : "s"}).`,
        }),
      onError: (e) =>
        setNotice({
          severity: "error",
          text: e instanceof Error ? e.message : String(e),
        }),
    });

  return (
    <>
      <Tooltip
        title={
          reload.isPending
            ? "Reloading…"
            : "Reload project: show runs, tomograms and annotations added since it was opened"
        }
      >
        <span>
          <IconButton
            size="small"
            aria-label="Reload project"
            onClick={onClick}
            disabled={reload.isPending}
          >
            {reload.isPending ? (
              <CircularProgress size={16} />
            ) : (
              <ReloadIcon fontSize="small" />
            )}
          </IconButton>
        </span>
      </Tooltip>
      <Snackbar
        open={notice !== null}
        autoHideDuration={notice?.severity === "error" ? null : 3000}
        onClose={(_, reason) => reason !== "clickaway" && setNotice(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        {notice ? (
          <Alert
            severity={notice.severity}
            variant="filled"
            onClose={() => setNotice(null)}
          >
            {notice.text}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
}

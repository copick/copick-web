/**
 * Run information: where the run's data lives (paths, CryoET Data Portal
 * links), what it holds, and each tomogram's size, location and portal
 * metadata. A tomogram can be opened from here.
 */

import { useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Link,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Check as CheckIcon,
  ContentCopy as CopyIcon,
  OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";
import { useRunInfo } from "@/api/hooks";
import type { TomogramInfo } from "@/api/types";

interface RunInfoDialogProps {
  runName: string | null;
  onClose: () => void;
  /** Open a tomogram of the run in the viewer. */
  onOpenTomogram: (voxelSize: number, tomoType: string) => void;
}

const BACKENDS: Record<string, string> = {
  CopickRootFSSpec: "File system",
  CopickRootCDP: "CryoET Data Portal",
};

export function RunInfoDialog({
  runName,
  onClose,
  onOpenTomogram,
}: RunInfoDialogProps) {
  const { data, isLoading, error } = useRunInfo(runName);
  return (
    <Dialog open={runName !== null} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        Run {runName}
        {data && (
          <Chip size="small" label={BACKENDS[data.backend] ?? data.backend} />
        )}
      </DialogTitle>
      <DialogContent dividers>
        {isLoading && (
          <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
            <CircularProgress size={24} />
          </Box>
        )}
        {error && (
          <Alert severity="error">
            Could not load the run information: {String(error)}
          </Alert>
        )}
        {data && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {data.portal && (
              <Section title="CryoET Data Portal">
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  <ExternalButton href={data.portal.run_url}>
                    Run {data.portal.run_id}
                  </ExternalButton>
                  {data.portal.dataset_url && (
                    <ExternalButton href={data.portal.dataset_url}>
                      Dataset {data.portal.dataset_id}
                    </ExternalButton>
                  )}
                </Box>
              </Section>
            )}

            <Section title="Location">
              <PathRow label="Static" path={data.static_path} />
              <PathRow
                label="Overlay"
                path={data.overlay_path}
                hint="Annotations are written here"
              />
            </Section>

            <Section title="Contents">
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                {Object.entries(data.counts)
                  .filter(([, n]) => n !== null)
                  .map(([what, n]) => (
                    <Chip
                      key={what}
                      size="small"
                      variant="outlined"
                      label={`${n} ${what}`}
                    />
                  ))}
              </Box>
            </Section>

            {data.voxel_spacings.map((vs) => (
              <Section
                key={vs.voxel_size}
                title={`Voxel spacing ${vs.voxel_size.toFixed(2)} Å`}
              >
                {vs.tomograms.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    No tomograms
                  </Typography>
                )}
                {vs.tomograms.map((t) => (
                  <TomogramCard
                    key={t.tomo_type}
                    tomogram={t}
                    voxelSize={vs.voxel_size}
                    onOpen={() => {
                      onOpenTomogram(vs.voxel_size, t.tomo_type);
                      onClose();
                    }}
                  />
                ))}
              </Section>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function ExternalButton({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Button
      size="small"
      variant="outlined"
      endIcon={<OpenInNewIcon fontSize="small" />}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </Button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip title={copied ? "Copied" : "Copy"}>
      <IconButton
        size="small"
        aria-label="Copy path"
        onClick={() => {
          navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? (
          <CheckIcon fontSize="inherit" />
        ) : (
          <CopyIcon fontSize="inherit" />
        )}
      </IconButton>
    </Tooltip>
  );
}

function PathRow({
  label,
  path,
  hint,
}: {
  label: string;
  path: string | null | undefined;
  hint?: string;
}) {
  if (!path) return null;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ width: 64, flexShrink: 0 }}
        title={hint}
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          fontFamily: "monospace",
          fontSize: 12,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
        title={path}
      >
        {path}
      </Typography>
      <CopyButton text={path} />
    </Box>
  );
}

function TomogramCard({
  tomogram: t,
  voxelSize,
  onOpen,
}: {
  tomogram: TomogramInfo;
  voxelSize: number;
  onOpen: () => void;
}) {
  const p = t.portal;
  const [z, y, x] = t.zarr?.shape ?? [];
  const nm = (n: number) => ((n * voxelSize) / 10).toFixed(0);
  const facts = [
    t.zarr && `${x} × ${y} × ${z} voxels (${nm(x)} × ${nm(y)} × ${nm(z)} nm)`,
    t.zarr &&
      `${t.zarr.dtype}, ${t.zarr.levels} pyramid level${t.zarr.levels === 1 ? "" : "s"}`,
    p?.reconstruction_method &&
      `${p.reconstruction_method}${p.processing ? `, ${p.processing}` : ""}`,
    p?.ctf_corrected !== undefined &&
      (p.ctf_corrected ? "CTF corrected" : "not CTF corrected"),
    p?.fiducial_alignment_status &&
      `alignment: ${p.fiducial_alignment_status.toLowerCase()}`,
  ].filter(Boolean);
  return (
    <Box
      sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, mb: 1 }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          mb: 0.5,
          flexWrap: "wrap",
        }}
      >
        <Typography variant="body1" sx={{ fontWeight: 600 }}>
          {t.tomo_type}
        </Typography>
        {p && (
          <Link
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            variant="body2"
          >
            portal tomogram {p.id}
          </Link>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button size="small" onClick={onOpen}>
          Open
        </Button>
      </Box>
      {facts.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          {facts.join(" · ")}
        </Typography>
      )}
      <PathRow label="Path" path={t.path} />
      {p?.https_omezarr_dir && (
        <PathRow label="HTTPS" path={p.https_omezarr_dir} />
      )}
      {p && (p.deposition_url || p.authors?.length) && (
        <Divider sx={{ my: 0.5 }} />
      )}
      {p?.deposition_url && (
        <Typography variant="body2">
          Deposition{" "}
          <Link
            href={p.deposition_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {p.deposition_id}
          </Link>
        </Typography>
      )}
      {p?.authors && p.authors.length > 0 && (
        <Typography variant="body2" color="text.secondary">
          {p.authors.join(", ")}
        </Typography>
      )}
    </Box>
  );
}

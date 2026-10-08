/**
 * Object types dialog: add, change and delete the pickable object types of the
 * copick configuration (the web counterpart of the desktop Edit Object Types
 * dialog). Each save writes the configuration file on the server.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Slider,
  TextField,
  Typography,
} from "@mui/material";
import { Add as AddIcon } from "@mui/icons-material";
import { useEditObjectType, useObjectTypes } from "@/api/hooks";
import { ApiError } from "@/api/client";
import type { ObjectTypeFields } from "@/api/types";
import {
  emptyForm,
  fieldsFromForm,
  formFromObject,
  validateForm,
  type ObjectTypeForm,
} from "@/utils/objectTypeForm";

interface ObjectTypesDialogProps {
  open: boolean;
  onClose: () => void;
}

/** `null`: a new object type. */
type Selection = string | null;

export function ObjectTypesDialog({ open, onClose }: ObjectTypesDialogProps) {
  const { data, isLoading, error: loadError, refetch } = useObjectTypes(open);
  const edit = useEditObjectType();
  const [selected, setSelected] = useState<Selection>(null);
  const [form, setForm] = useState<ObjectTypeForm | null>(null);
  const [baseline, setBaseline] = useState<string>("");
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
    conflict?: boolean;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    text: ReactNode;
    action: () => void;
  } | null>(null);

  const objects = useMemo(() => data?.objects ?? [], [data]);
  const editable = data?.editable ?? false;
  const current =
    selected === null
      ? null
      : (objects.find((o) => o.name === selected) ?? null);

  const load = (next: Selection, list: ObjectTypeFields[] = objects) => {
    const obj =
      next === null ? null : (list.find((o) => o.name === next) ?? null);
    const f = obj
      ? formFromObject(obj)
      : emptyForm(data?.suggested_label ?? 1, list.length);
    setSelected(obj ? obj.name : null);
    setForm(f);
    setBaseline(JSON.stringify(f));
    setMessage(null);
  };

  // First open: show the first object (or a new one in an empty configuration).
  useEffect(() => {
    if (open && data && form === null) load(objects[0]?.name ?? null);
    if (!open) {
      setForm(null);
      setMessage(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data]);

  const dirty = form !== null && JSON.stringify(form) !== baseline;
  const others = objects.filter((o) => o.name !== selected);
  const errors = form ? validateForm(form, others) : {};
  const valid = Object.keys(errors).length === 0;
  const renamed =
    current !== null && form !== null && form.name.trim() !== current.name;

  const guard = (action: () => void) => {
    if (!dirty) return action();
    setConfirm({
      text: "Discard the unsaved changes to this object type?",
      action,
    });
  };

  const set = <K extends keyof ObjectTypeForm>(
    key: K,
    value: ObjectTypeForm[K],
  ) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const report = (e: unknown) => {
    const conflict = e instanceof ApiError && e.status === 409;
    setMessage({
      kind: "error",
      text: e instanceof ApiError ? e.detail : String(e),
      conflict,
    });
  };

  const save = () => {
    if (!form || !data || !valid) return;
    const fields = fieldsFromForm(form);
    edit.mutate(
      current
        ? { kind: "update", version: data.version, name: current.name, fields }
        : { kind: "create", version: data.version, fields },
      {
        onSuccess: (result) => {
          load(fields.name, result.objects);
          setMessage({
            kind: "success",
            text: `Saved '${fields.name}' to ${result.config_file ?? "the configuration"}.`,
          });
        },
        onError: report,
      },
    );
  };

  const remove = () => {
    if (!current || !data) return;
    const name = current.name;
    setConfirm({
      text: (
        <>
          Delete the object type <b>{name}</b> from the configuration? Its
          picks, segmentations and filaments stay on disk, but copick tools will
          no longer list them under an object type.
        </>
      ),
      action: () =>
        edit.mutate(
          { kind: "delete", version: data.version, name },
          {
            onSuccess: (result) => {
              load(result.objects[0]?.name ?? null, result.objects);
              setMessage({ kind: "success", text: `Deleted '${name}'.` });
            },
            onError: report,
          },
        ),
    });
  };

  const reload = async () => {
    const result = await refetch();
    setMessage(null);
    if (result.data)
      load(
        selected && result.data.objects.some((o) => o.name === selected)
          ? selected
          : null,
        result.data.objects,
      );
  };

  const field = (
    key: keyof ObjectTypeForm,
    label: string,
    extra: Record<string, unknown> = {},
  ) => (
    <TextField
      size="small"
      label={label}
      value={form?.[key] ?? ""}
      onChange={(e) => set(key, e.target.value as never)}
      error={!!errors[key]}
      helperText={
        errors[key] ?? (extra.helperText as string | undefined) ?? " "
      }
      disabled={!editable}
      fullWidth
      {...extra}
    />
  );

  return (
    <Dialog open={open} onClose={() => guard(onClose)} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Object types
        {data?.config_file && (
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            {data.config_file}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {isLoading && (
          <Box sx={{ p: 3, display: "flex", justifyContent: "center" }}>
            <CircularProgress size={24} />
          </Box>
        )}
        {loadError && (
          <Alert severity="error" sx={{ m: 2 }}>
            Could not load the object types: {String(loadError)}
          </Alert>
        )}
        {data && form && (
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", sm: "row" },
              minHeight: 420,
            }}
          >
            {/* Object list */}
            <Box
              sx={{
                width: { xs: "100%", sm: 230 },
                flexShrink: 0,
                borderRight: { sm: 1 },
                borderBottom: { xs: 1, sm: 0 },
                borderColor: "divider",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <List
                dense
                sx={{
                  flexGrow: 1,
                  overflow: "auto",
                  maxHeight: { xs: 180, sm: 460 },
                }}
              >
                {objects.map((o) => (
                  <ListItemButton
                    key={o.name}
                    selected={o.name === selected}
                    onClick={() =>
                      o.name !== selected && guard(() => load(o.name))
                    }
                  >
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        flexShrink: 0,
                        mr: 1,
                        bgcolor: `rgba(${o.color[0]},${o.color[1]},${o.color[2]},${o.color[3] / 255})`,
                        border: 1,
                        borderColor: "divider",
                      }}
                    />
                    <ListItemText
                      primary={o.name}
                      secondary={`label ${o.label ?? "–"} · ${
                        o.filament
                          ? "filament"
                          : o.is_particle
                            ? "particle"
                            : "segmentation"
                      }`}
                      primaryTypographyProps={{ noWrap: true }}
                    />
                  </ListItemButton>
                ))}
                {selected === null && (
                  <ListItemButton selected>
                    <ListItemText
                      primary={form.name.trim() || "New object type"}
                      secondary="not saved yet"
                    />
                  </ListItemButton>
                )}
              </List>
              <Divider />
              <Button
                startIcon={<AddIcon />}
                onClick={() => guard(() => load(null))}
                disabled={!editable || selected === null}
                sx={{ m: 1 }}
              >
                New object type
              </Button>
            </Box>

            {/* Form */}
            <Box sx={{ flexGrow: 1, p: 2, minWidth: 0 }}>
              {!editable && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  The configuration file can't be written by the server, so
                  object types are read-only here.
                </Alert>
              )}
              {message && (
                <Alert
                  severity={message.kind}
                  sx={{ mb: 2 }}
                  onClose={() => setMessage(null)}
                  action={
                    message.conflict ? (
                      <Button color="inherit" size="small" onClick={reload}>
                        Reload
                      </Button>
                    ) : undefined
                  }
                >
                  {message.text}
                </Alert>
              )}
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: "2fr 1fr" },
                  columnGap: 2,
                }}
              >
                {field("name", "Name", {
                  required: true,
                  autoFocus: selected === null,
                })}
                {field("label", "Label", {
                  required: true,
                  type: "number",
                  inputProps: { min: 1, step: 1 },
                })}
              </Box>
              {renamed && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  Existing picks, segmentations and filaments keep the old name{" "}
                  <b>{current?.name}</b>; they won't appear under the new name.
                </Alert>
              )}

              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  mb: 2,
                  flexWrap: "wrap",
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  Colour
                </Typography>
                <Box
                  component="input"
                  type="color"
                  aria-label="Colour"
                  value={form.colorHex}
                  disabled={!editable}
                  onChange={(e) =>
                    set("colorHex", (e.target as HTMLInputElement).value)
                  }
                  sx={{
                    width: 44,
                    height: 32,
                    p: 0,
                    border: 0,
                    bgcolor: "transparent",
                    cursor: "pointer",
                  }}
                />
                <Typography variant="body2" color="text.secondary">
                  Opacity
                </Typography>
                <Slider
                  size="small"
                  aria-label="Opacity"
                  value={form.alpha}
                  min={0}
                  max={255}
                  disabled={!editable}
                  onChange={(_, v) => set("alpha", v as number)}
                  sx={{ width: 140 }}
                />
              </Box>

              <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 1 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={form.isParticle}
                      disabled={!editable}
                      onChange={(e) => set("isParticle", e.target.checked)}
                    />
                  }
                  label="Particle"
                  title="Particles are picked as points; other objects are segmented only"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={form.isParticle && form.isFilament}
                      disabled={!editable || !form.isParticle}
                      onChange={(e) => set("isFilament", e.target.checked)}
                    />
                  }
                  label="Filament"
                  title="Filaments (microtubules, actin…) are traced as ordered points along their axis"
                />
              </Box>
              {form.isParticle && form.isFilament && (
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" },
                    columnGap: 2,
                  }}
                >
                  <TextField
                    select
                    size="small"
                    label="Polarity"
                    value={form.polarity}
                    disabled={!editable}
                    onChange={(e) =>
                      set(
                        "polarity",
                        e.target.value as ObjectTypeForm["polarity"],
                      )
                    }
                    helperText=" "
                  >
                    <MenuItem value="unknown">not stated</MenuItem>
                    <MenuItem value="polar">polar</MenuItem>
                    <MenuItem value="apolar">apolar</MenuItem>
                  </TextField>
                  {field("rise", "Helical rise (Å)", { type: "number" })}
                  {field("twist", "Helical twist (°)", { type: "number" })}
                </Box>
              )}

              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                  columnGap: 2,
                }}
              >
                {field("radius", "Radius (Å)", {
                  type: "number",
                  helperText: "Display size of picks",
                })}
                {field("mapThreshold", "Map threshold", { type: "number" })}
                {field("emdbId", "EMDB ID", { placeholder: "EMD-1234" })}
                {field("pdbId", "PDB ID", { placeholder: "1ABC" })}
              </Box>
              {field("identifier", "Identifier", {
                placeholder: "GO:0005840, UniProtKB:P0CX35, CHEBI:15986…",
                helperText: "Ontology or database identifier of the object",
              })}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between", px: 2 }}>
        <Box>
          {current && (
            <Button
              color="error"
              onClick={remove}
              disabled={!editable || edit.isPending}
            >
              Delete
            </Button>
          )}
        </Box>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          {dirty && <Chip size="small" label="unsaved changes" />}
          <Button
            onClick={() => load(selected)}
            disabled={!dirty || edit.isPending}
          >
            Revert
          </Button>
          <Button
            variant="contained"
            onClick={save}
            disabled={
              !editable ||
              !valid ||
              (!dirty && selected !== null) ||
              edit.isPending
            }
          >
            {selected === null ? "Add" : "Save"}
          </Button>
          <Button onClick={() => guard(onClose)}>Close</Button>
        </Box>
      </DialogActions>

      <Dialog open={confirm !== null} onClose={() => setConfirm(null)}>
        <DialogContent>
          <DialogContentText component="div">{confirm?.text}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button
            color="error"
            onClick={() => {
              const action = confirm?.action;
              setConfirm(null);
              action?.();
            }}
          >
            OK
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}

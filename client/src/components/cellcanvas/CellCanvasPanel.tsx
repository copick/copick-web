/**
 * CellCanvas learning toolbar and slice brush for the opened reconstruction, shown when the server binds it to a
 * CellCanvas core dataset. Paint semantic classes on an ortho pane (erase returns voxels to unannotated), then
 * Train and Predict in the shared core. Each stroke is saved to the copick painting segmentation; a prediction is
 * displayed only after its complete publication, by the same refresh as Reload project.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  Select,
  Slider,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  cellcanvasApi,
  chunkStroke,
  describeOperation,
  geometryMatches,
  newPublication,
  pendingOperation,
  strokeSegment,
  type CellCanvasBinding,
  type OperationState,
  type Stroke,
} from "@/api/cellcanvas";
import { refreshProjectData } from "@/api/projectRevision";
import {
  segmentationKey,
  useCopick,
  useProjectId,
} from "@/contexts/CopickContext";
import { useScene } from "@/contexts/SceneContext";
import {
  AXES,
  PLANES,
  planeAxes,
  worldToIndices,
  type XYZ,
} from "@/idetik/coordinates";
import { useLatestRef } from "@/utils/useLatestRef";

type Mode = "off" | "paint" | "erase";

interface Props {
  paneRefs: MutableRefObject<(HTMLDivElement | null)[]>;
}

export function CellCanvasPanel({ paneRefs }: Props) {
  const projectId = useProjectId();
  const { state } = useCopick();
  const run = state.selectedRunName;
  const voxelSize = state.selectedVoxelSize;
  const tomoType = state.selectedTomoType;
  const bindings = useQuery({
    queryKey: ["cellcanvas-bindings", projectId, run, voxelSize, tomoType],
    queryFn: () => cellcanvasApi.list(projectId, run!, voxelSize!, tomoType!),
    enabled: !!run && voxelSize != null && !!tomoType,
    staleTime: Infinity,
  });
  const binding = bindings.data?.bindings[0];
  if (!binding) return null;
  return (
    <BindingPanel key={binding.id} binding={binding} paneRefs={paneRefs} />
  );
}

function BindingPanel({
  binding,
  paneRefs,
}: { binding: CellCanvasBinding } & Props) {
  const projectId = useProjectId();
  const queryClient = useQueryClient();
  const { state, addSegmentation } = useCopick();
  const { scene, visible } = useScene();
  const [mode, setMode] = useState<Mode>("off");
  const [label, setLabel] = useState(binding.classes[0].id);
  const [radius, setRadius] = useState(2);
  const [message, setMessage] = useState<{
    severity: "error" | "info";
    text: string;
  } | null>(null);
  const [operation, setOperation] = useState<OperationState | undefined>();
  const [saving, setSaving] = useState(false);
  const revision = useRef<string | null>(null);
  const [paintRevision, setPaintRevision] = useState<string | null>(null);
  const shownPublication = useRef<string | null>(null);
  const seenResolved = useRef<string | null>(null);

  const status = useQuery({
    queryKey: ["cellcanvas-status", projectId, binding.id],
    queryFn: () => cellcanvasApi.status(projectId, binding.id),
    staleTime: Infinity,
  });
  const geometryOk =
    !!status.data?.check.ok &&
    !!scene &&
    geometryMatches(
      status.data.check.copick,
      scene.geometry.axes,
      scene.geometry.angstromPerUnit,
    );

  const show = useCallback(
    (ref: CellCanvasBinding["painting"]) => {
      const seg = {
        name: ref.name,
        userId: ref.user_id,
        sessionId: ref.session_id,
        voxelSize: binding.voxel_size,
        segmentationType: "multilabel" as const,
      };
      if (
        !state.selectedSegmentations.some(
          (s) => segmentationKey(s) === segmentationKey(seg),
        )
      )
        addSegmentation(seg);
    },
    [addSegmentation, binding.voxel_size, state.selectedSegmentations],
  );
  const showRef = useLatestRef(show);

  // Reconcile: adopt the server's view of painting revision, pending receipt and publication.
  const adopt = useCallback(
    async (next: OperationState, fromStatus = false) => {
      setOperation(next);
      if (!next.pending) pendingOperation.set(projectId, binding.id, null);
      const resolved = next.pending ? null : (next.last?.id ?? null);
      if (resolved !== seenResolved.current) {
        seenResolved.current = resolved;
        // A train or predict finished: the core's trained/model state changed.
        if (!fromStatus)
          void queryClient.invalidateQueries({
            queryKey: ["cellcanvas-status", projectId, binding.id],
          });
      }
    },
    [binding.id, projectId, queryClient],
  );

  useEffect(() => {
    if (!status.data) return;
    revision.current = status.data.painting.revision;
    setPaintRevision(revision.current);
    void adopt(status.data.operation, true);
  }, [status.data, adopt]);

  // Display the latest complete publication; a new one reopens label sources first (never an incomplete one).
  const publishedId = newPublication(null, operation?.published);
  useEffect(() => {
    if (!publishedId || publishedId === shownPublication.current) return;
    shownPublication.current = publishedId;
    void (async () => {
      await refreshProjectData(queryClient, projectId);
      showRef.current(binding.prediction);
    })();
  }, [publishedId, binding.prediction, projectId, queryClient, showRef]);

  // Poll only while an operation is pending; each poll reconciles the same receipt.
  const pending = operation?.pending;
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(async () => {
      try {
        await adopt(await cellcanvasApi.operation(projectId, binding.id));
      } catch (e) {
        setMessage({ severity: "error", text: (e as Error).message });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pending, adopt, projectId, binding.id]);

  const submit = async (kind: "train" | "predict") => {
    // Reuse a remembered ID: a response lost to a timeout or reload is retried, not resubmitted as new work.
    const remembered = pendingOperation.get(projectId, binding.id);
    const id = remembered?.kind === kind ? remembered.id : crypto.randomUUID();
    pendingOperation.set(projectId, binding.id, { id, kind });
    setMessage(null);
    try {
      await adopt(await cellcanvasApi.submit(projectId, binding.id, kind, id));
    } catch (e) {
      const error = e as Error & { code?: string; status?: number };
      if (error.code && error.code !== "service_unavailable")
        pendingOperation.set(projectId, binding.id, null);
      setMessage({
        severity: "error",
        text:
          error.code === "service_unavailable" || error instanceof TypeError
            ? `${error.message} Retrying ${kind} reuses the same operation.`
            : error.message,
      });
    }
  };

  const saveStroke = useCallback(
    async (stroke: Stroke) => {
      setSaving(true);
      try {
        for (const chunk of chunkStroke(stroke)) {
          const saved = await cellcanvasApi.paint(
            projectId,
            binding.id,
            revision.current,
            [chunk],
          );
          revision.current = saved.revision;
        }
        setPaintRevision(revision.current);
        await refreshProjectData(queryClient, projectId);
        showRef.current(binding.painting);
      } catch (e) {
        const error = e as Error & { code?: string };
        setMessage({
          severity: "error",
          text:
            error.code === "revision_conflict"
              ? "The painting changed elsewhere; reloaded it. Repeat the last stroke."
              : error.message,
        });
        await status.refetch();
      } finally {
        setSaving(false);
      }
    },
    [binding.id, binding.painting, projectId, queryClient, showRef, status],
  );

  const strokeRef = useLatestRef({
    mode,
    label,
    radius,
    geometryOk,
    saveStroke,
  });
  const visibleKey = visible.map(Number).join("");

  // Brush: capture-phase listeners keep painting drags from also panning the pane.
  useEffect(() => {
    if (!scene) return;
    const { runtime, geometry, sliceCoords } = scene;
    const disposers: (() => void)[] = [];
    PLANES.forEach((plane, i) => {
      const element = paneRefs.current[i];
      if (!element || !visible[i]) return;
      const w = planeAxes[plane][2];
      let stroke: Stroke | null = null;
      const voxel = (event: PointerEvent): [number, number, number] => {
        const world = runtime.clientToWorld(
          plane,
          event.clientX,
          event.clientY,
        ) as XYZ;
        world[w] = sliceCoords[AXES[w]] ?? world[w];
        return worldToIndices(world, geometry.axes);
      };
      const down = (event: PointerEvent) => {
        const s = strokeRef.current;
        if (s.mode === "off" || !s.geometryOk || event.button !== 0) return;
        event.stopPropagation();
        event.preventDefault();
        element.setPointerCapture(event.pointerId);
        stroke = {
          label: s.mode === "erase" ? 0 : s.label,
          radius: s.radius,
          plane,
          points: [voxel(event)],
        };
      };
      const move = (event: PointerEvent) => {
        if (!stroke) return;
        event.stopPropagation();
        const last = stroke.points[stroke.points.length - 1];
        stroke.points.push(...strokeSegment(last, voxel(event)).slice(1));
      };
      const up = (event: PointerEvent) => {
        if (!stroke) return;
        event.stopPropagation();
        const done = stroke;
        stroke = null;
        void strokeRef.current.saveStroke(done);
      };
      element.addEventListener("pointerdown", down, true);
      element.addEventListener("pointermove", move, true);
      element.addEventListener("pointerup", up, true);
      disposers.push(() => {
        element.removeEventListener("pointerdown", down, true);
        element.removeEventListener("pointermove", move, true);
        element.removeEventListener("pointerup", up, true);
      });
    });
    return () => disposers.forEach((d) => d());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, visibleKey]);

  useEffect(() => {
    const panes = paneRefs.current.slice(0, 3);
    const cursor = mode === "off" || !geometryOk ? "" : "crosshair";
    for (const pane of panes) if (pane) pane.style.cursor = cursor;
    return () => {
      for (const pane of panes) if (pane) pane.style.cursor = "";
    };
  }, [mode, geometryOk, paneRefs, visibleKey]);

  const core = status.data?.core;
  const busy = !!operation?.pending || saving;
  const stale =
    core?.trained &&
    paintRevision !== null &&
    core.model_painting_revision !== paintRevision;
  const opText = describeOperation(operation);
  const model = String(binding.features.model ?? "unspecified features");
  return (
    <Box
      data-testid="cellcanvas-panel"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        p: 1,
        borderBottom: 1,
        borderColor: "divider",
        backgroundColor: "background.paper",
        flexWrap: "wrap",
      }}
    >
      <Tooltip title={`Features: ${model}`}>
        <Chip
          size="small"
          color={geometryOk ? "primary" : "warning"}
          label={`CellCanvas · ${binding.id}`}
        />
      </Tooltip>
      {status.isLoading && <CircularProgress size={16} />}
      {status.data && !status.data.check.ok && (
        <Alert severity="warning" sx={{ py: 0 }}>
          Not bound: {status.data.check.problems.join(" ")}
        </Alert>
      )}
      {status.data?.check.ok && !geometryOk && scene && (
        <Alert severity="warning" sx={{ py: 0 }}>
          The opened volume's grid differs from the bound reconstruction;
          painting is disabled.
        </Alert>
      )}
      <ToggleButtonGroup
        size="small"
        exclusive
        value={mode}
        onChange={(_, v: Mode | null) => v && setMode(v)}
        disabled={!geometryOk}
      >
        <ToggleButton value="off" aria-label="Navigate">
          Navigate
        </ToggleButton>
        <ToggleButton value="paint" aria-label="Paint">
          Paint
        </ToggleButton>
        <ToggleButton value="erase" aria-label="Erase to unannotated">
          Erase
        </ToggleButton>
      </ToggleButtonGroup>
      <Select
        size="small"
        value={label}
        onChange={(e) => setLabel(Number(e.target.value))}
        disabled={mode === "erase"}
        inputProps={{ "aria-label": "Class" }}
      >
        {binding.classes.map((c) => (
          <MenuItem key={c.id} value={c.id}>
            {c.id} · {c.name}
          </MenuItem>
        ))}
      </Select>
      <Box sx={{ width: 120, display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="caption">r={radius}</Typography>
        <Slider
          size="small"
          min={0}
          max={16}
          value={radius}
          onChange={(_, v) => setRadius(v as number)}
          aria-label="Brush radius (voxels)"
        />
      </Box>
      {saving && <Typography variant="caption">Saving…</Typography>}
      <Button
        size="small"
        variant="outlined"
        disabled={!geometryOk || busy}
        onClick={() => submit("train")}
      >
        Train
      </Button>
      <Button
        size="small"
        variant="outlined"
        disabled={!geometryOk || busy || !core?.trained}
        onClick={() => submit("predict")}
      >
        Predict
      </Button>
      {busy && operation?.pending && <CircularProgress size={16} />}
      <Typography variant="caption" data-testid="cellcanvas-status">
        {opText}
        {stale ? " Painting changed since training." : ""}
      </Typography>
      {message && (
        <Alert
          severity={message.severity}
          onClose={() => setMessage(null)}
          sx={{ py: 0 }}
        >
          {message.text}
        </Alert>
      )}
    </Box>
  );
}

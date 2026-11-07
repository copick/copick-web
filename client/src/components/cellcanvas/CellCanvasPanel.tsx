/**
 * Painting toolbar of the opened reconstruction. When the server binds it to a CellCanvas core dataset, the bound
 * painting is edited with the binding's classes and Train/Predict run in the shared core; otherwise the generic
 * `AnnotationPanel` is shown. Paint semantic classes on an ortho pane (erase returns voxels to unannotated), then
 * Train and Predict in the shared core. Each stroke is saved to the copick painting segmentation; a prediction is
 * displayed only after its complete publication. Predict covers the current slice, a slab around it or (for volumes
 * small enough) the whole volume; a region publication re-reads only the chunks it rewrote, a whole-volume one
 * refreshes like Reload project.
 */

import {
  useCallback,
  useEffect,
  useMemo,
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
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { annotationsApi, type Saved } from "@/api/annotations";
import {
  cellcanvasApi,
  describeOperation,
  describeRegion,
  geometryMatches,
  newPublication,
  pendingOperation,
  predictRegion,
  SLAB_DEPTH,
  WHOLE_VOLUME_VOXELS,
  type CellCanvasBinding,
  type OperationState,
  type PredictExtent,
} from "@/api/cellcanvas";
import { worldToIndex } from "@/idetik/coordinates";
import { refreshProjectData } from "@/api/projectRevision";
import { useCopick, useProjectId } from "@/contexts/CopickContext";
import { useScene } from "@/contexts/SceneContext";
import { AnnotationPanel } from "@/components/annotation/AnnotationPanel";
import { PaintControls } from "@/components/annotation/PaintControls";
import {
  ProposalTools,
  useShowSegmentation,
  type PointHandler,
} from "@/components/annotation/ProposalTools";
import { showSavedEdit } from "@/components/annotation/showEdit";
import { usePainting } from "@/components/annotation/usePainting";
import { useLatestRef } from "@/utils/useLatestRef";

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
  if (!bindings.data) return null;
  // Without a CellCanvas binding, painting and proposals still work on any copick segmentation.
  if (!binding) return <AnnotationPanel paneRefs={paneRefs} />;
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
  const { scene } = useScene();
  const [operation, setOperation] = useState<OperationState | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [extent, setExtent] = useState<PredictExtent | null>(null);
  const shownPublication = useRef<string | null>(null);
  const seenResolved = useRef<string | null>(null);
  const pointHandler = useRef<
    ((voxel: [number, number, number], include: boolean) => void) | null
  >(null);
  const setPointHandler = useCallback((handler: PointHandler | null) => {
    pointHandler.current = handler;
  }, []);

  const status = useQuery({
    queryKey: ["cellcanvas-status", projectId, binding.id],
    queryFn: () => cellcanvasApi.status(projectId, binding.id),
    staleTime: Infinity,
  });
  const backends = useQuery({
    queryKey: ["backends", projectId],
    queryFn: () => annotationsApi.backends(projectId),
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
  const show = useShowSegmentation(binding.voxel_size);
  const showRef = useLatestRef(show);
  const refresh = useCallback(
    async (saved?: Saved) => {
      await showSavedEdit(
        queryClient,
        projectId,
        {
          run: binding.run,
          voxel_size: binding.voxel_size,
          tomo_type: binding.tomo_type,
          painting: binding.painting,
        },
        saved,
      );
      void queryClient.invalidateQueries({
        queryKey: ["cellcanvas-status", projectId, binding.id],
      });
      showRef.current(binding.painting);
    },
    [binding, projectId, queryClient, showRef],
  );
  const painter = useMemo(
    () => cellcanvasApi.painter(projectId, binding.id),
    [projectId, binding.id],
  );
  const tools = usePainting({
    painter,
    paneRefs,
    state: status.data?.painting,
    reload: status.refetch,
    refresh,
    enabled: geometryOk,
    blocked: !!operation?.pending,
    onPoint: (voxel, include) => pointHandler.current?.(voxel, include),
  });

  // Reconcile: adopt the server's view of the pending receipt and publication.
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
    const data = status.data;
    if (data) void Promise.resolve().then(() => adopt(data.operation, true));
  }, [status.data, adopt]);

  // Display the latest complete publication (never an incomplete one). A region publication re-reads only the
  // chunks it rewrote; a whole-volume one (or a region publication that had to start a new store) swapped the
  // store, so label sources are reopened.
  const published = operation?.published;
  const publishedId = newPublication(null, published);
  useEffect(() => {
    if (!publishedId || publishedId === shownPublication.current) return;
    shownPublication.current = publishedId;
    void (async () => {
      // Noting the region also lets the 3D isosurface keep its volume and later update only rewritten chunks.
      if (published?.changed_region) {
        await showSavedEdit(
          queryClient,
          projectId,
          {
            run: binding.run,
            voxel_size: binding.voxel_size,
            tomo_type: binding.tomo_type,
            painting: binding.prediction,
          },
          {
            revision: null,
            can_undo: false,
            changed_voxels: 1,
            changed_region: published.changed_region,
          },
        );
      }
      if (!published?.changed_region || published.new_store)
        await refreshProjectData(queryClient, projectId);
      showRef.current(binding.prediction);
    })();
  }, [publishedId, published, binding, projectId, queryClient, showRef]);

  // Poll only while an operation is pending; each poll reconciles the same receipt.
  const pending = operation?.pending;
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(async () => {
      try {
        await adopt(await cellcanvasApi.operation(projectId, binding.id));
      } catch (e) {
        setMessage((e as Error).message);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pending, adopt, projectId, binding.id]);

  const shapeZyx = status.data?.check.copick?.shape;
  const voxels = shapeZyx ? shapeZyx.reduce((a, b) => a * b, 1) : 0;
  const wholeAllowed = voxels > 0 && voxels <= WHOLE_VOLUME_VOXELS;
  const chosenExtent: PredictExtent =
    extent ?? (wholeAllowed ? "volume" : "slice");
  const currentZ = () => {
    const axis = scene?.geometry.axes[2];
    const z = scene?.sliceCoords.z;
    return axis && z != null ? worldToIndex(z, axis) : 0;
  };

  const submit = async (kind: "train" | "predict") => {
    // Reuse a remembered ID: a response lost to a timeout or reload is retried, not resubmitted as new work.
    const remembered = pendingOperation.get(projectId, binding.id);
    const reuse = remembered?.kind === kind;
    const id = reuse ? remembered.id : crypto.randomUUID();
    const region =
      kind !== "predict"
        ? null
        : reuse
          ? (remembered.region ?? null)
          : predictRegion(chosenExtent, currentZ(), shapeZyx?.[0] ?? 1);
    pendingOperation.set(projectId, binding.id, { id, kind, region });
    setMessage(null);
    try {
      await adopt(
        await cellcanvasApi.submit(projectId, binding.id, kind, id, region),
      );
    } catch (e) {
      const error = e as Error & { code?: string; status?: number };
      if (error.code && error.code !== "service_unavailable")
        pendingOperation.set(projectId, binding.id, null);
      setMessage(
        error.code === "service_unavailable" || error instanceof TypeError
          ? `${error.message} Retrying ${kind} reuses the same operation.`
          : error.message,
      );
    }
  };

  const core = status.data?.core;
  const busy = !!operation?.pending || tools.saving;
  const stale =
    core?.trained &&
    tools.revision !== null &&
    core.model_painting_revision !== tools.revision;
  const opText = describeOperation(operation);
  const model = String(binding.features.model ?? "unspecified features");
  const nn = backends.data?.nninteractive;
  const shape = status.data?.check.copick
    ? ([...status.data.check.copick.shape].reverse() as [
        number,
        number,
        number,
      ])
    : null;
  const target = {
    run: binding.run,
    voxel_size: binding.voxel_size,
    tomo_type: binding.tomo_type,
    painting: binding.painting,
  };
  return (
    <Box
      data-testid="cellcanvas-panel"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
        p: 1,
        borderBottom: 1,
        borderColor: "divider",
        backgroundColor: "background.paper",
      }}
    >
      <PaintControls
        tools={tools}
        classes={binding.classes}
        geometryOk={geometryOk}
        busy={!!operation?.pending}
        problem={
          status.data && !status.data.check.ok
            ? `Not bound: ${status.data.check.problems.join(" ")}`
            : status.data?.check.ok && !geometryOk && scene
              ? "The opened volume's grid differs from the bound reconstruction; painting is disabled."
              : null
        }
      >
        <Tooltip title={`Features: ${model}`}>
          <Chip
            size="small"
            color={geometryOk ? "primary" : "warning"}
            label={`CellCanvas · ${binding.id}`}
          />
        </Tooltip>
        {status.isLoading && <CircularProgress size={16} />}
      </PaintControls>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          flexWrap: "wrap",
        }}
      >
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
        <ToggleButtonGroup
          size="small"
          exclusive
          value={chosenExtent}
          onChange={(_, value: PredictExtent | null) =>
            value && setExtent(value)
          }
          disabled={!geometryOk || busy}
          data-testid="predict-extent"
        >
          <ToggleButton
            value="slice"
            sx={{ py: 0 }}
            title="Predict the XY slice shown in the views"
          >
            Slice
          </ToggleButton>
          <ToggleButton
            value="slab"
            sx={{ py: 0 }}
            title={`Predict ${SLAB_DEPTH} XY slices centred on the shown one`}
          >
            {SLAB_DEPTH} slices
          </ToggleButton>
          <ToggleButton
            value="volume"
            sx={{ py: 0 }}
            disabled={!wholeAllowed}
            title={
              wholeAllowed
                ? "Predict the whole volume"
                : "Too large to predict at once; predict a slice or a slab"
            }
          >
            Volume
          </ToggleButton>
        </ToggleButtonGroup>
        {busy && operation?.pending && <CircularProgress size={16} />}
        <Typography variant="caption" data-testid="cellcanvas-status">
          {opText}
          {stale ? " Painting changed since training." : ""}
          {published?.regions && published.regions.length > 1
            ? ` Shown: ${published.regions.map(describeRegion).join(", ")}.`
            : ""}
        </Typography>
        {message && (
          <Alert
            severity="error"
            onClose={() => setMessage(null)}
            sx={{ py: 0 }}
          >
            {message}
          </Alert>
        )}
      </Box>
      {geometryOk && (
        <ProposalTools
          projectId={projectId}
          target={target}
          painting={tools}
          classes={binding.classes}
          shape={shape}
          nninteractive={!!nn?.available && !nn.needs_local_project}
          prediction={
            operation?.published?.complete ? binding.prediction : null
          }
          setPointHandler={setPointHandler}
        />
      )}
    </Box>
  );
}

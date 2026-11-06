/**
 * Painting toolbar for the opened reconstruction when no learning backend is bound to it: paint the project's classes
 * into a copick segmentation, undo, and accept model proposals (nnInteractive, when the server offers it).
 *
 * An embedding host can fix the painted segmentation with `?paint_name=&paint_user=&paint_session=`; otherwise the
 * target is the `painting` segmentation of user `copick-web`, session `1`, and can be changed here.
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, TextField } from "@mui/material";
import {
  annotationsApi,
  geometryMatches,
  hostPaintingRef,
  type PaintTarget,
  type SegmentationRef,
} from "@/api/annotations";
import { refreshProjectData } from "@/api/projectRevision";
import { useCopick, useProjectId } from "@/contexts/CopickContext";
import { useScene } from "@/contexts/SceneContext";
import { PaintControls } from "./PaintControls";
import {
  ProposalTools,
  useShowSegmentation,
  type PointHandler,
} from "./ProposalTools";
import { usePainting } from "./usePainting";

interface Props {
  paneRefs: MutableRefObject<(HTMLDivElement | null)[]>;
}

const DEFAULT_REF: SegmentationRef = {
  name: "painting",
  user_id: "copick-web",
  session_id: "1",
};

export function AnnotationPanel({ paneRefs }: Props) {
  const projectId = useProjectId();
  const queryClient = useQueryClient();
  const { state } = useCopick();
  const { scene } = useScene();
  const host = useMemo(() => hostPaintingRef(), []);
  const [ref, setRef] = useState<SegmentationRef>(host ?? DEFAULT_REF);
  const run = state.selectedRunName;
  const voxelSize = state.selectedVoxelSize;
  const tomoType = state.selectedTomoType;
  const target: PaintTarget | null =
    run && voxelSize != null && tomoType
      ? { run, voxel_size: voxelSize, tomo_type: tomoType, painting: ref }
      : null;

  const backends = useQuery({
    queryKey: ["backends", projectId],
    queryFn: () => annotationsApi.backends(projectId),
    staleTime: Infinity,
  });
  const painting = useQuery({
    queryKey: ["painting", projectId, target],
    queryFn: () => annotationsApi.state(projectId, target!),
    enabled: !!target,
    staleTime: Infinity,
  });
  const grid = painting.data?.grid;
  const geometryOk =
    !!grid &&
    !!scene &&
    geometryMatches(grid, scene.geometry.axes, scene.geometry.angstromPerUnit);
  const show = useShowSegmentation(voxelSize ?? 0);
  const refresh = useCallback(async () => {
    await refreshProjectData(queryClient, projectId);
    show(ref);
  }, [projectId, queryClient, ref, show]);
  const painter = useMemo(
    () => (target ? annotationsApi.painter(projectId, target) : null),
    [projectId, target],
  );
  const pointHandler = useRef<
    ((voxel: [number, number, number], include: boolean) => void) | null
  >(null);
  const setPointHandler = useCallback((handler: PointHandler | null) => {
    pointHandler.current = handler;
  }, []);
  const tools = usePainting({
    painter:
      painter ??
      annotationsApi.painter(projectId, {
        run: "",
        voxel_size: 0,
        tomo_type: "",
        painting: ref,
      }),
    paneRefs,
    state: painting.data,
    reload: painting.refetch,
    refresh,
    enabled: geometryOk && !!painter,
    onPoint: (voxel, include) => pointHandler.current?.(voxel, include),
  });
  const classes = painting.data?.classes ?? [];
  if (!target || !classes.length) return null;
  const nn = backends.data?.nninteractive;
  const shape = grid
    ? ([...grid.shape].reverse() as [number, number, number])
    : null;
  return (
    <Box
      data-testid="annotation-panel"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
        px: 1,
        py: 0.5,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <PaintControls
        tools={tools}
        classes={classes}
        geometryOk={geometryOk}
        problem={
          grid && !geometryOk
            ? "The opened volume's grid differs from the reconstruction; painting is off."
            : null
        }
      >
        {(["name", "user_id", "session_id"] as const).map((key) => (
          <TextField
            key={key}
            size="small"
            label={
              key === "name"
                ? "segmentation"
                : key === "user_id"
                  ? "user"
                  : "session"
            }
            value={ref[key]}
            disabled={!!host || tools.saving}
            onChange={(e) => setRef({ ...ref, [key]: e.target.value })}
            sx={{ width: key === "session_id" ? 70 : 120 }}
            slotProps={{ htmlInput: { "data-testid": `paint-${key}` } }}
          />
        ))}
      </PaintControls>
      <ProposalTools
        projectId={projectId}
        target={target}
        painting={tools}
        classes={classes}
        shape={shape}
        nninteractive={!!nn?.available && !nn.needs_local_project}
        setPointHandler={setPointHandler}
      />
    </Box>
  );
}

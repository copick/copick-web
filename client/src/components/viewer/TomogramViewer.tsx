/**
 * The tomogram viewer: linked XY / XZ / YZ orthoslices with crosshairs and a
 * 3D volume view on one idetik runtime. "Single" layout shows one ortho pane
 * (the former single-plane viewer); "Multi" shows the panes chosen under
 * "Show". Overlays (segmentations, picks, filaments) add one layer per
 * visible view and read the shared crosshair.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, Chip } from "@mui/material";
import { LayoutProvider, useLayout } from "@/contexts/LayoutContext";
import { SceneContext, type SceneContextType } from "@/contexts/SceneContext";
import {
  SliceContext,
  useViewerBridge,
  type SliceContextType,
} from "@/contexts/SliceContext";
import { usePicking } from "@/contexts/PickingContext";
import {
  PLANES,
  angstromToWorld,
  indicesToWorld,
  worldToIndices,
  type XYZ,
} from "@/idetik/coordinates";
import { ChannelControls } from "./ChannelControls";
import { ViewerControls } from "./ViewerControls";
import { ViewerStage } from "./ViewerStage";
import { VolumeControls } from "./VolumeControls";
import {
  DEFAULT_CONTRAST,
  useTomogramScene,
  type PaneDecor,
} from "./useTomogramScene";
import {
  DEFAULT_VOLUME_SETTINGS,
  useVolumeView,
  type VolumeSettings,
} from "./useVolumeView";
import { usePaneInteractions } from "./usePaneInteractions";
import { SegmentationOverlay } from "@/components/overlays/SegmentationOverlay";
import { InteractivePicksOverlay } from "@/components/overlays/InteractivePicksOverlay";
import { FilamentsOverlay } from "@/components/overlays/FilamentsOverlay";
import { PickingToolbar } from "@/components/picking/PickingToolbar";
import { PickingEventHandler } from "@/components/picking/PickingEventHandler";
import { FilamentEditToolbar } from "@/components/filaments/FilamentEditToolbar";
import { FilamentEditEventHandler } from "@/components/filaments/FilamentEditEventHandler";
import { appUrl } from "@/api/client";

const STAGE_LABEL = {
  xy: "Loading XY first…",
  slices: "Loading XZ and YZ…",
  volume: "Loading 3D…",
  ready: "",
} as const;

export function TomogramViewer({ zarrUrl }: { zarrUrl: string }) {
  return (
    <LayoutProvider>
      <TomogramViewerContent zarrUrl={zarrUrl} />
    </LayoutProvider>
  );
}

function TomogramViewerContent({ zarrUrl }: { zarrUrl: string }) {
  const { visible } = useLayout();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paneRefs = useRef<(HTMLDivElement | null)[]>([null, null, null, null]);
  const decorRef = useRef<PaneDecor>({
    crosshairs: [],
    scaleLines: [],
    scaleLabels: [],
    loading: [],
  });
  const [resetKey, setResetKey] = useState(0);
  const [indices, setIndices] = useState<XYZ>([0, 0, 0]);
  const indicesRef = useRef<XYZ>(indices);
  indicesRef.current = indices;

  const sourceUrl = appUrl(zarrUrl);
  const {
    scene,
    stage,
    error,
    notes,
    dismissNotes,
    contextLost,
    autoContrast,
    volumeRef,
  } = useTomogramScene({
    canvasRef,
    paneRefs,
    decorRef,
    zarrUrl: sourceUrl,
    visible,
    indicesRef,
    resetKey,
    onCenter: setIndices,
  });

  // The crosshair drives every layer through the shared sliceCoords object.
  useEffect(() => {
    if (!scene) return;
    const world = indicesToWorld(indices, scene.geometry.axes);
    scene.sliceCoords.x = world[0];
    scene.sliceCoords.y = world[1];
    scene.sliceCoords.z = world[2];
  }, [scene, indices]);

  const clampIndex = useCallback(
    (axis: number, index: number) => {
      const size = scene?.geometry.axes[axis].size ?? 1;
      return Math.max(0, Math.min(size - 1, Math.round(index)));
    },
    [scene],
  );

  const setIndex = useCallback(
    (axis: number, index: number) =>
      setIndices((old) => {
        const next = [...old] as XYZ;
        next[axis] = clampIndex(axis, index);
        return next[axis] === old[axis] ? old : next;
      }),
    [clampIndex],
  );

  const step = useCallback(
    (axis: number, delta: number) =>
      setIndices((old) => {
        const next = [...old] as XYZ;
        next[axis] = clampIndex(axis, old[axis] + delta);
        return next[axis] === old[axis] ? old : next;
      }),
    [clampIndex],
  );

  const focusAngstrom = useCallback<SliceContextType["focusAngstrom"]>(
    (xyz, options) => {
      if (!scene) return;
      const world = angstromToWorld(xyz, scene.geometry.angstromPerUnit);
      setIndices(worldToIndices(world, scene.geometry.axes));
      if (options?.orbit !== false) scene.runtime.focusOrbit(world);
    },
    [scene],
  );

  const bridge = useViewerBridge();
  useEffect(() => {
    bridge.register(focusAngstrom);
    return () => bridge.register(null);
  }, [bridge, focusAngstrom]);

  // Double-click focus is off while placing or deleting picks.
  const { state: pickingState, isEditing } = usePicking();
  const allowFocusRef = useRef(true);
  allowFocusRef.current =
    !isEditing ||
    (pickingState.activeTool !== "add" && pickingState.activeTool !== "delete");

  usePaneInteractions({
    scene,
    paneRefs,
    visible,
    step,
    setIndices,
    allowFocusRef,
  });

  // Density display.
  const [color, setColor] = useState("#ffffff");
  const [contrastLimits, setContrastLimits] =
    useState<[number, number]>(DEFAULT_CONTRAST);
  const [contrastRange, setContrastRange] = useState<[number, number] | null>(
    null,
  );
  const contrastEdited = useRef(false);
  useEffect(() => {
    contrastEdited.current = false;
    setContrastRange(null);
    setContrastLimits(DEFAULT_CONTRAST);
  }, [zarrUrl]);
  useEffect(() => {
    if (!autoContrast) return;
    setContrastRange(autoContrast.range);
    if (!contrastEdited.current) setContrastLimits(autoContrast.limits);
  }, [autoContrast]);
  useEffect(() => {
    if (!scene) return;
    for (const image of scene.images) {
      image.setChannelProps([{ visible: true, color, contrastLimits }]);
    }
  }, [scene, color, contrastLimits]);

  const [volumeSettings, setVolumeSettings] = useState<VolumeSettings>(
    DEFAULT_VOLUME_SETTINGS,
  );
  useVolumeView({
    scene,
    stage,
    visible3d: visible[3],
    contrast: contrastLimits,
    settings: volumeSettings,
    volumeRef,
  });

  const resetViews = useCallback(() => {
    if (!scene) return;
    PLANES.forEach((plane) => scene.runtime.resetView(plane));
    scene.runtime.focusOrbit(scene.runtime.center, scene.runtime.size * 1.35);
  }, [scene]);

  const sceneValue = useMemo<SceneContextType>(
    () => ({ scene, stage, visible }),
    [scene, stage, visible],
  );
  const sliceValue = useMemo<SliceContextType>(
    () => ({ indices, setIndex, step, focusAngstrom }),
    [indices, setIndex, step, focusAngstrom],
  );

  return (
    <SceneContext.Provider value={sceneValue}>
      <SliceContext.Provider value={sliceValue}>
        <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
          <PickingToolbar />
          <FilamentEditToolbar />
          <ViewerControls onResetViews={resetViews} />
          <Box sx={{ flexGrow: 1, position: "relative", overflow: "hidden" }}>
            <ViewerStage
              canvasRef={canvasRef}
              paneRefs={paneRefs}
              decorRef={decorRef}
              visible={visible}
              resetKey={resetKey}
            />
            <SegmentationOverlay />
            <InteractivePicksOverlay />
            <FilamentsOverlay />
            <PickingEventHandler paneRefs={paneRefs} />
            <FilamentEditEventHandler paneRefs={paneRefs} />

            <Box
              sx={{
                position: "absolute",
                top: 8,
                right: 8,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 1,
                maxWidth: "60%",
                zIndex: 3,
              }}
            >
              {stage !== "ready" && !error && scene && (
                <Chip size="small" label={STAGE_LABEL[stage]} role="status" />
              )}
              {!scene && !error && (
                <Chip size="small" label="Opening multiscale tomogram…" />
              )}
              {error && (
                <Alert severity="error" variant="filled">
                  {error}
                </Alert>
              )}
              {contextLost && (
                <Alert
                  severity="warning"
                  variant="filled"
                  action={
                    <Button
                      color="inherit"
                      size="small"
                      onClick={() => setResetKey((n) => n + 1)}
                    >
                      Reload viewer
                    </Button>
                  }
                >
                  The browser lost its WebGL context.
                </Alert>
              )}
              {notes.length > 0 && (
                <Alert
                  severity="warning"
                  variant="outlined"
                  onClose={dismissNotes}
                  sx={{ bgcolor: "rgba(0,0,0,0.7)" }}
                >
                  {notes.map((note) => (
                    <div key={note}>{note}</div>
                  ))}
                </Alert>
              )}
            </Box>

            <Box
              sx={{
                position: "absolute",
                bottom: 0,
                right: 0,
                m: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 1,
                zIndex: 3,
              }}
            >
              {scene && visible[3] && (
                <VolumeControls
                  settings={volumeSettings}
                  maxLod={scene.maxLod}
                  onChange={setVolumeSettings}
                />
              )}
              {contrastRange && (
                <ChannelControls
                  color={color}
                  contrastLimits={contrastLimits}
                  contrastRange={contrastRange}
                  onColorChange={setColor}
                  onContrastChange={(limits) => {
                    contrastEdited.current = true;
                    setContrastLimits(limits);
                  }}
                  onResetContrast={() => {
                    contrastEdited.current = false;
                    if (autoContrast) setContrastLimits(autoContrast.limits);
                  }}
                />
              )}
            </Box>
          </Box>
        </Box>
      </SliceContext.Provider>
    </SceneContext.Provider>
  );
}

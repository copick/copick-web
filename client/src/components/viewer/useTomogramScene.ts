/**
 * Loads a tomogram into a four-view runtime with staged loading
 * (adapted from apex-agent's TomogramViewer; see idetik/NOTICE.md):
 *
 * 1. XY first;
 * 2. then XZ and YZ;
 * 3. then the 3D volume (see useVolumeView).
 *
 * Hidden panes get no image layer, so they request no chunks. Contrast comes
 * from the coarsest-level chunk the XY view loads anyway (no extra request,
 * and never a full-resolution chunk). Every chunk request is tied to the scene
 * so leaving a tomogram aborts in-flight and queued loads.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  ImageLayer,
  OmeZarrImageSource,
  type SliceCoordinates,
} from "@idetik/core";
import { ViewerRuntime } from "@/idetik/ViewerRuntime";
import {
  PLANES,
  centerIndices,
  geometryFromDimensions,
  indicesToWorld,
  type XYZ,
} from "@/idetik/coordinates";
import { contrastWithRange, type Contrast } from "@/idetik/contrast";
import { isAbortError, withSceneSignal } from "@/idetik/lifecycle";
import { sourcePolicy } from "@/idetik/policy";
import { scaleBar } from "@/idetik/scaleBar";
import { lengthLabel } from "@/idetik/coordinates";
import type { LoadingStage, Scene } from "@/contexts/SceneContext";

export const DEFAULT_CONTRAST: [number, number] = [-3, 3];
const STAGE_TIMEOUT_MS = 20000;
const SCALE_BAR_MAX_PX = 120;

/** DOM nodes the per-frame overlay positions: crosshairs and scale bars of the ortho panes. */
export interface PaneDecor {
  crosshairs: (HTMLDivElement | null)[];
  scaleLines: (HTMLDivElement | null)[];
  scaleLabels: (HTMLDivElement | null)[];
  /** "Loading…" tags of the slice panes, shown while a pane's visible chunks are still arriving. */
  loading: (HTMLElement | null)[];
}

/** How often the slice panes' loading tags are refreshed (ms). */
const LOADING_CHECK_MS = 250;

interface Options {
  canvasRef: MutableRefObject<HTMLCanvasElement | null>;
  paneRefs: MutableRefObject<(HTMLDivElement | null)[]>;
  decorRef: MutableRefObject<PaneDecor>;
  zarrUrl: string;
  visible: boolean[];
  /** Current crosshair indices, read every frame for the crosshair overlay. */
  indicesRef: MutableRefObject<XYZ>;
  /** Bump to rebuild the scene (e.g. after a lost WebGL context). */
  resetKey: number;
  /** Called with the scene's centre indices once the volume is open. */
  onCenter: (indices: XYZ) => void;
}

export interface TomogramSceneState {
  scene: Scene | null;
  stage: LoadingStage;
  error: string | null;
  /** Problems loading the volume (not progress), until dismissed. */
  notes: string[];
  dismissNotes: () => void;
  contextLost: boolean;
  autoContrast: Contrast | null;
  /** Set by useVolumeView; the stage machine waits for it. */
  volumeRef: MutableRefObject<{ objects: unknown[] } | null>;
}

function hasSlice(image: ImageLayer): boolean {
  const view = image.chunkStoreView;
  if (!view || !image.objects.length || !view.allVisibleFallbackLODLoaded())
    return false;
  const visible = [...view.chunkViewStates].filter(
    ([chunk, state]) => state.visible && chunk.lod === view.currentLOD,
  );
  return (
    visible.length > 0 &&
    visible.every(([chunk]) => chunk.state === "loaded" && !!chunk.texture)
  );
}

export function useTomogramScene({
  canvasRef,
  paneRefs,
  decorRef,
  zarrUrl,
  visible,
  indicesRef,
  resetKey,
  onCenter,
}: Options): TomogramSceneState {
  const [scene, setScene] = useState<Scene | null>(null);
  const [stage, setStage] = useState<LoadingStage>("xy");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [contextLost, setContextLost] = useState(false);
  const [autoContrast, setAutoContrast] = useState<Contrast | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const stageRef = useRef<LoadingStage>("xy");
  const volumeRef = useRef<{ objects: unknown[] } | null>(null);
  const onCenterRef = useRef(onCenter);
  onCenterRef.current = onCenter;

  useEffect(() => {
    const canvas = canvasRef.current;
    const panes = paneRefs.current;
    if (!canvas || panes.length !== 4 || panes.some((p) => !p)) return;

    let alive = true;
    let runtime: ViewerRuntime | null = null;
    const sceneAbort = new AbortController();
    const report = (message: string) =>
      setNotes((prev) => (prev.includes(message) ? prev : [...prev, message]));
    const goTo = (next: LoadingStage) => {
      stageRef.current = next;
      setStage(next);
    };

    setScene(null);
    setError(null);
    setNotes([]);
    setContextLost(false);
    setAutoContrast(null);
    goTo("xy");

    const lost = (event: Event) => {
      event.preventDefault();
      if (!alive) return;
      runtime?.idetik.stop();
      setContextLost(true);
    };
    canvas.addEventListener("webglcontextlost", lost);

    (async () => {
      const source = await OmeZarrImageSource.fromHttp({ url: zarrUrl });
      if (!alive) return;
      const dims = source.getDimensions();
      const geometry = geometryFromDimensions(dims);
      if (geometry.unitAssumed)
        report("The volume declares no spatial unit; assuming Å.");
      const maxLod = Math.max(0, dims.numLods - 1);
      const center = centerIndices(geometry.axes);
      const centerWorld = indicesToWorld(center, geometry.axes);
      const sliceCoords: SliceCoordinates = {
        x: centerWorld[0],
        y: centerWorld[1],
        z: centerWorld[2],
      };
      const policy = sourcePolicy(0, maxLod);
      const images = PLANES.map(
        (orientation) =>
          new ImageLayer({
            source,
            sliceCoords,
            orientation,
            policy,
            channelProps: [
              { color: "#ffffff", contrastLimits: DEFAULT_CONTRAST },
            ],
          }),
      );

      // Tie every chunk request to the scene. Contrast is sampled from chunks the views load
      // anyway: first the coarsest (fallback) level, then refined once from the finest level that
      // arrives, because binning averages noise away and coarse limits saturate full-res slices.
      let contrastLod = Infinity;
      let chunkFailed = false;
      const load = source.loader.loadChunkData.bind(source.loader);
      source.loader.loadChunkData = async (chunk, signal) => {
        try {
          if (!alive) throw new DOMException("Viewer disposed", "AbortError");
          await withSceneSignal(sceneAbort.signal, signal, (combined) =>
            load(chunk, combined),
          );
          if (
            alive &&
            chunk.data &&
            chunk.lod < contrastLod &&
            (contrastLod === Infinity ? chunk.lod === maxLod : true)
          ) {
            const sampled = contrastWithRange(chunk.data);
            if (sampled) {
              contrastLod = chunk.lod;
              setAutoContrast(sampled);
            }
          }
        } catch (e) {
          if (
            alive &&
            !signal.aborted &&
            !sceneAbort.signal.aborted &&
            !isAbortError(e)
          ) {
            chunkFailed = true;
            report(
              `Part of the tomogram could not be loaded, so some areas may stay blank (${String(e)}).`,
            );
          }
          throw e;
        }
      };

      runtime = new ViewerRuntime({
        canvas,
        panes: panes as HTMLElement[],
        geometry,
      });
      const rt = runtime;
      let stageStarted = performance.now();
      let loadingCheckedAt = 0;

      rt.addOverlay({
        update() {
          if (!alive) return;
          const vis = visibleRef.current;
          const current = stageRef.current;
          const stalled = performance.now() - stageStarted > STAGE_TIMEOUT_MS;
          if (
            current === "xy" &&
            (!vis[0] || hasSlice(images[0]) || chunkFailed || stalled)
          ) {
            chunkFailed = false;
            stageStarted = performance.now();
            goTo("slices");
          } else if (
            current === "slices" &&
            (images
              .slice(1)
              .every((image, i) => !vis[i + 1] || hasSlice(image)) ||
              chunkFailed ||
              stalled)
          ) {
            stageStarted = performance.now();
            goTo(vis[3] ? "volume" : "ready");
          } else if (current === "ready" && vis[3] && !volumeRef.current) {
            stageStarted = performance.now();
            goTo("volume");
          } else if (
            current === "volume" &&
            (!vis[3] || (volumeRef.current?.objects.length ?? 0) > 0 || stalled)
          ) {
            goTo("ready");
          }

          // Per-pane loading tags (slow stages move on without waiting for them).
          const now = performance.now();
          if (now - loadingCheckedAt > LOADING_CHECK_MS) {
            loadingCheckedAt = now;
            for (let i = 0; i < 3; i++) {
              const tag = decorRef.current.loading[i];
              if (!tag) continue;
              const loading = vis[i] && !hasSlice(images[i]);
              const display = loading ? "inline" : "none";
              if (tag.style.display !== display) tag.style.display = display;
            }
          }

          // Crosshairs and per-pane scale bars.
          const world = indicesToWorld(indicesRef.current, geometry.axes);
          const decor = decorRef.current;
          for (let i = 0; i < 3; i++) {
            if (!vis[i]) continue;
            const plane = PLANES[i];
            const node = decor.crosshairs[i];
            if (node) {
              const [left, top] = rt.projectToPane(plane, world);
              node.style.left = `${left}%`;
              node.style.top = `${top}%`;
            }
            const line = decor.scaleLines[i];
            const label = decor.scaleLabels[i];
            if (line && label) {
              const bar = scaleBar(
                rt.worldPerPixel(plane) * geometry.angstromPerUnit,
                SCALE_BAR_MAX_PX,
              );
              const width = bar ? `${bar.pixels.toFixed(1)}px` : "0px";
              if (line.style.width !== width) line.style.width = width;
              const text = bar ? lengthLabel(bar.angstrom) : "";
              if (label.textContent !== text) label.textContent = text;
            }
          }
        },
      });

      rt.start();
      onCenterRef.current(center);
      setScene({
        runtime: rt,
        geometry,
        source,
        sliceCoords,
        images,
        maxLod,
        snapTargets: new Map(),
      });
    })().catch((e) => {
      if (alive) setError(String(e));
    });

    return () => {
      alive = false;
      sceneAbort.abort();
      canvas.removeEventListener("webglcontextlost", lost);
      runtime?.dispose();
      volumeRef.current = null;
    };
    // The scene is rebuilt only for a new tomogram or an explicit reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zarrUrl, resetKey]);

  // Show or hide the density per pane: hidden panes have no image layer, so no chunk requests.
  useEffect(() => {
    if (!scene) return;
    const { runtime, images } = scene;
    for (let i = 0; i < 3; i++) {
      const wanted = visible[i] && (i === 0 || stage !== "xy");
      if (wanted) runtime.addLayerAtBottom(PLANES[i], images[i]);
      else runtime.removeLayer(PLANES[i], images[i]);
    }
    runtime.updateSizes();
  }, [scene, stage, visible]);

  const dismissNotes = useCallback(() => setNotes([]), []);
  return {
    scene,
    stage,
    error,
    notes,
    dismissNotes,
    contextLost,
    autoContrast,
    volumeRef,
  };
}

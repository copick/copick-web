/**
 * Tomogram viewer using idetik-react's OmeZarrChunkedImageViewer.
 *
 * Architecture: Matches umbrella's TomogramViewerView exactly:
 * - IdetikProvider at OUTER level (wraps everything)
 * - Z-index managed as LOCAL state (not context) INSIDE the provider
 * - Uses createImageSourcePolicy (NOT createExplorationPolicy)
 * - Z-index clamped in zProp useMemo
 */

import { useState, useEffect, useMemo, useCallback, memo } from "react";
import { Box } from "@mui/material";
import { createImageSourcePolicy, OmeZarrImageSource, Region } from "@idetik/core";
import { IdetikProvider, OmeZarrChunkedImageViewer, CustomContrastConfig } from "@idetik/react";
import { ViewerProvider } from "@/contexts/ViewerContext";
import { useCopick } from "@/contexts/CopickContext";
import { ViewerControls } from "./ViewerControls";
import { InteractivePicksOverlay } from "@/components/overlays/InteractivePicksOverlay";
import { SegmentationOverlay } from "@/components/overlays/SegmentationOverlay";
import { PickingToolbar } from "@/components/picking/PickingToolbar";
import { PickingEventHandler } from "@/components/picking/PickingEventHandler";

interface ContrastStats {
  mean: number;
  std: number;
  min: number;
  max: number;
}

/**
 * Resolve a zarr URL to a full URL. Registry-direct URLs come through absolute
 * (https://...) and must be passed through; local-proxy URLs are relative paths
 * that need the page origin prepended.
 */
function resolveZarrUrl(zarrUrl: string): string {
  if (/^https?:\/\//i.test(zarrUrl)) return zarrUrl;
  return `${window.location.origin}${zarrUrl}`;
}

/**
 * Read contrast limits written into the zarr's `.zattrs` (if computed by package zarrczar thru Embrella).
 */
async function getContrastFromZattrs(zarrUrl: string): Promise<ContrastStats | null> {
  try {
    const response = await fetch(`${zarrUrl}/.zattrs`);
    if (!response.ok) return null;
    const zattrs = await response.json();
    const limits = zattrs?.image_statistics?.contrast_limits;
    if (!limits || typeof limits.low !== "number" || typeof limits.high !== "number") {
      return null;
    }
    // Map {low, high} into the {mean, std, min, max} the consumer expects so
    // mean ± 3*std reproduces [low, high].
    const mean = (limits.low + limits.high) / 2;
    const std = (limits.high - limits.low) / 6;
    return { mean, std, min: limits.low, max: limits.high };
  } catch {
    return null;
  }
}

/**
 * Calculate statistics from a sample of zarr data using idetik's OmeZarrImageSource.
 * This uses the same data loading pipeline as the viewer, handling compression automatically.
 */
async function calculateContrastStats(zarrUrl: string): Promise<ContrastStats | null> {
  try {
    // Use idetik's OmeZarrImageSource to load data (handles compression)
    const source = OmeZarrImageSource.fromHttp({ url: zarrUrl });
    const loader = await source.open();

    // Get dimension info
    const dimMap = loader.getSourceDimensionMap();
    const zDim = dimMap.z;
    if (!zDim) return null;

    const midZ = Math.floor(zDim.lods[0].size / 2);
    const zScale = zDim.lods[0].scale;
    const zTranslation = zDim.lods[0].translation;

    // Convert array index to world coordinates (idetik Region uses world coords)
    const worldZ = midZ * zScale + zTranslation;

    // Load a single z-slice from the middle of the volume
    const region: Region = [
      { dimension: "z", index: { type: "point", value: worldZ } },
      { dimension: "y", index: { type: "full" } },
      { dimension: "x", index: { type: "full" } },
    ];

    // Use highest resolution LOD (0)
    const chunk = await loader.loadRegion(region, 0);

    if (!chunk.data) return null;

    // Calculate statistics from the loaded data
    const data = chunk.data;
    let sum = 0;
    let sumSq = 0;
    let min = Infinity;
    let max = -Infinity;
    const n = data.length;

    for (let i = 0; i < n; i++) {
      const v = data[i];
      sum += v;
      sumSq += v * v;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    const std = Math.sqrt(Math.max(0, variance));

    console.log("[TomogramViewer] Contrast stats calculated:", { mean, std, min, max, sampleSize: n });

    return { mean, std, min, max };
  } catch (error) {
    console.error("[TomogramViewer] Failed to calculate contrast stats:", error);
    return null;
  }
}

interface TomogramViewerProps {
  zarrUrl: string;
}

interface ZAxisMetadata {
  min: number;
  max: number;
  count: number;
}

/**
 * Fetch z-axis metadata from zarr array to determine slice count.
 */
async function getZAxisMetadata(zarrUrl: string): Promise<ZAxisMetadata | null> {
  try {
    const arrayResponse = await fetch(`${zarrUrl}/0/.zarray`);
    if (!arrayResponse.ok) return null;
    const arrayInfo = await arrayResponse.json();
    const shape = arrayInfo.shape;
    if (!Array.isArray(shape) || shape.length < 3) return null;
    const zCount = shape[0]; // shape is [z, y, x]
    return { min: 0, max: zCount - 1, count: zCount };
  } catch {
    return null;
  }
}

/**
 * Outer component: Matches umbrella's TomogramViewerViewInner pattern
 * - IdetikProvider wraps everything (keyed by zarrUrl for remount on URL change)
 * - Content component handles all state management INSIDE the provider
 * - Wrapped in React.memo to prevent re-renders when parent re-renders but props unchanged
 */
export const TomogramViewer = memo(function TomogramViewer({ zarrUrl }: TomogramViewerProps) {
  return (
    <ViewerProvider>
      {/* IdetikProvider at OUTER level - matches umbrella exactly */}
      <IdetikProvider key={zarrUrl}>
        <TomogramViewerContent zarrUrl={zarrUrl} />
      </IdetikProvider>
    </ViewerProvider>
  );
});

/**
 * Content component: All state management happens INSIDE IdetikProvider
 * This ensures z-index state changes don't affect IdetikProvider's lifecycle
 */
function TomogramViewerContent({ zarrUrl }: TomogramViewerProps) {
  // Get voxel spacing from context
  const { state: copickState } = useCopick();
  const voxelSpacing = copickState.selectedVoxelSize ?? 1;

  // LOCAL z-index state (NOT from context) - matches umbrella
  const [currentZIndex, setCurrentZIndex] = useState(0);
  const [zAxisMetadata, setZAxisMetadata] = useState<ZAxisMetadata | null>(null);
  const [contrastStats, setContrastStats] = useState<ContrastStats | null>(null);
  // STABLE setter from useState - never changes reference
  const [, setZMaxIndex] = useState<number | undefined>(undefined);

  const fullZarrUrl = resolveZarrUrl(zarrUrl);
  const isRegistryUrl = /^https?:\/\//i.test(zarrUrl);

  // Policy with CORRECT function and configuration (EXACTLY like umbrella)
  const customPolicy = useMemo(
    () => createImageSourcePolicy({
      prefetch: { x: 0, y: 0, z: 200 },
      priorityOrder: ['fallbackVisible', 'visibleCurrent', 'fallbackBackground', 'prefetchSpace', 'prefetchTime'],
      lod: { min: 0, max: 1, bias: 1.0 },
    }),
    []
  );

  // Fetch z-axis metadata FIRST (fast) - allows viewer to render immediately
  useEffect(() => {
    setZAxisMetadata(null);
    setCurrentZIndex(0);

    getZAxisMetadata(fullZarrUrl).then((metadata) => {
      if (metadata) {
        setZAxisMetadata(metadata);
        setCurrentZIndex(Math.floor(metadata.count / 2));
      }
    });
  }, [fullZarrUrl]);

  // Registry-direct zarrs: try .zattrs first, fall back to sampling
  // when the writer didn't populate image_statistics. Local proxy zarrs: sample data directly.
  // No hardcoded fallback — if neither path produces stats we surface the failure.
  useEffect(() => {
    setContrastStats(null);

    const load = async (): Promise<ContrastStats> => {
      if (isRegistryUrl) {
        const fromZattrs = await getContrastFromZattrs(fullZarrUrl);
        if (fromZattrs) return fromZattrs;
      }
      const fromSamples = await calculateContrastStats(fullZarrUrl);
      if (fromSamples) return fromSamples;
      throw new Error(
        `Could not determine contrast limits for ${fullZarrUrl}: ` +
          `.zattrs has no image_statistics.contrast_limits and data sampling failed.`,
      );
    };

    load().then(setContrastStats);
  }, [fullZarrUrl, isRegistryUrl]);

  // Compute custom contrast config based on statistics (mean ± 3*std)
  const customContrast = useMemo<CustomContrastConfig | undefined>(() => {
    if (!contrastStats) return undefined;

    const { mean, std, min, max } = contrastStats;
    // Contrast limits: mean ± 3*std
    const contrastLimits: [number, number] = [mean - 3 * std, mean + 3 * std];
    // Slider range: use min/max with some padding, or wider range based on std
    const rangeMin = Math.min(min, mean - 5 * std);
    const rangeMax = Math.max(max, mean + 5 * std);
    const contrastRange: [number, number] = [rangeMin, rangeMax];

    console.log("[TomogramViewer] Custom contrast config:", { contrastLimits, contrastRange });

    return {
      byIndex: {
        0: { contrastLimits, contrastRange },
      },
    };
  }, [contrastStats]);

  // Z-index change handler (passed as prop to ViewerControls)
  const handleZIndexChange = useCallback((newZIndex: number) => {
    if (newZIndex !== currentZIndex && zAxisMetadata) {
      setCurrentZIndex(newZIndex);
    }
  }, [currentZIndex, zAxisMetadata]);

  // zProp with CLAMPING (EXACTLY like umbrella line 140-151)
  const zProp = useMemo(() => {
    if (!zAxisMetadata || zAxisMetadata.count === 0) {
      return undefined;
    }
    const maxIndex = zAxisMetadata.count - 1;
    const initIndex = Math.max(0, Math.min(Math.floor(zAxisMetadata.count / 2), maxIndex));
    const clampedZIndex = Math.max(0, Math.min(currentZIndex, maxIndex));
    return {
      initIndex,
      index: clampedZIndex,
      setMaxIndex: setZMaxIndex,
    };
  }, [zAxisMetadata, currentZIndex]);

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Picking toolbar - shows when editing */}
      <PickingToolbar />

      {/* Controls: z-index passed via PROPS, not context */}
      <ViewerControls
        currentZIndex={currentZIndex}
        maxZIndex={zAxisMetadata?.max}
        onZIndexChange={handleZIndexChange}
      />

      {/* Main viewer area */}
      <Box sx={{ flexGrow: 1, position: "relative", overflow: "hidden" }}>
        {/* Render viewer once z-axis metadata AND contrast stats are ready */}
        {zAxisMetadata && zProp && customContrast && (
          <OmeZarrChunkedImageViewer
            sourceUrl={fullZarrUrl}
            z={zProp}
            customContrast={customContrast}
            scaleBar={{ visible: true, align: "start" }}
            policy={customPolicy}
          />
        )}
        {/* Interactive picks overlay (replaces PicksOverlay) */}
        <InteractivePicksOverlay currentZIndex={currentZIndex} voxelSpacing={voxelSpacing} />
        {/* Picking event handler for mouse interactions */}
        <PickingEventHandler
          currentZIndex={currentZIndex}
          onZIndexChange={handleZIndexChange}
          maxZIndex={zAxisMetadata?.max}
          voxelSpacing={voxelSpacing}
        />
        {/* Segmentation overlay */}
        <SegmentationOverlay currentZIndex={currentZIndex} voxelSpacing={voxelSpacing} />
      </Box>
    </Box>
  );
}

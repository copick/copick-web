/**
 * Segmentation overlay that renders segmentation masks using idetik's LabelImageLayer.
 *
 * Each visible segmentation is loaded as a separate layer with its own color mapping.
 * The layer is recreated when the z-index changes to show the correct slice.
 */

import { useEffect, useRef, useState } from "react";
import { useIdetik } from "@idetik/react";
import { OmeZarrImageSource, LabelImageLayer, Region } from "@idetik/core";
import { useCopick } from "@/contexts/CopickContext";
import { useSegmentations, useObjects } from "@/api/hooks";

interface SegmentationOverlayProps {
  currentZIndex: number;
  voxelSpacing: number; // Reserved for future coordinate conversion
}

export function SegmentationOverlay({ currentZIndex, voxelSpacing }: SegmentationOverlayProps) {
  const { state: copickState } = useCopick();

  // Get all visible segmentations
  const visibleSegmentations = copickState.selectedSegmentations.filter((s) => s.visible);

  // Get segmentation metadata from API
  const { data: segmentations } = useSegmentations(copickState.selectedRunName);

  // Get objects from copick config for label→color mapping
  const { data: objects } = useObjects();

  // Build label→color map from copick objects config
  // Each object has a `label` field (numeric ID used in multilabel segmentations)
  const labelColorMap = new Map<number, [number, number, number, number]>();
  if (objects) {
    for (const obj of objects) {
      if (obj.label !== null && obj.label !== 0) {
        labelColorMap.set(obj.label, obj.color);
      }
    }
  }

  if (visibleSegmentations.length === 0 || !segmentations) {
    return null;
  }

  return (
    <>
      {visibleSegmentations.map((seg) => {
        // Find the full segmentation data from API
        const segData = segmentations.find(
          (s) =>
            s.name === seg.name &&
            s.user_id === seg.userId &&
            s.session_id === seg.sessionId &&
            s.voxel_size === seg.voxelSize
        );

        if (!segData?.zarr_url) {
          return null;
        }

        // For single-label segmentations, get color from the pickable object matching the segmentation name
        const objectForSeg = objects?.find((obj) => obj.name === seg.name);
        const singleLabelColor = objectForSeg?.color ?? segData.color ?? [255, 0, 0, 128];

        return (
          <SegmentationLayer
            key={`${seg.name}-${seg.userId}-${seg.sessionId}-${seg.voxelSize}`}
            zarrUrl={segData.zarr_url}
            color={singleLabelColor}
            isMultilabel={segData.is_multilabel}
            labelColorMap={labelColorMap}
            currentZIndex={currentZIndex}
            tomogramVoxelSpacing={voxelSpacing}
            segmentationVoxelSize={seg.voxelSize}
          />
        );
      })}
    </>
  );
}

interface SegmentationLayerProps {
  zarrUrl: string;
  color: [number, number, number, number];
  isMultilabel: boolean;
  labelColorMap: Map<number, [number, number, number, number]>;
  currentZIndex: number;
  tomogramVoxelSpacing: number;
  segmentationVoxelSize: number;
}

function SegmentationLayer({
  zarrUrl,
  color,
  isMultilabel,
  labelColorMap,
  currentZIndex,
  tomogramVoxelSpacing,
  segmentationVoxelSize,
}: SegmentationLayerProps) {
  const { runtime } = useIdetik();
  const layerRef = useRef<LabelImageLayer | null>(null);
  const sourceRef = useRef<OmeZarrImageSource | null>(null);
  const [isSourceReady, setIsSourceReady] = useState(false);

  // Create source once when component mounts
  useEffect(() => {
    const fullUrl = `${window.location.origin}${zarrUrl}`;
    const source = OmeZarrImageSource.fromHttp({ url: fullUrl });
    sourceRef.current = source;

    // Open the source to ensure it's ready
    source.open().then(() => {
      console.log("[SegmentationOverlay] Source opened:", fullUrl);
      setIsSourceReady(true);
    }).catch((error: Error) => {
      console.error("Failed to open segmentation source:", error);
    });

    return () => {
      sourceRef.current = null;
      setIsSourceReady(false);
    };
  }, [zarrUrl]);

  // Create/update layer when z-index changes or source becomes ready
  useEffect(() => {
    console.log("[SegmentationOverlay] Effect triggered - currentZIndex:", currentZIndex);

    if (!runtime || !isSourceReady || !sourceRef.current) {
      console.log("[SegmentationOverlay] Early return - runtime:", !!runtime, "isSourceReady:", isSourceReady);
      return;
    }

    const layerManager = runtime.viewports[0]?.layerManager;
    if (!layerManager) {
      return;
    }

    // Remove old layer if it exists
    if (layerRef.current) {
      if (layerManager.layers.includes(layerRef.current)) {
        layerManager.remove(layerRef.current);
      }
      layerRef.current = null;
    }

    // Get source dimension info to check z bounds
    sourceRef.current.open().then(loader => {
      const dimMap = loader.getSourceDimensionMap();
      const zDim = dimMap.z;
      const maxZ = zDim ? zDim.lods[0].size - 1 : "unknown";
      console.log("[SegmentationOverlay] Z-dimension info:", {
        currentZIndex,
        tomogramVoxelSpacing,
        segmentationVoxelSize,
        maxZIndex: maxZ,
        zLodInfo: zDim?.lods[0],
      });
    });

    // Convert tomogram z-index to WORLD COORDINATES (Angstroms)
    // idetik's Region expects world coordinates, not array indices!
    // It internally converts: array_index = (worldZ - translation) / scale
    const worldZ = currentZIndex * tomogramVoxelSpacing;
    console.log("[SegmentationOverlay] Z-position:", {
      currentZIndex,
      tomogramVoxelSpacing,
      worldZ,
    });

    // Create region for specific z-slice using world coordinates
    const region: Region = [
      { dimension: "z", index: { type: "point", value: worldZ } },
      { dimension: "y", index: { type: "full" } },
      { dimension: "x", index: { type: "full" } },
    ];
    console.log("[SegmentationOverlay] Creating region with worldZ:", worldZ);

    // Create color map based on copick config or segmentation color
    // LabelColorMapProps uses lookupTable (Map) and cycle (array)
    const lookupTable = new Map<number, [number, number, number, number]>();
    lookupTable.set(0, [0, 0, 0, 0]); // Background (label 0) is always transparent

    if (isMultilabel && labelColorMap.size > 0) {
      // For multilabel segmentations, use colors from copick config
      // Each object in config has a `label` field that maps to pixel values in the segmentation
      for (const [label, rgba] of labelColorMap) {
        const r = rgba[0] / 255;
        const g = rgba[1] / 255;
        const b = rgba[2] / 255;
        const a = (rgba[3] / 255) * 0.5; // 50% opacity for overlay
        lookupTable.set(label, [r, g, b, a]);
      }
    } else {
      // For single-label segmentations, use the provided color for label 1
      const r = color[0] / 255;
      const g = color[1] / 255;
      const b = color[2] / 255;
      const a = (color[3] / 255) * 0.5; // 50% opacity for overlay
      lookupTable.set(1, [r, g, b, a]);
    }

    // No color cycle needed - we explicitly map all labels from copick config
    const cycle = undefined;

    // Create the label layer with transparency enabled
    // Explicitly set lod: 0 to use highest resolution (segmentations usually have no multiscale)
    const layer = new LabelImageLayer({
      source: sourceRef.current,
      region,
      colorMap: { lookupTable, cycle },
      transparent: true,
      blendMode: "normal",
      lod: 0,
    });

    // Log transform info when layer is ready (for debugging alignment issues)
    layer.addStateChangeCallback((newState) => {
      if (newState === "ready") {
        const objects = layer.objects;
        if (objects.length > 0) {
          const renderable = objects[0];
          const transform = renderable.transform;
          console.log("[SegmentationOverlay] Layer READY - transform:", {
            scale: Array.from(transform.scale),
            translation: Array.from(transform.translation),
          });
        } else {
          console.log("[SegmentationOverlay] Layer READY but NO objects!");
        }
      }
    });

    // Add to layer manager
    layerManager.add(layer);
    layerRef.current = layer;

    // Debug: Log coordinate info, layer count, and color info
    const allLayers = layerManager.layers;
    console.log("[SegmentationOverlay] Layer created:", {
      zarrUrl,
      worldZ,
      tomogramVoxelSpacing,
      segmentationVoxelSize,
      isMultilabel,
      labelCount: lookupTable.size,
      labels: Array.from(lookupTable.keys()),
      // Show colors being used
      colorForLabel1: lookupTable.get(1),
      // Layer ordering info
      totalLayers: allLayers.length,
      layerTypes: allLayers.map(l => l.type),
    });

    // Cleanup when z-index changes or unmount
    return () => {
      if (layerRef.current && layerManager.layers.includes(layerRef.current)) {
        layerManager.remove(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [runtime, isSourceReady, currentZIndex, color, isMultilabel, labelColorMap, tomogramVoxelSpacing, segmentationVoxelSize]);

  return null;
}

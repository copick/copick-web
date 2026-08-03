import {
  Color,
  ImageLayer as CoreImageLayer,
  OmeZarrImageSource,
  SliceCoordinates,
  type SliceOrientation,
} from "@idetik/core";
import { useEffect, useRef } from "react";
import { Idetik } from "../Idetik";
import { imageSourcePolicy } from "../policy";
import { indexToWorld, planeAxes, type DimensionLod } from "../orientation";
import { calculateContrast, type Contrast } from "../contrastStats";

const DEFAULT_CONTRAST_LIMITS: [number, number] = [-3, 3];

interface ImageLayerProps {
  viewer: Idetik | null;
  sourceUrl: string;
  orientation: SliceOrientation;
  sliceIndex: number;
  color: string;
  contrastLimits: [number, number] | undefined;
  onSliceLod?: (lod: DimensionLod | null) => void;
  onAutoContrast?: (contrast: Contrast) => void;
}

export function ImageLayer({
  viewer,
  sourceUrl,
  orientation,
  sliceIndex,
  color,
  contrastLimits,
  onSliceLod,
  onAutoContrast,
}: ImageLayerProps) {
  const layerRef = useRef<CoreImageLayer | null>(null);
  const sourceRef = useRef<OmeZarrImageSource | null>(null);
  const sliceLodRef = useRef<DimensionLod | null>(null);
  const sliceIndexRef = useRef(sliceIndex);
  const orientationRef = useRef(orientation);
  const sliceCoordsRef = useRef<SliceCoordinates>({});
  const channelRef = useRef({ color, contrastLimits });
  const contrastUrlRef = useRef<string | null>(null);

  sliceIndexRef.current = sliceIndex;
  orientationRef.current = orientation;
  channelRef.current = { color, contrastLimits };

  useEffect(() => {
    if (!viewer) return;

    let cancelled = false;
    const abortController = new AbortController();

    (async () => {
      const source = await OmeZarrImageSource.fromHttp({ url: sourceUrl });
      if (cancelled) return;
      sourceRef.current = source;

      const axes = planeAxes(orientationRef.current);
      const dims = source.getDimensions();
      const sliceLod = dims[axes.w]?.lods[0] ?? null;
      sliceLodRef.current = sliceLod;

      const sliceCoords: SliceCoordinates = {};
      if (sliceLod) {
        sliceCoords[axes.w] = indexToWorld(sliceIndexRef.current, sliceLod);
      }
      sliceCoordsRef.current = sliceCoords;

      const initial = channelRef.current;
      const layer = new CoreImageLayer({
        source,
        sliceCoords,
        policy: imageSourcePolicy,
        orientation: orientationRef.current,
      });
      layer.setChannelProps([
        {
          visible: true,
          color: Color.fromRgbHex(initial.color),
          contrastLimits: initial.contrastLimits ?? DEFAULT_CONTRAST_LIMITS,
        },
      ]);
      viewer.addLayer(layer);
      layerRef.current = layer;

      const uLod = dims[axes.u]?.lods[0];
      const vLod = dims[axes.v]?.lods[0];
      if (uLod && vLod) {
        viewer.frameTo(
          [0, uLod.size * uLod.scale],
          [0, vLod.size * vLod.scale],
        );
      }

      onSliceLod?.(sliceLod);

      // only compute auto-contrast once per source, so switching the slice
      // orientation doesn't clobber user-adjusted contrast settings.
      if (contrastUrlRef.current !== sourceUrl) {
        const contrast = await calculateContrast(
          source,
          abortController.signal,
        );
        if (!cancelled && contrast) {
          contrastUrlRef.current = sourceUrl;
          onAutoContrast?.(contrast);
        }
      }
    })();

    return () => {
      cancelled = true;
      abortController.abort();
      if (layerRef.current) viewer.removeLayer(layerRef.current);
      layerRef.current = null;
      sourceRef.current = null;
      sliceLodRef.current = null;
    };
  }, [viewer, sourceUrl, onSliceLod, onAutoContrast]);

  useEffect(() => {
    const layer = layerRef.current;
    const source = sourceRef.current;
    if (!viewer || !layer || !source || layer.orientation === orientation)
      return;

    const axes = planeAxes(orientation);
    const dims = source.getDimensions();
    const sliceLod = dims[axes.w]?.lods[0] ?? null;
    sliceLodRef.current = sliceLod;

    // replace with layer.setSliceCoords() when it becomes available upstream
    const sliceCoords = sliceCoordsRef.current;
    for (const axis of ["x", "y", "z"] as const) delete sliceCoords[axis];
    if (sliceLod) {
      sliceCoords[axes.w] = indexToWorld(sliceIndexRef.current, sliceLod);
    }

    layer.setOrientation(orientation);

    const uLod = dims[axes.u]?.lods[0];
    const vLod = dims[axes.v]?.lods[0];
    if (uLod && vLod) {
      viewer.frameTo([0, uLod.size * uLod.scale], [0, vLod.size * vLod.scale]);
    }

    onSliceLod?.(sliceLod);
  }, [orientation, viewer, onSliceLod]);

  useEffect(() => {
    layerRef.current?.setChannelProps([
      {
        visible: true,
        color: Color.fromRgbHex(color),
        contrastLimits: contrastLimits ?? DEFAULT_CONTRAST_LIMITS,
      },
    ]);
  }, [color, contrastLimits]);

  useEffect(() => {
    const sliceLod = sliceLodRef.current;
    if (sliceLod) {
      sliceCoordsRef.current[planeAxes(orientation).w] = indexToWorld(
        sliceIndex,
        sliceLod,
      );
    }
  }, [sliceIndex, orientation]);

  return null;
}

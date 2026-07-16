import { Color, ImageLayer as CoreImageLayer, OmeZarrImageSource, SliceCoordinates } from "@idetik/core";
import { useEffect, useRef } from "react";
import { Idetik } from "../Idetik";
import { imageSourcePolicy } from "../policy";
import { calculateContrast, type Contrast } from "../contrastStats";

type DimensionLod = { size: number; scale: number; translation: number };

const DEFAULT_CONTRAST_LIMITS: [number, number] = [-3, 3];

interface ImageLayerProps {
  viewer: Idetik | null;
  sourceUrl: string;
  zIndex: number;
  color: string;
  contrastLimits: [number, number] | undefined;
  onZMaxIndex?: (maxIndex: number | undefined) => void;
  onAutoContrast?: (contrast: Contrast) => void;
}

function indexToWorld(index: number, lod: DimensionLod): number {
  return lod.translation + index * lod.scale;
}

export function ImageLayer({
  viewer,
  sourceUrl,
  zIndex,
  color,
  contrastLimits,
  onZMaxIndex,
  onAutoContrast,
}: ImageLayerProps) {
  const layerRef = useRef<CoreImageLayer | null>(null);
  const zLodRef = useRef<DimensionLod | null>(null);
  const zIndexRef = useRef(zIndex);
  const sliceCoordsRef = useRef<SliceCoordinates>({});
  const channelRef = useRef({ color, contrastLimits });

  zIndexRef.current = zIndex;
  channelRef.current = { color, contrastLimits };

  useEffect(() => {
    if (!viewer) return;

    let cancelled = false;
    const abortController = new AbortController();

    (async () => {
      const source = await OmeZarrImageSource.fromHttp({ url: sourceUrl });
      if (cancelled) return;

      const dims = source.getDimensions();
      const zLod = dims.z?.lods[0] ?? null;
      zLodRef.current = zLod;

      if (zLod) {
        sliceCoordsRef.current.z = indexToWorld(zIndexRef.current, zLod);
      }

      const initial = channelRef.current;
      const layer = new CoreImageLayer({
        source,
        sliceCoords: sliceCoordsRef.current,
        policy: imageSourcePolicy,
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

      const xLod = dims.x.lods[0];
      const yLod = dims.y.lods[0];
      viewer.frameTo([0, xLod.size * xLod.scale], [0, yLod.size * yLod.scale]);

      onZMaxIndex?.(zLod ? zLod.size - 1 : undefined);

      const contrast = await calculateContrast(source, abortController.signal);
      if (!cancelled && contrast) {
        onAutoContrast?.(contrast);
      }
    })();

    return () => {
      cancelled = true;
      abortController.abort();
      if (layerRef.current) viewer.removeLayer(layerRef.current);
      layerRef.current = null;
      zLodRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, sourceUrl, onZMaxIndex, onAutoContrast]);

  useEffect(() => {
    layerRef.current?.setChannelProps([
      { visible: true, color: Color.fromRgbHex(color), contrastLimits: contrastLimits ?? DEFAULT_CONTRAST_LIMITS },
    ]);
  }, [color, contrastLimits]);

  useEffect(() => {
    const zLod = zLodRef.current;
    if (zLod) {
      sliceCoordsRef.current.z = indexToWorld(zIndex, zLod);
    }
  }, [zIndex]);

  return null;
}

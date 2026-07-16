import { LabelLayer, OmeZarrImageSource, SliceCoordinates } from "@idetik/core";
import { useEffect, useRef } from "react";
import { Idetik } from "../Idetik";
import { imageSourcePolicy } from "../policy";

type Rgba = [number, number, number, number];

interface SegmentationLayerProps {
  viewer: Idetik;
  sourceUrl: string;
  lookupTable: Map<number, Rgba>;
  worldZ: number;
}

export function SegmentationLayer({ viewer, sourceUrl, lookupTable, worldZ }: SegmentationLayerProps) {
  const sliceCoordsRef = useRef<SliceCoordinates>({});
  const lookupTableRef = useRef(lookupTable);
  const worldZRef = useRef(worldZ);

  lookupTableRef.current = lookupTable;
  worldZRef.current = worldZ;

  useEffect(() => {
    let cancelled = false;
    let layer: LabelLayer | null = null;

    (async () => {
      const source = await OmeZarrImageSource.fromHttp({ url: sourceUrl });
      if (cancelled) return;

      sliceCoordsRef.current.z = worldZRef.current;
      layer = new LabelLayer({
        source,
        sliceCoords: sliceCoordsRef.current,
        colorMap: { lookupTable: lookupTableRef.current },
        blendMode: "normal",
        policy: imageSourcePolicy,
      });
      viewer.addLayer(layer);
    })();

    return () => {
      cancelled = true;
      if (layer) viewer.removeLayer(layer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, sourceUrl]);

  useEffect(() => {
    sliceCoordsRef.current.z = worldZ;
  }, [worldZ]);

  return null;
}

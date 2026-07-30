import {
  LabelLayer,
  OmeZarrImageSource,
  SliceCoordinates,
  type SliceOrientation,
} from "@idetik/core";
import { useEffect, useRef } from "react";
import { Idetik } from "../Idetik";
import { imageSourcePolicy } from "../policy";
import { planeAxes } from "../orientation";

type Rgba = [number, number, number, number];

interface SegmentationLayerProps {
  viewer: Idetik;
  sourceUrl: string;
  lookupTable: Map<number, Rgba>;
  orientation: SliceOrientation;
  slicePosition: number;
}

export function SegmentationLayer({
  viewer,
  sourceUrl,
  lookupTable,
  orientation,
  slicePosition,
}: SegmentationLayerProps) {
  const layerRef = useRef<LabelLayer | null>(null);
  const sliceCoordsRef = useRef<SliceCoordinates>({});
  const lookupTableRef = useRef(lookupTable);
  const orientationRef = useRef(orientation);
  const slicePositionRef = useRef(slicePosition);

  lookupTableRef.current = lookupTable;
  orientationRef.current = orientation;
  slicePositionRef.current = slicePosition;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const source = await OmeZarrImageSource.fromHttp({ url: sourceUrl });
      if (cancelled) return;

      const axes = planeAxes(orientationRef.current);
      const sliceCoords: SliceCoordinates = {};
      sliceCoords[axes.w] = slicePositionRef.current;
      sliceCoordsRef.current = sliceCoords;
      const layer = new LabelLayer({
        source,
        sliceCoords,
        colorMap: { lookupTable: lookupTableRef.current },
        blendMode: "normal",
        policy: imageSourcePolicy,
        orientation: orientationRef.current,
      });
      viewer.addLayer(layer);
      layerRef.current = layer;
    })();

    return () => {
      cancelled = true;
      if (layerRef.current) viewer.removeLayer(layerRef.current);
      layerRef.current = null;
    };
  }, [viewer, sourceUrl]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || layer.orientation === orientation) return;

    // replace with layer.setSliceCoords() when it becomes available upstream
    const sliceCoords = sliceCoordsRef.current;
    for (const axis of ["x", "y", "z"] as const) delete sliceCoords[axis];
    sliceCoords[planeAxes(orientation).w] = slicePositionRef.current;

    layer.setOrientation(orientation);
  }, [orientation]);

  useEffect(() => {
    sliceCoordsRef.current[planeAxes(orientation).w] = slicePosition;
  }, [slicePosition, orientation]);

  return null;
}

import { useEffect, useRef } from "react";
import type { SliceOrientation } from "@idetik/core";
import { Idetik } from "../Idetik";
import { PicksLayer } from "../PicksLayer";

type Rgba = [number, number, number, number];
type Point = { x: number; y: number; z: number };

const FADE_RADIUS = 64.0;

interface PointsLayerProps {
  viewer: Idetik;
  points: Point[] | undefined;
  color: Rgba | undefined;
  pointSizePixels: number;
  orientation: SliceOrientation;
  slicePosition: number;
}

export function PointsLayer({
  viewer,
  points,
  color,
  pointSizePixels,
  orientation,
  slicePosition,
}: PointsLayerProps) {
  const layerRef = useRef<PicksLayer | null>(null);
  const orientationRef = useRef(orientation);
  const slicePositionRef = useRef(slicePosition);
  orientationRef.current = orientation;
  slicePositionRef.current = slicePosition;

  useEffect(() => {
    if (!points || points.length === 0 || !color) return;

    const layer = new PicksLayer({
      points,
      color,
      pointSizePixels,
      fadeRadius: FADE_RADIUS,
      orientation: orientationRef.current,
    });
    layer.setSlicePosition(slicePositionRef.current);
    viewer.addLayer(layer);
    layerRef.current = layer;

    return () => {
      viewer.removeLayer(layer);
      layerRef.current = null;
    };
  }, [viewer, points, color, pointSizePixels]);

  useEffect(() => {
    layerRef.current?.setOrientation(orientation);
  }, [orientation]);

  useEffect(() => {
    layerRef.current?.setSlicePosition(slicePosition);
  }, [slicePosition]);

  return null;
}

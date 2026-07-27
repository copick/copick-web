import { useEffect, useRef } from "react";
import { Idetik } from "../Idetik";
import { PicksLayer } from "../PicksLayer";

type Rgba = [number, number, number, number];
type Point = { x: number; y: number; z: number };

const Z_FADE_RADIUS = 64.0;

interface PointsLayerProps {
  viewer: Idetik;
  points: Point[] | undefined;
  color: Rgba | undefined;
  pointSizePixels: number;
  worldZ: number;
}

export function PointsLayer({
  viewer,
  points,
  color,
  pointSizePixels,
  worldZ,
}: PointsLayerProps) {
  const layerRef = useRef<PicksLayer | null>(null);
  const worldZRef = useRef(worldZ);
  worldZRef.current = worldZ;

  useEffect(() => {
    if (!points || points.length === 0 || !color) return;

    const layer = new PicksLayer({
      points,
      color,
      pointSizePixels,
      zFadeRadius: Z_FADE_RADIUS,
    });
    layer.setCurrentZ(worldZRef.current);
    viewer.addLayer(layer);
    layerRef.current = layer;

    return () => {
      viewer.removeLayer(layer);
      layerRef.current = null;
    };
  }, [viewer, points, color, pointSizePixels]);

  useEffect(() => {
    layerRef.current?.setCurrentZ(worldZ);
  }, [worldZ]);

  return null;
}

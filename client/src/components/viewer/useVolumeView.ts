/**
 * The 3D volume view: a VolumeLayer on the 3D viewport, created once the
 * slices have loaded (stage "volume") and only while the 3D pane is shown.
 * Defaults to the coarsest level.
 */

import { useEffect, useRef, type MutableRefObject } from "react";
import { VolumeLayer } from "@idetik/core";
import { sourcePolicy } from "@/idetik/policy";
import type { LoadingStage, Scene } from "@/contexts/SceneContext";

export interface VolumeSettings {
  /** Fraction of the contrast range below which density is transparent. */
  threshold: number;
  /** Opacity per Å of ray length, scaled by the voxel size. */
  opacity: number;
  /** Pyramid level drawn (null = coarsest). */
  lod: number | null;
}

export const DEFAULT_VOLUME_SETTINGS: VolumeSettings = {
  threshold: 0.7,
  opacity: 0.03,
  lod: null,
};

interface Options {
  scene: Scene | null;
  stage: LoadingStage;
  visible3d: boolean;
  contrast: [number, number];
  settings: VolumeSettings;
  volumeRef: MutableRefObject<{ objects: unknown[] } | null>;
}

export function useVolumeView({
  scene,
  stage,
  visible3d,
  contrast,
  settings,
  volumeRef,
}: Options) {
  const layerRef = useRef<VolumeLayer | null>(null);
  const active =
    !!scene && visible3d && (stage === "volume" || stage === "ready");
  const lod = settings.lod ?? scene?.maxLod ?? 0;

  useEffect(() => {
    if (!active || !scene) return;
    const volume = new VolumeLayer({
      source: scene.source,
      sliceCoords: { c: [0] },
      policy: sourcePolicy(lod, lod),
      channelProps: [
        { color: "#ffffff", visible: true, contrastLimits: contrast },
      ],
    });
    scene.runtime.addLayerAtBottom("3D", volume);
    layerRef.current = volume;
    volumeRef.current = volume;
    return () => {
      scene.runtime.removeLayer("3D", volume);
      layerRef.current = null;
      if (volumeRef.current === volume) volumeRef.current = null;
    };
    // Settings are applied below without recreating the layer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, scene]);

  useEffect(() => {
    const volume = layerRef.current;
    if (!volume || !scene) return;
    const [lo, hi] = contrast;
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) return;
    volume.setChannelProps([
      {
        color: "#ffffff",
        visible: true,
        contrastLimits: [lo + settings.threshold * (hi - lo), hi],
      },
    ]);
    volume.opacityMultiplier =
      settings.opacity / Math.max(...scene.geometry.axes.map((a) => a.scale));
    volume.sourcePolicy = sourcePolicy(lod, lod);
  }, [active, scene, contrast, settings.threshold, settings.opacity, lod]);
}

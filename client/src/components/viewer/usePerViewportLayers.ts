/**
 * Keeps one layer per visible view in sync with React state: idetik layers
 * attach to a single viewport, so overlays create one instance per view.
 * Layers are rebuilt when the deps, the scene or the visible panes change.
 * Returns a ref to the current layers, for in-place updates (colour maps,
 * selection) that should not rebuild them.
 */

import {
  useEffect,
  useRef,
  type DependencyList,
  type MutableRefObject,
} from "react";
import type { Layer } from "@idetik/core";
import { VIEW_IDS, type ViewId } from "@/idetik/coordinates";
import { useScene } from "@/contexts/SceneContext";

export function usePerViewportLayers<L extends Layer>(
  views: readonly ViewId[],
  factory: ((view: ViewId) => L | null) | null,
  deps: DependencyList,
): MutableRefObject<L[]> {
  const { scene, visible } = useScene();
  const visibleKey = visible.map(Number).join("");
  const layersRef = useRef<L[]>([]);

  useEffect(() => {
    if (!scene || !factory) return;
    const added: [ViewId, L][] = [];
    for (const view of views) {
      if (!visible[VIEW_IDS.indexOf(view)]) continue;
      const layer = factory(view);
      if (!layer) continue;
      scene.runtime.addLayer(view, layer);
      added.push([view, layer]);
    }
    layersRef.current = added.map(([, layer]) => layer);
    return () => {
      for (const [view, layer] of added) scene.runtime.removeLayer(view, layer);
      layersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, visibleKey, ...deps]);

  return layersRef;
}

/**
 * Mesh overlays: each visible copick mesh drawn in the 3D view, in its
 * object's colour. Meshes are opaque (idetik's mesh shader has no
 * transparency), so a mesh around the volume hides it until switched off.
 * The GLB is fetched while the 3D pane is shown.
 */

import { useEffect } from "react";
import {
  meshKey,
  useCopick,
  type MeshSelection,
} from "@/contexts/CopickContext";
import {
  layerStatusFromError,
  useLayerStatus,
} from "@/contexts/LayerStatusContext";
import { useScene } from "@/contexts/SceneContext";
import { useMeshGeometry, useObjects } from "@/api/hooks";
import type { Rgba } from "@/api/types";
import { VIEW_IDS } from "@/idetik/coordinates";
import { MeshObjectsLayer } from "@/idetik/MeshObjectsLayer";
import { usePerViewportLayers } from "@/components/viewer/usePerViewportLayers";

const GREY: Rgba = [100, 100, 100, 255];

export function MeshOverlay() {
  const { state } = useCopick();
  const { scene } = useScene();
  if (!scene) return null;
  return (
    <>
      {state.selectedMeshes
        .filter((m) => m.visible)
        .map((m) => (
          <Mesh3D
            key={meshKey(m)}
            runName={state.selectedRunName}
            selection={m}
          />
        ))}
    </>
  );
}

function Mesh3D({
  runName,
  selection,
}: {
  runName: string | null;
  selection: MeshSelection;
}) {
  const { scene, visible } = useScene();
  const { setStatus } = useLayerStatus();
  const { data: objects } = useObjects();
  const show3d = visible[VIEW_IDS.indexOf("3D")];
  const key = meshKey(selection);
  const { data: geometry, error } = useMeshGeometry(runName, selection, show3d);
  const color =
    objects?.find((o) => o.name === selection.objectName)?.color ?? GREY;
  // Keyed by value: the fallback colour is a new array on every render.
  const colorKey = color.join(",");
  const perUnit = scene?.geometry.angstromPerUnit ?? 1;

  useEffect(() => {
    setStatus(key, error ? layerStatusFromError(error) : null);
  }, [error, key, setStatus]);

  usePerViewportLayers(
    ["3D"],
    geometry
      ? () => {
          const [r, g, b] = colorKey.split(",").map(Number);
          return new MeshObjectsLayer(
            [{ geometry, color: [r / 255, g / 255, b / 255] }],
            perUnit,
          );
        }
      : null,
    [geometry, colorKey, perUnit],
  );
  return null;
}

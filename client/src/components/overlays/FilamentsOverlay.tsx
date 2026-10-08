/**
 * Filament overlays: each visible filament set drawn as dense points, coloured
 * by filament ID with the shared instance palette (the same colours as the
 * picks sampled from them and the instance segmentation labelled with them).
 *
 * The set being edited is drawn from the editor's state (regenerated on every
 * edit) with its control-point handles on the ortho views.
 */

import { useMemo } from "react";
import {
  useCopick,
  filamentsKey,
  type FilamentsSelection,
} from "@/contexts/CopickContext";
import { useFilamentEditing } from "@/contexts/FilamentEditingContext";
import { useScene } from "@/contexts/SceneContext";
import { useFilamentDetail, useObjects } from "@/api/hooks";
import type { PickableObjectResponse, Rgba } from "@/api/types";
import {
  PLANES,
  VIEW_IDS,
  angstromToWorld,
  type XYZ,
} from "@/idetik/coordinates";
import { densify } from "@/idetik/filamentGeometry";
import { FilamentsLayer, type FilamentPolyline } from "@/idetik/FilamentsLayer";
import {
  FilamentHandlesLayer,
  type FilamentHandle,
} from "@/idetik/FilamentHandlesLayer";
import { instanceColor } from "@/utils/instanceColors";
import { controls } from "@/filaments/editSession";
import { usePerViewportLayers } from "@/components/viewer/usePerViewportLayers";

const POINT_SIZE_PIXELS = 2.5;

export function FilamentsOverlay() {
  const { state } = useCopick();
  const { scene } = useScene();
  const { editing } = useFilamentEditing();
  if (!scene) return null;
  const editedKey = editing ? filamentsKey(editing) : null;
  return (
    <>
      {state.selectedFilaments
        .filter((f) => f.visible && filamentsKey(f) !== editedKey)
        .map((f) => (
          <FilamentSet key={filamentsKey(f)} selection={f} />
        ))}
      {editing && <EditedFilaments />}
    </>
  );
}

interface Drawn {
  instanceId: number;
  points: readonly (readonly number[])[];
  radius: number | null;
}

/** Scene scale and the polylines of a set, in world units. */
function usePolylines(
  filaments: Drawn[] | undefined,
  color: Rgba | undefined,
  object: PickableObjectResponse | undefined,
  selectedId: number | null,
) {
  const { scene } = useScene();
  const perUnit = scene?.geometry.angstromPerUnit ?? 1;
  const voxel = scene
    ? Math.min(...scene.geometry.axes.map((a) => a.scale))
    : 1;
  const polylines = useMemo<FilamentPolyline[]>(() => {
    if (!filaments || !color) return [];
    const defaultRadius = object?.radius ? object.radius / perUnit : voxel * 2;
    return filaments.map((f) => {
      const points = f.points.map((p) => angstromToWorld(p as XYZ, perUnit));
      return {
        instanceId: f.instanceId,
        points,
        dense: densify(points, voxel / 2),
        color: instanceColor(f.instanceId, color),
        radius: f.radius ? f.radius / perUnit : defaultRadius,
        selected: f.instanceId === selectedId,
      };
    });
  }, [filaments, color, object?.radius, perUnit, voxel, selectedId]);
  const halfThickness = Math.max(
    voxel * 3,
    object?.radius ? object.radius / perUnit : 0,
  );
  return { polylines, halfThickness, perUnit };
}

function useFilamentLayers(
  polylines: FilamentPolyline[],
  halfThickness: number,
) {
  const { scene } = useScene();
  usePerViewportLayers(
    VIEW_IDS,
    scene && polylines.length > 0
      ? (view) =>
          new FilamentsLayer({
            filaments: polylines,
            view,
            sliceCoords: scene.sliceCoords,
            halfThickness,
            pointSizePixels: POINT_SIZE_PIXELS,
          })
      : null,
    [polylines, halfThickness],
  );
}

function FilamentSet({ selection }: { selection: FilamentsSelection }) {
  const { state } = useCopick();
  const { data: objects } = useObjects();
  const { data } = useFilamentDetail(
    state.selectedRunName,
    selection.objectName,
    selection.userId,
    selection.sessionId,
  );
  const object = objects?.find((o) => o.name === selection.objectName);
  const drawn = useMemo(
    () =>
      data?.filaments.map((f) => ({
        instanceId: f.instance_id,
        points: f.points,
        radius: f.radius,
      })),
    [data],
  );
  const { polylines, halfThickness } = usePolylines(
    drawn,
    data?.color,
    object,
    selection.selectedId,
  );
  useFilamentLayers(polylines, halfThickness);
  return null;
}

function EditedFilaments() {
  const { scene } = useScene();
  const { editing, edit } = useFilamentEditing();
  const { data: objects } = useObjects();
  const object = objects?.find((o) => o.name === editing?.objectName);
  const drawn = useMemo(
    () =>
      [...edit.filaments.values()].map((f) => ({
        instanceId: f.instanceId,
        points: f.points,
        radius: f.radius,
      })),
    [edit.filaments],
  );
  const color = editing?.color;
  const { polylines, halfThickness, perUnit } = usePolylines(
    drawn,
    color,
    object,
    edit.activeId,
  );
  useFilamentLayers(polylines, halfThickness);

  const handles = useMemo<FilamentHandle[]>(() => {
    if (!color) return [];
    const all: FilamentHandle[] = [];
    const ids = new Set([...edit.filaments.keys(), ...edit.pending.keys()]);
    for (const id of ids) {
      const c = instanceColor(id, color);
      for (const p of controls(edit, id))
        all.push({
          position: angstromToWorld(p, perUnit),
          color: c,
          active: id === edit.activeId,
        });
    }
    return all;
  }, [edit, color, perUnit]);

  usePerViewportLayers(
    PLANES,
    scene && handles.length > 0
      ? (view) =>
          new FilamentHandlesLayer({
            handles,
            view: view as (typeof PLANES)[number],
            sliceCoords: scene.sliceCoords,
            halfThickness,
          })
      : null,
    [handles, halfThickness],
  );
  return null;
}

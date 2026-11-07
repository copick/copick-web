/**
 * Display opacity of each object label in multilabel segmentations (paintings, proposals, panoptic label channels).
 *
 * Display only: nothing here touches segmentation voxels or the copick config. The object's configured colour alpha
 * (Object types dialog) still scales the result. Background is drawn fainter by default so the structures painted
 * on top of it stay readable (and, below MESH_MIN_OPACITY, is not meshed in 3D); unknown (0) is always transparent
 * and is not adjustable. Changes are kept per project
 * in this browser's localStorage, so they survive reloads.
 */

import { useCallback, useSyncExternalStore } from "react";
import { readStored, writeStored } from "@/idetik/lifecycle";
import { LABEL_ALPHA } from "./labelColors";

/** Default display opacity of a class named "background". */
export const BACKGROUND_ALPHA = 0.15;

/**
 * 3D meshes are opaque (idetik's mesh shader ignores alpha), so a label displayed fainter than this is left out of
 * them instead of hiding everything behind a solid shell; slices and 3D dots still show it.
 */
export const MESH_MIN_OPACITY = 0.25;

/** Saved opacity per label value (0-1). */
export type LabelOpacities = Readonly<Record<string, number>>;

const EMPTY: LabelOpacities = Object.freeze({});
const listeners = new Set<() => void>();
const cache = new Map<string, LabelOpacities>();

function storageKey(projectId: string): string {
  return `copick-web.labelOpacity.v1.${projectId}`;
}

function isOpacities(value: unknown): value is LabelOpacities {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1,
    )
  );
}

function read(projectId: string): LabelOpacities {
  let value = cache.get(projectId);
  if (!value) {
    value = readStored(storageKey(projectId), isOpacities, EMPTY);
    cache.set(projectId, value);
  }
  return value;
}

function write(projectId: string, value: LabelOpacities): void {
  cache.set(projectId, value);
  if (Object.keys(value).length) writeStored(storageKey(projectId), value);
  else {
    try {
      globalThis.localStorage?.removeItem(storageKey(projectId));
    } catch {
      /* Storage is optional. */
    }
  }
  for (const listener of listeners) listener();
}

export function isBackgroundName(name: string | null | undefined): boolean {
  return name?.trim().toLowerCase() === "background";
}

/** The default display opacity of a class. */
export function defaultLabelOpacity(name: string | null | undefined): number {
  return isBackgroundName(name) ? BACKGROUND_ALPHA : LABEL_ALPHA;
}

/** The display opacity of a label: the saved value, else the class default. */
export function labelOpacity(
  saved: LabelOpacities,
  label: number,
  name: string | null | undefined,
): number {
  return saved[String(label)] ?? defaultLabelOpacity(name);
}

/** The opacity a label gets in opaque 3D meshes: 0 (omitted) when it is displayed fainter than MESH_MIN_OPACITY. */
export function meshLabelOpacity(opacity: number): number {
  return opacity < MESH_MIN_OPACITY ? 0 : opacity;
}

/** The saved opacities of a project. */
export const readLabelOpacities = read;

/** Save one label's display opacity (clamped to 0-1) for a project. */
export function saveLabelOpacity(
  projectId: string,
  label: number,
  opacity: number,
): void {
  write(projectId, {
    ...read(projectId),
    [String(label)]: Math.min(1, Math.max(0, opacity)),
  });
}

/** Forget a project's saved opacities: every class returns to its default. */
export function resetLabelOpacities(projectId: string): void {
  write(projectId, EMPTY);
}

/** The saved opacities of a project and setters; re-renders when any view changes them. */
export function useLabelOpacities(projectId: string) {
  const saved = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => read(projectId),
  );
  const setOpacity = useCallback(
    (label: number, opacity: number) =>
      saveLabelOpacity(projectId, label, opacity),
    [projectId],
  );
  const reset = useCallback(() => resetLabelOpacities(projectId), [projectId]);
  return { saved, setOpacity, reset };
}

/** Test hook: forget cached values so the next read comes from storage. */
export function clearLabelOpacityCache(): void {
  cache.clear();
}

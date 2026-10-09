/**
 * Scene lifecycle helpers (adapted from apex-agent; see NOTICE.md).
 */

/** A disposed view must not let Idetik's pending queue start more network work. */
export async function withSceneSignal<T>(
  scene: AbortSignal,
  request: AbortSignal,
  load: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (scene.aborted || request.aborted)
    throw new DOMException("Viewer disposed", "AbortError");
  const controller = new AbortController();
  const abort = () => controller.abort();
  scene.addEventListener("abort", abort, { once: true });
  request.addEventListener("abort", abort, { once: true });
  try {
    return await load(controller.signal);
  } finally {
    scene.removeEventListener("abort", abort);
    request.removeEventListener("abort", abort);
  }
}

export function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === "AbortError";
}

/** Read a JSON value from localStorage; storage is optional (private / embedded browsers). */
export function readStored<T>(
  key: string,
  validate: (value: unknown) => value is T,
  fallback: T,
): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw == null) return fallback;
    const value: unknown = JSON.parse(raw);
    return validate(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* Private/embedded browsers may disallow persistence. */
  }
}

// Versioned: v2 changed the default to XY + 3D, so earlier saved preferences don't hide the new default.
const VISIBILITY_KEY = "copick-web.viewer.visiblePanes.v2";

/** Default panes (XY, XZ, YZ, 3D): the XY slice next to the 3D view. */
export const DEFAULT_VISIBLE_PANES = [true, false, false, true];

export function isPaneVisibility(value: unknown): value is boolean[] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((v) => typeof v === "boolean") &&
    value.some(Boolean)
  );
}

/** Visible panes (XY, XZ, YZ, 3D); an all-hidden preference never traps the viewer. */
export function readVisiblePanels(): boolean[] {
  return readStored(VISIBILITY_KEY, isPaneVisibility, [
    ...DEFAULT_VISIBLE_PANES,
  ]);
}

export function saveVisiblePanels(value: boolean[]): void {
  writeStored(VISIBILITY_KEY, value);
}

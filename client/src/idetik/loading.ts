import type { ViewportChunkStats } from "@idetik/core";

/**
 * The viewports idetik reports as fully drawn: every chunk visible at their layers' current LOD is on the GPU.
 * Viewports with nothing requested yet (or no chunked layers, which idetik omits) are not loaded.
 */
export function loadedViewports(
  viewports: readonly ViewportChunkStats[],
): Set<string> {
  const loaded = new Set<string>();
  for (const { viewportId, current } of viewports)
    if (current.requested > 0 && current.resident === current.requested)
      loaded.add(viewportId);
  return loaded;
}

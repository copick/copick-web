import type { QueryClient } from "@tanstack/react-query";

export const revisionKey = (projectId: string) => ["data-revision", projectId];
const derived = new Set(["instances", "surface", "isosurface"]);

/** Call after the server has reopened the project and cleared its derived caches.
 * Cancel old reads before changing generations. In particular, do not refetch
 * an isosurface with the old idetik loader: its chunks may still be cached.
 */
export async function refreshProjectData(
  client: QueryClient,
  projectId: string,
) {
  await client.cancelQueries({ predicate: (q) => q.queryKey[1] === projectId });
  client.setQueryData(revisionKey(projectId), crypto.randomUUID());
  await client.invalidateQueries({
    predicate: (q) =>
      q.queryKey[1] === projectId &&
      q.queryKey[0] !== "data-revision" &&
      !derived.has(String(q.queryKey[0])),
  });
}

/** Reopen mutable proxied stores under a fresh HTTP cache key as well as a new
 * idetik source identity. Zarrita propagates the root's query to chunk URLs.
 * External URLs may be signed: leave them intact. Such hosts must publish
 * immutable URLs or require revalidation themselves.
 */
export function segmentationSourceUrl(url: string, revision: string): string {
  if (revision === "initial") return url;
  const source = new URL(url, window.location.href);
  if (
    source.origin !== window.location.origin ||
    !/\/zarr\/[^/]+\/(seg|segmentation)\//.test(source.pathname)
  )
    return url;
  source.searchParams.set("copick_revision", revision);
  return source.href;
}

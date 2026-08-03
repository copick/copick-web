/**
 * Resolve a `zarr_url` from the API into a URL the browser can fetch.
 */
export function resolveZarrUrl(zarrUrl: string): string {
  return new URL(zarrUrl, window.location.origin).href;
}

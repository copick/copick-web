/**
 * Run thumbnails for the gallery: fetched on demand (cards ask when they
 * scroll into view), a few at a time, and kept so the gallery reopens
 * instantly. The kept thumbnails are bounded: at most MAX_ENTRIES, none older
 * than MAX_AGE_MS (swept every SWEEP_MS); dropped ones release their blob URL
 * and are fetched again if a card still needs them.
 */

import { useSyncExternalStore } from "react";
import { API_BASE } from "@/api/client";

export type Thumbnail =
  | { state: "loading" }
  | { state: "ready"; url: string; tomoType: string; voxelSize: number }
  | { state: "error"; message: string };

const MAX_IN_FLIGHT = 4;
export const THUMBNAIL_SIZE = 256;
export const MAX_ENTRIES = 400;
export const MAX_AGE_MS = 30 * 60 * 1000;
const SWEEP_MS = 5 * 60 * 1000;

/** Thumbnails by run, oldest first; bounded in count and age. */
export class ThumbnailStore {
  private readonly items = new Map<string, { value: Thumbnail; at: number }>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly maxEntries = MAX_ENTRIES,
    private readonly maxAgeMs = MAX_AGE_MS,
    private readonly now: () => number = () => Date.now(),
    private readonly release: (url: string) => void = (url) =>
      URL.revokeObjectURL(url),
  ) {}

  get size(): number {
    return this.items.size;
  }

  get(run: string): Thumbnail | undefined {
    return this.items.get(run)?.value;
  }

  has(run: string): boolean {
    return this.items.has(run);
  }

  set(run: string, value: Thumbnail): void {
    const old = this.items.get(run);
    this.items.delete(run); // re-insert: newest last
    if (
      old &&
      old.value.state === "ready" &&
      (value.state !== "ready" || value.url !== old.value.url)
    )
      this.release(old.value.url);
    this.items.set(run, { value, at: this.now() });
    this.evict();
    this.notify();
  }

  /** Drop thumbnails older than the max age; returns how many. */
  sweep(): number {
    const limit = this.now() - this.maxAgeMs;
    let dropped = 0;
    for (const [run, { value, at }] of this.items) {
      if (at >= limit || value.state === "loading") continue;
      this.drop(run);
      dropped++;
    }
    if (dropped) this.notify();
    return dropped;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private evict(): void {
    // Oldest first; thumbnails still loading are kept (their request is in flight).
    for (const [run, { value }] of this.items) {
      if (this.items.size <= this.maxEntries) break;
      if (value.state !== "loading") this.drop(run);
    }
  }

  private drop(run: string): void {
    const entry = this.items.get(run);
    if (entry?.value.state === "ready") this.release(entry.value.url);
    this.items.delete(run);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}

const store = new ThumbnailStore();
const queue: string[] = [];
let inFlight = 0;

if (typeof window !== "undefined")
  window.setInterval(() => store.sweep(), SWEEP_MS);

function pump() {
  while (inFlight < MAX_IN_FLIGHT && queue.length) {
    const run = queue.shift()!;
    inFlight++;
    fetch(
      `${API_BASE}/runs/${encodeURIComponent(run)}/thumbnail?size=${THUMBNAIL_SIZE}`,
    )
      .then(async (response) => {
        if (response.status === 404) throw new Error("No tomogram");
        if (!response.ok)
          throw new Error(`Preview unavailable (${response.status})`);
        const blob = await response.blob();
        store.set(run, {
          state: "ready",
          url: URL.createObjectURL(blob),
          tomoType: response.headers.get("X-Copick-Tomo-Type") ?? "",
          voxelSize: Number(response.headers.get("X-Copick-Voxel-Size")),
        });
      })
      .catch((e: unknown) =>
        store.set(run, {
          state: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
      )
      .finally(() => {
        inFlight--;
        pump();
      });
  }
}

/** Ask for a run's thumbnail (once while it is kept; later calls are no-ops). */
export function requestThumbnail(run: string): void {
  if (store.has(run)) return;
  queue.push(run);
  store.set(run, { state: "loading" });
  pump();
}

/** A run's thumbnail, or undefined until it is requested (or after it was dropped). */
export function useThumbnail(run: string): Thumbnail | undefined {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.get(run),
  );
}

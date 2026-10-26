/**
 * Segmentation isosurfaces for the 3D view: read a segmentation level through idetik's chunk loader, then mesh it
 * in a worker (vtk.js marching cubes and smoothing, loaded only there).
 */

import type { ChunkLoaderLike } from "@/idetik/ChannelViewSource";
import type { LabelVolume, MeshOptions, MeshResult } from "./mesher";
import { readLabelVolume } from "./readLabelVolume";

export type { LabelMesh } from "./mesher";

/** Enough for a dense membrane at 2× (about 300k triangles in 10521) with room to spare. */
const MAX_TRIANGLES = 1_000_000;

export interface SegmentationMeshes extends MeshResult {
  /** The level read and the total coarsening (stored levels aside) the meshes were made at. */
  lod: number;
  factor: number;
}

/** Mesh every value of a segmentation (one loader per channel). */
export async function segmentationMeshes(
  loaders: ChunkLoaderLike[],
  signal: AbortSignal,
): Promise<SegmentationMeshes> {
  const volume = await readLabelVolume(loaders, signal);
  const result = await inWorker(
    volume,
    { smooth: true, maxTriangles: MAX_TRIANGLES },
    signal,
  );
  return { ...result, lod: volume.lod, factor: volume.factor * result.factor };
}

function inWorker(
  volume: LabelVolume,
  options: MeshOptions,
  signal: AbortSignal,
): Promise<MeshResult> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(
      new URL("./isosurface.worker.ts", import.meta.url),
      { type: "module" },
    );
    const done = () => {
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      done();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({
      data,
    }: MessageEvent<{ result?: MeshResult; error?: string }>) => {
      done();
      if (data.result) resolve(data.result);
      else reject(new Error(data.error ?? "Meshing failed"));
    };
    worker.onerror = (event) => {
      done();
      reject(new Error(event.message || "The meshing worker failed"));
    };
    // The volume is handed over, not copied.
    worker.postMessage(
      { volume, options },
      volume.channels.map((c) => c.buffer),
    );
  });
}

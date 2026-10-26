/**
 * Read a whole segmentation level into memory for meshing, through idetik's chunk loader (the same reader, store
 * URLs and codecs as the 2D label layers; see `ChannelViewSource.ts` for the loader contract).
 *
 * The finest level with at most `maxVoxels` voxels is read. When even the coarsest level is larger (single-level
 * stores), it is coarsened by a power of two while it is assembled, each block keeping its largest value so
 * structures one voxel thin survive.
 */

import type { ChunkLike, ChunkLoaderLike } from "@/idetik/ChannelViewSource";
import {
  mergeMax,
  type LabelArray,
  type LabelVolume,
  type XYZ,
} from "./volume";

/** About 2 s of meshing in a worker (vtk.js marching cubes and smoothing). */
export const MAX_VOXELS = 32_000_000;
/** Chunks requested at once. */
const CONCURRENCY = 6;

export interface ReadVolume extends LabelVolume {
  lod: number;
  /** Coarsening applied while reading (1 = the level as stored). */
  factor: number;
}

/**
 * @param loaders - One loader per channel: the source's own, or one per channel of a panoptic segmentation (both
 *   read chunk by chunk together, so coarsening keeps (label, instance) pairs).
 */
export async function readLabelVolume(
  loaders: ChunkLoaderLike[],
  signal: AbortSignal,
  maxVoxels = MAX_VOXELS,
): Promise<ReadVolume> {
  const dims = loaders[0].getSourceDimensionMap();
  if (!dims.z) throw new Error("The segmentation has no z axis");
  const axes = [dims.x, dims.y, dims.z];
  const voxels = (lod: number, f = 1) =>
    axes.reduce((n, a) => n * Math.ceil(a.lods[lod].size / f), 1);
  let lod = 0;
  while (lod < dims.numLods - 1 && voxels(lod) > maxVoxels) lod++;
  let factor = 1;
  while (voxels(lod, factor) > maxVoxels) factor *= 2;

  const levels = axes.map((a) => a.lods[lod]);
  const full = levels.map((l) => l.size) as XYZ;
  const chunk = levels.map((l) => l.chunkSize) as XYZ;
  const size = full.map((s) => Math.ceil(s / factor)) as XYZ;
  const counts = full.map((s, a) => Math.ceil(s / chunk[a]));
  const jobs: XYZ[] = [];
  for (let z = 0; z < counts[2]; z++)
    for (let y = 0; y < counts[1]; y++)
      for (let x = 0; x < counts[0]; x++) jobs.push([x, y, z]);

  let channels: LabelArray[] | null = null;
  const read = async (index: XYZ) => {
    const start = index.map((i, a) => i * chunk[a]) as XYZ;
    const shape = start.map((s, a) => Math.min(chunk[a], full[a] - s)) as XYZ;
    const data = await Promise.all(
      loaders.map((loader) => loadChunk(loader, lod, index, shape, signal)),
    );
    channels ??= data.map(
      (d) =>
        new (d.constructor as new (n: number) => LabelArray)(
          size[0] * size[1] * size[2],
        ),
    );
    place(channels, size, factor, data, start, shape);
  };
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
      while (next < jobs.length) {
        signal.throwIfAborted();
        await read(jobs[next++]);
      }
    }),
  );
  if (!channels) throw new Error("The segmentation is empty");
  return {
    channels,
    size,
    origin: levels.map(
      (l) => l.translation + ((factor - 1) / 2) * l.scale,
    ) as XYZ,
    spacing: levels.map((l) => l.scale * factor) as XYZ,
    lod,
    factor,
  };
}

async function loadChunk(
  loader: ChunkLoaderLike,
  lod: number,
  [x, y, z]: XYZ,
  [sx, sy, sz]: XYZ,
  signal: AbortSignal,
): Promise<LabelArray> {
  const chunk: ChunkLike = {
    state: "loading",
    lod,
    shape: { x: sx, y: sy, z: sz, c: 1 },
    rowAlignmentBytes: 1,
    chunkIndex: { x, y, z, c: 0, t: 0 },
    scale: { x: 1, y: 1, z: 1 },
    offset: { x: 0, y: 0, z: 0 },
    visible: false,
    prefetch: false,
    priority: null,
    orderKey: null,
  };
  await loader.loadChunkData(chunk, signal);
  if (!chunk.data) throw new Error("A segmentation chunk did not load");
  return chunk.data;
}

/** Copy one chunk (x fastest, cut to `shape`) into the volume, coarsened by `factor`. */
function place(
  dest: LabelArray[],
  size: XYZ,
  factor: number,
  src: LabelArray[],
  [x0, y0, z0]: XYZ,
  [sx, sy, sz]: XYZ,
): void {
  for (let z = 0; z < sz; z++)
    for (let y = 0; y < sy; y++) {
      const row = (z * sy + y) * sx;
      if (factor === 1) {
        const out = ((z0 + z) * size[1] + y0 + y) * size[0] + x0;
        dest.forEach((d, c) => d.set(src[c].subarray(row, row + sx), out));
        continue;
      }
      const out =
        (Math.floor((z0 + z) / factor) * size[1] +
          Math.floor((y0 + y) / factor)) *
        size[0];
      for (let x = 0; x < sx; x++)
        mergeMax(dest, out + Math.floor((x0 + x) / factor), src, row + x);
    }
}

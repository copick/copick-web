import { describe, expect, test } from "vitest";
import type { ChunkLike, ChunkLoaderLike } from "@/idetik/ChannelViewSource";
import { readLabelVolume } from "./readLabelVolume";

type Dims = ReturnType<ChunkLoaderLike["getSourceDimensionMap"]>;

/**
 * A loader over in-memory levels (x fastest), cutting chunks to the requested shape the way idetik's OME-Zarr
 * loader does. Levels halve in size; each has the given chunk size.
 */
function fakeLoader(
  levels: { size: [number, number, number]; data: Uint16Array }[],
  chunkSize: number,
  { scale = 10, translation = 5 } = {},
): ChunkLoaderLike & { requests: number } {
  const axis = (a: number, name: string) => ({
    name,
    index: 2 - a,
    unit: "angstrom",
    lods: levels.map((l, lod) => ({
      size: l.size[a],
      chunkSize,
      scale: scale * 2 ** lod,
      translation: translation + (scale * (2 ** lod - 1)) / 2,
    })),
  });
  const dims = {
    x: axis(0, "x"),
    y: axis(1, "y"),
    z: axis(2, "z"),
    numLods: levels.length,
  } as Dims;
  const loader = {
    requests: 0,
    getSourceDimensionMap: () => dims,
    getBytesPerElement: () => 2,
    loadChunkData: async (chunk: ChunkLike, signal: AbortSignal) => {
      signal.throwIfAborted();
      loader.requests++;
      const { size, data } = levels[chunk.lod];
      const { x: sx, y: sy, z: sz } = chunk.shape;
      const out = new Uint16Array(sx * sy * sz);
      let i = 0;
      for (let z = 0; z < sz; z++)
        for (let y = 0; y < sy; y++)
          for (let x = 0; x < sx; x++, i++) {
            const gx = chunk.chunkIndex.x * chunkSize + x;
            const gy = chunk.chunkIndex.y * chunkSize + y;
            const gz = chunk.chunkIndex.z * chunkSize + z;
            out[i] = data[(gz * size[1] + gy) * size[0] + gx];
          }
      chunk.data = out;
    },
  };
  return loader;
}

function level(
  size: [number, number, number],
  value: (x: number, y: number, z: number) => number,
) {
  const data = new Uint16Array(size[0] * size[1] * size[2]);
  let i = 0;
  for (let z = 0; z < size[2]; z++)
    for (let y = 0; y < size[1]; y++)
      for (let x = 0; x < size[0]; x++, i++) data[i] = value(x, y, z);
  return { size, data };
}

const signal = () => new AbortController().signal;

describe("readLabelVolume", () => {
  test("assembles every chunk, edge chunks cut short, at the finest level that fits", async () => {
    const fine = level([10, 7, 5], (x, y, z) => x + 10 * y + 100 * z);
    const loader = fakeLoader([fine], 4);
    const v = await readLabelVolume([loader], signal(), 1000);
    expect(v.lod).toBe(0);
    expect(v.factor).toBe(1);
    expect(v.size).toEqual([10, 7, 5]);
    expect([...v.channels[0]]).toEqual([...fine.data]);
    expect(loader.requests).toBe(3 * 2 * 2);
    expect(v.origin).toEqual([5, 5, 5]);
    expect(v.spacing).toEqual([10, 10, 10]);
  });

  test("uses a coarser stored level when the finest is too big", async () => {
    const fine = level([8, 8, 8], () => 1);
    const coarse = level([4, 4, 4], () => 2);
    const v = await readLabelVolume(
      [fakeLoader([fine, coarse], 4)],
      signal(),
      100,
    );
    expect(v.lod).toBe(1);
    expect(v.factor).toBe(1);
    expect(v.channels[0].every((x) => x === 2)).toBe(true);
    // The level's own transform: voxel 0 of level 1 covers fine voxels 0-1.
    expect(v.origin).toEqual([10, 10, 10]);
    expect(v.spacing).toEqual([20, 20, 20]);
  });

  test("coarsens a single level by block maximum when even it is too big", async () => {
    // A one-voxel-thin plane at z = 5 survives 2× coarsening.
    const fine = level([8, 8, 8], (_x, _y, z) => (z === 5 ? 3 : 0));
    const v = await readLabelVolume([fakeLoader([fine], 3)], signal(), 100);
    expect(v.factor).toBe(2);
    expect(v.size).toEqual([4, 4, 4]);
    const planes = [0, 1, 2, 3].map((z) => v.channels[0][z * 16]);
    expect(planes).toEqual([0, 0, 3, 0]);
    expect(v.origin).toEqual([10, 10, 10]);
    expect(v.spacing).toEqual([20, 20, 20]);
  });

  test("reads the channels of a panoptic segmentation together", async () => {
    const labels = level([4, 4, 4], (x) => (x < 2 ? 1 : 2));
    const instances = level([4, 4, 4], (x) => x);
    const v = await readLabelVolume(
      [fakeLoader([labels], 2), fakeLoader([instances], 2)],
      signal(),
      1000,
    );
    expect(v.channels.map((c) => [...c.slice(0, 4)])).toEqual([
      [1, 1, 2, 2],
      [0, 1, 2, 3],
    ]);
  });

  test("stops when aborted", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      readLabelVolume(
        [fakeLoader([level([4, 4, 4], () => 1)], 2)],
        abort.signal,
      ),
    ).rejects.toThrow();
  });
});

import { describe, expect, test } from "vitest";
import {
  ChannelViewSource,
  type ChunkLike,
  type ChunkLoaderLike,
} from "./ChannelViewSource";

const lod = { size: 8, chunkSize: 4, scale: 1, translation: 0 };

function fakeBase(withChannels = true) {
  const requests: ChunkLike[] = [];
  const loader = {
    getSourceDimensionMap: () => ({
      x: { name: "x", index: 3, lods: [lod] },
      y: { name: "y", index: 2, lods: [lod] },
      z: { name: "z", index: 1, lods: [lod] },
      ...(withChannels
        ? {
            c: {
              name: "c",
              index: 0,
              lods: [{ size: 2, chunkSize: 1, scale: 1, translation: 0 }],
            },
          }
        : {}),
      numLods: 1,
    }),
    getBytesPerElement: () => 2,
    loadChunkData: async (chunk: ChunkLike) => {
      requests.push(chunk);
      chunk.data = new Uint16Array(4).fill(chunk.chunkIndex.c + 1);
      chunk.rowAlignmentBytes = 2;
    },
  } as unknown as ChunkLoaderLike;
  return { source: { loader }, requests };
}

function chunk(): ChunkLike {
  return {
    state: "loading",
    lod: 0,
    shape: { x: 4, y: 4, z: 4, c: 1 },
    rowAlignmentBytes: 1,
    chunkIndex: { x: 1, y: 0, z: 1, c: 0, t: 0 },
    scale: { x: 1, y: 1, z: 1 },
    offset: { x: 4, y: 0, z: 4 },
    visible: true,
    prefetch: false,
    priority: 0,
    orderKey: 0,
  };
}

describe("ChannelViewSource", () => {
  test("exposes a single-channel dimension map", () => {
    const { source } = fakeBase();
    const view = new ChannelViewSource(source, 1);
    const dims = view.loader.getSourceDimensionMap();
    expect(dims.c).toBeUndefined();
    expect(dims.x.lods[0].size).toBe(8);
    expect(view.loader.getBytesPerElement()).toBe(2);
  });

  test("forwards chunk requests for its channel without touching the cached chunk's indices", async () => {
    const { source, requests } = fakeBase();
    const view = new ChannelViewSource(source, 1);
    const target = chunk();
    await view.loader.loadChunkData(target, new AbortController().signal);
    expect(requests).toHaveLength(1);
    expect(requests[0].chunkIndex).toEqual({ x: 1, y: 0, z: 1, c: 1, t: 0 });
    expect(target.chunkIndex.c).toBe(0);
    expect(Array.from(target.data as Uint16Array)).toEqual([2, 2, 2, 2]);
    expect(target.rowAlignmentBytes).toBe(2);

    const label = chunk();
    await new ChannelViewSource(source, 0).loader.loadChunkData(
      label,
      new AbortController().signal,
    );
    expect(Array.from(label.data as Uint16Array)).toEqual([1, 1, 1, 1]);
  });

  test("refuses sources without channels and channels out of range", () => {
    expect(() => new ChannelViewSource(fakeBase(false).source, 0)).toThrow(
      /channel/,
    );
    expect(() => new ChannelViewSource(fakeBase().source, 2)).toThrow(
      /out of range/,
    );
  });
});

import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ChunkLike, ChunkLoaderLike } from "./ChannelViewSource";
import {
  EditableLabelSource,
  labelSourceKey,
  refreshLabelRegion,
  registerLabelSource,
} from "./labelRefresh";

// A 1-level 8x4x4 (x, y, z) label volume in 4^3 chunks, voxel size 10 Å, origin 5 Å: two chunks along x.
const dims = {
  x: {
    name: "x",
    index: 2,
    lods: [{ size: 8, chunkSize: 4, scale: 10, translation: 5 }],
  },
  y: {
    name: "y",
    index: 1,
    lods: [{ size: 4, chunkSize: 4, scale: 10, translation: 5 }],
  },
  z: {
    name: "z",
    index: 0,
    lods: [{ size: 4, chunkSize: 4, scale: 10, translation: 5 }],
  },
  numLods: 1,
};

function chunk(x: number): ChunkLike {
  return {
    state: "loading",
    lod: 0,
    shape: { x: 4, y: 4, z: 4, c: 1 },
    rowAlignmentBytes: 1,
    chunkIndex: { x, y: 0, z: 0, c: 0, t: 0 },
    scale: { x: 10, y: 10, z: 10 },
    offset: { x: 5 + 40 * x, y: 5, z: 5 },
    visible: true,
    prefetch: false,
    priority: 0,
    orderKey: 0,
  };
}

function texture() {
  return {
    needsUpdate: false,
    data_: null as Uint8Array | null,
    get data() {
      return this.data_;
    },
    set data(d: Uint8Array | null) {
      this.data_ = d;
      this.needsUpdate = true;
    },
    releaseCpuData() {
      this.data_ = null;
    },
  };
}

function setup() {
  const stored = [1, 1];
  const reads: number[] = [];
  let gate: Promise<void> | null = null;
  const read: ChunkLoaderLike["loadChunkData"] = async (c) => {
    reads.push(c.chunkIndex.x);
    const value = stored[c.chunkIndex.x];
    if (gate) await gate;
    c.data = new Uint8Array(64).fill(value);
  };
  const loader = {
    getSourceDimensionMap: () => dims,
    getBytesPerElement: () => 1,
    loadChunkData: read,
  } as unknown as ChunkLoaderLike;
  let renders = 0;
  const source = new EditableLabelSource(
    loader,
    read,
    () => renders++,
    new AbortController().signal,
  );
  return {
    source,
    stored,
    reads,
    renders: () => renders,
    hold: () => {
      let open = () => {};
      gate = new Promise((r) => (open = r));
      return () => {
        gate = null;
        open();
      };
    },
  };
}

async function resident(source: EditableLabelSource, x: number) {
  const c = chunk(x);
  await source.load(c, new AbortController().signal);
  c.state = "loaded";
  c.texture = texture() as unknown as ChunkLike["texture"];
  c.texture!.data = c.data!;
  c.texture!.needsUpdate = false;
  c.data = undefined;
  return c;
}

beforeAll(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
});

describe("EditableLabelSource", () => {
  it("re-reads only the drawn chunks inside the region, into their textures", async () => {
    const t = setup();
    const left = await resident(t.source, 0);
    const right = await resident(t.source, 1);
    t.reads.length = 0;
    t.stored[0] = 7;
    // Voxels x 1..3 lie in the left chunk only.
    expect(
      await t.source.refresh([
        [1, 3],
        [0, 4],
        [0, 4],
      ]),
    ).toBe(1);
    expect(t.reads).toEqual([0]);
    expect(left.texture!.data![0]).toBe(7);
    expect(left.texture!.needsUpdate).toBe(true);
    expect(right.texture!.needsUpdate).toBe(false);
    expect(t.renders()).toBe(1);
  });

  it("covers every chunk a region spans, and none outside it", async () => {
    const t = setup();
    await resident(t.source, 0);
    await resident(t.source, 1);
    t.reads.length = 0;
    expect(
      await t.source.refresh([
        [3, 5],
        [0, 1],
        [0, 1],
      ]),
    ).toBe(2);
    expect(t.reads.sort()).toEqual([0, 1]);
    t.reads.length = 0;
    expect(
      await t.source.refresh([
        [0, 4],
        [4, 6],
        [0, 1],
      ]),
    ).toBe(0);
    expect(t.reads).toEqual([]);
    expect(t.renders()).toBe(1);
  });

  it("repeats a chunk read that an edit overlapped", async () => {
    const t = setup();
    const c = chunk(0);
    const release = t.hold();
    const loading = t.source.load(c, new AbortController().signal);
    t.stored[0] = 9;
    // Not drawn yet: nothing to re-read now, but the in-flight read must not deliver the old value.
    expect(
      await t.source.refresh([
        [0, 1],
        [0, 1],
        [0, 1],
      ]),
    ).toBe(0);
    release();
    await loading;
    expect(c.data![0]).toBe(9);
    expect(t.reads).toEqual([0, 0]);
  });

  it("keeps the later of two overlapping refreshes", async () => {
    const t = setup();
    const c = await resident(t.source, 0);
    t.stored[0] = 2;
    const release = t.hold();
    const first = t.source.refresh([
      [0, 1],
      [0, 1],
      [0, 1],
    ]);
    release();
    t.stored[0] = 3;
    const second = t.source.refresh([
      [0, 1],
      [0, 1],
      [0, 1],
    ]);
    await Promise.all([first, second]);
    expect(c.texture!.data![0]).toBe(3);
  });

  it("is found by key while registered", async () => {
    const t = setup();
    await resident(t.source, 0);
    const key = labelSourceKey("p", "run", "multilabel:painting:u:1:10");
    const unregister = registerLabelSource(key, t.source);
    expect(
      await refreshLabelRegion(key, [
        [0, 1],
        [0, 1],
        [0, 1],
      ]),
    ).toBe(1);
    unregister();
    expect(
      await refreshLabelRegion(key, [
        [0, 1],
        [0, 1],
        [0, 1],
      ]),
    ).toBeNull();
  });
});

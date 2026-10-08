/**
 * A single-channel view of a multi-channel chunk source.
 *
 * idetik 0.35's `LabelLayer` refuses multi-channel sources, but a panoptic
 * segmentation is a `(2, Z, Y, X)` store (channel 0: object label, channel 1:
 * instance ID). This wrapper exposes one channel as a `(Z, Y, X)` source: its
 * dimension map has no `c` axis, and each chunk request is forwarded to the
 * base loader with `chunkIndex.c` set to the chosen channel.
 *
 * It relies on idetik's structural `ChunkSource` contract (a `loader` with
 * `getSourceDimensionMap`, `getBytesPerElement` and `loadChunkData`) and on
 * the base OME-Zarr loader deriving the channel from `chunk.chunkIndex.c`;
 * `@idetik/core` is pinned to exactly 0.35.0 for that reason.
 *
 * Share one view per (source, channel) between layers: idetik keys its chunk
 * cache by source identity.
 */

import type { OmeZarrImageSource } from "@idetik/core";

type BaseLoader = OmeZarrImageSource["loader"];
export type ChunkLoaderLike = Pick<
  BaseLoader,
  "getSourceDimensionMap" | "getBytesPerElement" | "loadChunkData"
>;
export type ChunkLike = Parameters<BaseLoader["loadChunkData"]>[0];
type DimensionMap = ReturnType<BaseLoader["getSourceDimensionMap"]>;

export class ChannelViewSource {
  private readonly loader_: ChunkLoaderLike;

  constructor(
    base: { readonly loader: ChunkLoaderLike },
    readonly channel: number,
  ) {
    const baseLoader = base.loader;
    const dims = baseLoader.getSourceDimensionMap();
    const channels = dims.c?.lods[0]?.size;
    if (channels === undefined) {
      throw new Error(
        "ChannelViewSource needs a source with a channel (c) axis.",
      );
    }
    if (!Number.isInteger(channel) || channel < 0 || channel >= channels) {
      throw new Error(
        `Channel ${channel} is out of range (source has ${channels} channels).`,
      );
    }
    const { c: _c, ...spatial } = dims;
    void _c;
    const view: DimensionMap = spatial;
    this.loader_ = {
      getSourceDimensionMap: () => view,
      getBytesPerElement: () => baseLoader.getBytesPerElement(),
      loadChunkData: async (chunk: ChunkLike, signal: AbortSignal) => {
        // Forward a copy so the chunk the cache tracks keeps its own indices.
        const request: ChunkLike = {
          ...chunk,
          data: undefined,
          chunkIndex: { ...chunk.chunkIndex, c: channel },
          shape: { ...chunk.shape, c: 1 },
        };
        await baseLoader.loadChunkData(request, signal);
        chunk.data = request.data;
        chunk.rowAlignmentBytes = request.rowAlignmentBytes;
      },
    };
  }

  get loader(): ChunkLoaderLike {
    return this.loader_;
  }
}

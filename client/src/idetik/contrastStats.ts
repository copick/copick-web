import { OmeZarrImageSource } from "@idetik/core";

type Chunk = Parameters<OmeZarrImageSource["loader"]["loadChunkData"]>[0];

export interface Contrast {
  limits: [number, number];
  range: [number, number];
}

export async function calculateContrast(
  source: OmeZarrImageSource,
  signal: AbortSignal
): Promise<Contrast | null> {
  try {
    const dims = source.getDimensions();
    const lod = 0;
    const xLod = dims.x.lods[lod];
    const yLod = dims.y.lods[lod];
    const zLod = dims.z?.lods[lod];
    if (!zLod) return null;

    const chunkIndex = {
      x: Math.floor(xLod.size / 2 / xLod.chunkSize),
      y: Math.floor(yLod.size / 2 / yLod.chunkSize),
      z: Math.floor(zLod.size / 2 / zLod.chunkSize),
      c: 0,
      t: 0,
    };

    const chunk: Chunk = {
      state: "unloaded",
      lod,
      shape: {
        x: Math.min(xLod.chunkSize, xLod.size - chunkIndex.x * xLod.chunkSize),
        y: Math.min(yLod.chunkSize, yLod.size - chunkIndex.y * yLod.chunkSize),
        z: Math.min(zLod.chunkSize, zLod.size - chunkIndex.z * zLod.chunkSize),
        c: 1,
      },
      chunkIndex,
      scale: { x: xLod.scale, y: yLod.scale, z: zLod.scale },
      offset: { x: 0, y: 0, z: 0 },
      rowAlignmentBytes: 1,
      visible: false,
      prefetch: false,
      priority: null,
      orderKey: null,
    };

    await source.loader.loadChunkData(chunk, signal);

    const data = chunk.data;
    if (!data) return null;

    let sum = 0;
    let sumSq = 0;
    const n = data.length;
    for (let i = 0; i < n; i++) {
      const v = data[i];
      sum += v;
      sumSq += v * v;
    }

    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    return {
      limits: [mean - 3 * std, mean + 3 * std],
      range: [mean - 5 * std, mean + 5 * std],
    };
  } catch (error) {
    if (!signal.aborted) {
      console.error("[contrastStats] Failed to calculate contrast:", error);
    }
    return null;
  }
}

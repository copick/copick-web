/** Meshes label volumes off the main thread (see `mesher.ts`); started by `computeMeshes`. */

import { meshLabels, type LabelVolume, type MeshOptions } from "./mesher";

self.onmessage = ({
  data,
}: MessageEvent<{ volume: LabelVolume; options: MeshOptions }>) => {
  try {
    const result = meshLabels(data.volume, data.options);
    self.postMessage(
      { result },
      {
        transfer: result.meshes.flatMap((m) => [
          m.vertices.buffer,
          m.indices.buffer,
        ]),
      },
    );
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

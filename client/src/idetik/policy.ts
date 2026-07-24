import { createImageSourcePolicy } from "@idetik/core";

export const imageSourcePolicy = createImageSourcePolicy({
  prefetch: { x: 0, y: 0, z: 200 },
  priorityOrder: [
    "fallbackVisible",
    "visibleCurrent",
    "fallbackBackground",
    "prefetchSpace",
    "prefetchTime",
  ],
  lod: { min: 0, max: 1, bias: 1.0 },
});

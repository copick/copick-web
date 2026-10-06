import { createImageSourcePolicy } from "@idetik/core";

type ImageSourcePolicy = ReturnType<typeof createImageSourcePolicy>;

const cache = new Map<string, ImageSourcePolicy>();

/**
 * An image source policy restricted to LODs [min, max]. No prefetch: with up
 * to four views on one source, only what is visible is requested. Policies are
 * memoised so layers can compare them by identity.
 */
export function sourcePolicy(min: number, max: number): ImageSourcePolicy {
  const key = `${min}:${max}`;
  let policy = cache.get(key);
  if (!policy) {
    policy = createImageSourcePolicy({
      lod: { min, max },
      prefetch: { x: 0, y: 0, z: 0 },
      priorityOrder: [
        "fallbackVisible",
        "visibleCurrent",
        "fallbackBackground",
        "prefetchSpace",
        "prefetchTime",
      ],
    });
    cache.set(key, policy);
  }
  return policy;
}

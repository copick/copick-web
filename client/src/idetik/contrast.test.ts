import { describe, expect, test } from "vitest";
import { contrastFromData, contrastWithRange, sampleStats } from "./contrast";

describe("contrast", () => {
  test("mean ± 2.5σ from the data, ignoring non-finite samples", () => {
    const data = new Float32Array([1, 3, NaN, 1, 3, Infinity]);
    expect(sampleStats(data)).toEqual({ mean: 2, std: 1 });
    expect(contrastFromData(data)).toEqual([-0.5, 4.5]);
    expect(contrastWithRange(data)).toEqual({
      limits: [-0.5, 4.5],
      range: [-3, 7],
    });
  });

  test("constant or empty data has no contrast", () => {
    expect(contrastFromData(new Float32Array([5, 5, 5]))).toBeNull();
    expect(contrastFromData(new Float32Array([]))).toBeNull();
    expect(contrastWithRange(new Float32Array([NaN]))).toBeNull();
  });

  test("large chunks are sampled with a bounded stride", () => {
    const data = new Float32Array(1 << 20).map((_, i) => i % 3);
    const limits = contrastFromData(data);
    expect(limits).not.toBeNull();
  });
});

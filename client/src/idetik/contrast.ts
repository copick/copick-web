/**
 * Contrast estimation bounded to image data that was already requested, with
 * no extra I/O (adapted from apex-agent; see NOTICE.md).
 */

export interface SampleStats {
  mean: number;
  std: number;
}

/** Mean and standard deviation of at most ~65k evenly strided finite samples. */
export function sampleStats(data: ArrayLike<number>): SampleStats | null {
  let n = 0;
  let mean = 0;
  let m2 = 0;
  const step = Math.max(1, Math.ceil(data.length / 65536));
  for (let i = 0; i < data.length; i += step) {
    const value = data[i];
    if (!Number.isFinite(value)) continue;
    n++;
    const delta = value - mean;
    mean += delta / n;
    m2 += delta * (value - mean);
  }
  if (n === 0) return null;
  return { mean, std: Math.sqrt(m2 / Math.max(1, n)) };
}

/** Display limits of mean ± 2.5 σ, or null for constant data. */
export function contrastFromData(
  data: ArrayLike<number>,
): [number, number] | null {
  const stats = sampleStats(data);
  if (!stats || !(stats.std > 0)) return null;
  return [stats.mean - 2.5 * stats.std, stats.mean + 2.5 * stats.std];
}

export interface Contrast {
  /** Initial display limits. */
  limits: [number, number];
  /** Slider range. */
  range: [number, number];
}

/** Limits (± 2.5 σ) and a slider range (± 5 σ) from sampled data. */
export function contrastWithRange(data: ArrayLike<number>): Contrast | null {
  const stats = sampleStats(data);
  if (!stats || !(stats.std > 0)) return null;
  const { mean, std } = stats;
  return {
    limits: [mean - 2.5 * std, mean + 2.5 * std],
    range: [mean - 5 * std, mean + 5 * std],
  };
}

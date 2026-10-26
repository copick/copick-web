/**
 * Label volumes in memory, and the coarsening shared by reading (`readLabelVolume.ts`) and meshing (`mesher.ts`).
 * Free of vtk.js, so the main bundle can use it.
 */

export type LabelArray =
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Float32Array;
export type XYZ = [number, number, number];

/** A label volume: one array per channel (x fastest, then y, then z), and where its voxel centres are. */
export interface LabelVolume {
  channels: LabelArray[];
  /** Voxels along x, y, z. */
  size: XYZ;
  /** World position of the centre of voxel (0, 0, 0). */
  origin: XYZ;
  /** Distance between voxel centres along x, y, z (world units). */
  spacing: XYZ;
}

/**
 * Halve the volume's resolution: each 2×2×2 block takes its largest value (compared channel by channel, so a
 * panoptic pair stays a pair that occurs), which keeps structures one voxel thin.
 */
export function coarsen(volume: LabelVolume, f = 2): LabelVolume {
  const { channels, size, origin, spacing } = volume;
  const out = size.map((s) => Math.ceil(s / f)) as XYZ;
  const result = channels.map(
    (c) =>
      new (c.constructor as new (n: number) => LabelArray)(
        out[0] * out[1] * out[2],
      ),
  );
  let i = 0;
  for (let z = 0; z < size[2]; z++)
    for (let y = 0; y < size[1]; y++)
      for (let x = 0; x < size[0]; x++, i++) {
        const o =
          (Math.floor(z / f) * out[1] + Math.floor(y / f)) * out[0] +
          Math.floor(x / f);
        mergeMax(result, o, channels, i);
      }
  return {
    channels: result,
    size: out,
    origin: origin.map((o, a) => o + ((f - 1) / 2) * spacing[a]) as XYZ,
    spacing: spacing.map((s) => s * f) as XYZ,
  };
}

/** Keep the larger of `dest[o]` and `src[i]`, comparing channel by channel. */
export function mergeMax(
  dest: LabelArray[],
  o: number,
  src: ArrayLike<ArrayLike<number>>,
  i: number,
): void {
  for (let c = 0; c < dest.length; c++) {
    const a = dest[c][o],
      b = src[c][i];
    if (b > a) {
      for (let k = c; k < dest.length; k++) dest[k][o] = src[k][i];
      return;
    }
    if (b < a) return;
  }
}

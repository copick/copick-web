/**
 * Segmentation surfaces for the 3D view: boundary voxels from the server's
 * `surface` endpoint, coloured with the same colour maps as the 2D label
 * layers (so hidden / solo IDs and colours match the slices).
 */

import type { LabelColorMapProps } from "./labelColors";

export interface SurfacePoints {
  /** Voxel centres, (x, y, z) Å, interleaved. */
  positions: Float32Array;
  /** Labels, or (label, instance) pairs for panoptic segmentations. */
  values: Uint32Array;
  /** Values per point (1, or 2 for panoptic). */
  channels: number;
  /** Outward normals (x, y, z), interleaved; the sum of the exposed faces. */
  normals: Int8Array;
  /** Voxel size (Å) of the pyramid level the points come from. */
  voxelSize: number;
  level: number;
}

/** Decode the little-endian wire format (see the server's `encode_surface_points`). */
export function decodeSurfacePoints(buffer: ArrayBuffer): SurfacePoints {
  const view = new DataView(buffer);
  const n = view.getUint32(0, true);
  const channels = view.getUint32(4, true);
  const voxelSize = view.getFloat32(8, true);
  const level = view.getUint32(12, true);
  let offset = 16;
  const positions = new Float32Array(buffer.slice(offset, offset + 12 * n));
  offset += 12 * n;
  const values = new Uint32Array(
    buffer.slice(offset, offset + 4 * n * channels),
  );
  offset += 4 * n * channels;
  const normals = new Int8Array(buffer.slice(offset, offset + 3 * n));
  if (normals.length !== 3 * n)
    throw new Error("Truncated segmentation surface");
  return { positions, values, channels, normals, voxelSize, level };
}

type Rgba01 = [number, number, number, number];

/** The colour a LabelLayer draws `value` in: its lookup table entry, else the cycle. */
export function labelColor(map: LabelColorMapProps, value: number): Rgba01 {
  const fixed = map.lookupTable?.get(value);
  if (fixed) return fixed as Rgba01;
  const cycle = map.cycle ?? [];
  if (cycle.length === 0 || value === 0) return [0, 0, 0, 0];
  const k = (((value - 1) % cycle.length) + cycle.length) % cycle.length;
  return cycle[k] as Rgba01;
}

/**
 * How to colour a point from its values: one map per channel, in drawing order
 * (later maps win where they are not transparent, as layers stack in 2D).
 */
export type SurfaceColoring = { channel: number; map: LabelColorMapProps }[];

/** The colour of point `i`, or null when every map leaves it transparent. */
export function pointColor(
  points: SurfacePoints,
  coloring: SurfaceColoring,
  i: number,
): Rgba01 | null {
  let color: Rgba01 | null = null;
  for (const { channel, map } of coloring) {
    const c = labelColor(map, points.values[i * points.channels + channel]);
    if (c[3] > 0) color = c;
  }
  return color;
}

const KEY_LIGHT = normalize([0.35, -0.45, 0.82]);
const FILL_LIGHT = normalize([-0.5, 0.4, -0.3]);

function normalize(v: number[]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Brightness (0-1) of a point from its outward normal: a key and a fill light. */
export function shade(nx: number, ny: number, nz: number): number {
  const l = Math.hypot(nx, ny, nz);
  if (l === 0) return 0.8;
  const key = (nx * KEY_LIGHT[0] + ny * KEY_LIGHT[1] + nz * KEY_LIGHT[2]) / l;
  const fill =
    (nx * FILL_LIGHT[0] + ny * FILL_LIGHT[1] + nz * FILL_LIGHT[2]) / l;
  return Math.min(1, 0.42 + 0.5 * Math.max(0, key) + 0.18 * Math.max(0, fill));
}

/**
 * Instance colours shared by picks, filaments and instance / panoptic
 * segmentations.
 *
 * The rule is the one the Qt apps use (copick-shared-ui
 * `util/instances.py`): instance `i > 0` gets the HSV colour
 * `((i * 0.618033988749895) % 1, 0.65, 0.95)`; instance 0 (unassigned) keeps
 * the object's colour.
 *
 * Segmentations are drawn by idetik's `LabelLayer`, whose colour map looks up
 * unmapped values as `cycle[(value - 1) % cycle.length]`. `INSTANCE_PALETTE`
 * is that cycle: entry `k` is the colour of instance `k + 1`, so for IDs up to
 * `INSTANCE_PALETTE_SIZE` the palette equals the formula exactly. Larger IDs
 * wrap, and picks and filaments wrap the same way (`instanceColor`) so that
 * every web overlay agrees with the segmentation under it.
 */

export type Rgb01 = [number, number, number];
export type Rgba255 = [number, number, number, number];

export const GOLDEN_RATIO_CONJUGATE = 0.618033988749895;
export const INSTANCE_SATURATION = 0.65;
export const INSTANCE_VALUE = 0.95;
export const INSTANCE_PALETTE_SIZE = 256;

/** Python's `colorsys.hsv_to_rgb`, operation for operation. */
export function hsvToRgb(h: number, s: number, v: number): Rgb01 {
  if (s === 0) return [v, v, v];
  let i = Math.trunc(h * 6.0);
  const f = h * 6.0 - i;
  const p = v * (1.0 - s);
  const q = v * (1.0 - s * f);
  const t = v * (1.0 - s * (1.0 - f));
  i = i % 6;
  switch (i) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

/** The exact colour of an instance ID (> 0), floats 0-1. */
export function instanceRgb(instanceId: number): Rgb01 {
  return hsvToRgb(
    (instanceId * GOLDEN_RATIO_CONJUGATE) % 1.0,
    INSTANCE_SATURATION,
    INSTANCE_VALUE,
  );
}

/** `INSTANCE_PALETTE[k]` is the colour of instance `k + 1` (floats 0-1). */
export const INSTANCE_PALETTE: readonly Rgb01[] = Array.from(
  { length: INSTANCE_PALETTE_SIZE },
  (_, k) => instanceRgb(k + 1),
);

/** The palette index of an instance ID, as LabelLayer's cycle computes it. */
export function paletteIndex(instanceId: number): number {
  return (
    (((Math.trunc(instanceId) - 1) % INSTANCE_PALETTE_SIZE) +
      INSTANCE_PALETTE_SIZE) %
    INSTANCE_PALETTE_SIZE
  );
}

/**
 * The colour (0-255 RGBA) of an item with this instance ID: the palette colour
 * for IDs > 0, `base` for 0 / missing IDs. Alpha is taken from `base`.
 */
export function instanceColor(
  instanceId: number | null | undefined,
  base: Rgba255,
): Rgba255 {
  if (!instanceId || instanceId <= 0) return base;
  const [r, g, b] = INSTANCE_PALETTE[paletteIndex(instanceId)];
  return [
    Math.round(r * 255),
    Math.round(g * 255),
    Math.round(b * 255),
    base[3],
  ];
}

/** The palette as a LabelLayer `cycle` with the given alpha (0-1). */
export function instanceCycle(
  alpha: number,
): [number, number, number, number][] {
  return INSTANCE_PALETTE.map(([r, g, b]) => [r, g, b, alpha]);
}

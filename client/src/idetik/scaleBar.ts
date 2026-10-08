/** The largest "nice" length (1, 2 or 5 × 10^n) not above `x`. */
export function niceFloor(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 0;
  const exponent = Math.floor(Math.log10(x));
  const base = Math.pow(10, exponent);
  const mantissa = x / base;
  const nice = mantissa >= 5 ? 5 : mantissa >= 2 ? 2 : 1;
  return nice * base;
}

/**
 * A scale bar for a pane: the nice length that fits in `maxPixels` and the
 * bar width in pixels. `angstromPerPixel` must be measured on the pane itself
 * (not the shared canvas) so each view's bar matches its own zoom.
 */
export function scaleBar(
  angstromPerPixel: number,
  maxPixels: number,
): { angstrom: number; pixels: number } | null {
  if (!(angstromPerPixel > 0) || !(maxPixels > 0)) return null;
  const angstrom = niceFloor(angstromPerPixel * maxPixels);
  if (angstrom === 0) return null;
  return { angstrom, pixels: angstrom / angstromPerPixel };
}

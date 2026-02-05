/**
 * Color utility functions.
 */

/**
 * Convert RGBA tuple to hex color string.
 */
export function rgbaToHex(color: [number, number, number, number]): string {
  const [r, g, b] = color;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Convert RGBA tuple to CSS rgba() string.
 */
export function rgbaToCss(color: [number, number, number, number], alphaOverride?: number): string {
  const [r, g, b, a] = color;
  const alpha = alphaOverride ?? a / 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

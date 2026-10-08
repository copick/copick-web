/**
 * Colour maps for idetik's LabelLayer (`{lookupTable, cycle}`).
 *
 * LabelLayer scans its lookup table linearly per fragment, so tables stay
 * small: background, hidden IDs and the solo ID. Every other instance ID is
 * coloured by the cycle, which is the shared instance palette.
 */

import {
  INSTANCE_PALETTE,
  instanceCycle,
  paletteIndex,
} from "./instanceColors";

export type Rgba01 = [number, number, number, number];
export type Rgba255 = [number, number, number, number];

export interface LabelColorMapProps {
  lookupTable: Map<number, Rgba01>;
  cycle?: Rgba01[];
}

export const TRANSPARENT: Rgba01 = [0, 0, 0, 0];
export const LABEL_ALPHA = 0.5;
/** Background, solo and up to this many hidden IDs. */
export const MAX_LOOKUP_ENTRIES = 64;

export function toLabelColor(
  [r, g, b, a]: Rgba255,
  alpha = LABEL_ALPHA,
): Rgba01 {
  return [r / 255, g / 255, b / 255, (a / 255) * alpha];
}

/** A binary segmentation: voxel 1 in the object's colour. */
export function binaryColorMap(color: Rgba255): LabelColorMapProps {
  return {
    lookupTable: new Map([
      [0, TRANSPARENT],
      [1, toLabelColor(color)],
    ]),
    cycle: [TRANSPARENT],
  };
}

/** A multilabel segmentation or panoptic label channel: each object label in its object's colour. */
export function objectLabelColorMap(
  objects: { label: number | null; color: Rgba255 }[],
): LabelColorMapProps {
  const lookupTable = new Map<number, Rgba01>([[0, TRANSPARENT]]);
  for (const obj of objects) {
    if (obj.label !== null && obj.label !== 0)
      lookupTable.set(obj.label, toLabelColor(obj.color));
  }
  return { lookupTable, cycle: [TRANSPARENT] };
}

export interface InstanceDisplay {
  hiddenIds: readonly number[];
  soloId: number | null;
}

/** The palette colour of an instance as an RGBA (0-1) with the given alpha. */
export function paletteColor(instanceId: number, alpha: number): Rgba01 {
  const [r, g, b] = INSTANCE_PALETTE[paletteIndex(instanceId)];
  return [r, g, b, alpha];
}

/**
 * An instance segmentation or panoptic instance channel: IDs coloured by the
 * shared palette (via the cycle), hidden IDs transparent, or only the solo ID.
 */
export function instanceColorMap(
  display: InstanceDisplay,
  alpha = LABEL_ALPHA,
): LabelColorMapProps {
  const lookupTable = new Map<number, Rgba01>([[0, TRANSPARENT]]);
  if (display.soloId !== null && display.soloId > 0) {
    lookupTable.set(display.soloId, paletteColor(display.soloId, alpha));
    return { lookupTable, cycle: [TRANSPARENT] };
  }
  for (const id of display.hiddenIds) {
    if (lookupTable.size >= MAX_LOOKUP_ENTRIES) break;
    if (id > 0) lookupTable.set(id, TRANSPARENT);
  }
  return { lookupTable, cycle: instanceCycle(alpha) };
}

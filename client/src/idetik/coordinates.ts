/**
 * Volume geometry and coordinate conversions for the linked viewer.
 *
 * World coordinates are the source's physical units (idetik renders in them);
 * copick data (picks, filaments, centroids) is in Å and is converted with
 * `angstromToWorld` / `worldToAngstrom` at the overlay boundary.
 */

export type XYZ = [number, number, number];
export type Axis = "x" | "y" | "z";
export type Plane = "XY" | "XZ" | "YZ";
export type ViewId = Plane | "3D";

export const AXES: Axis[] = ["x", "y", "z"];
export const PLANES: Plane[] = ["XY", "XZ", "YZ"];
export const VIEW_IDS: ViewId[] = ["XY", "XZ", "YZ", "3D"];

/** In-plane axes (u, v) and the slice axis (w) of each plane, as XYZ indices. */
export const planeAxes: Record<Plane, [number, number, number]> = {
  XY: [0, 1, 2],
  XZ: [0, 2, 1],
  YZ: [1, 2, 0],
};

export interface AxisGeometry {
  size: number;
  scale: number;
  translation: number;
}
export type Geometry = [AxisGeometry, AxisGeometry, AxisGeometry];

export interface VolumeGeometry {
  axes: Geometry;
  /** Unit of the world coordinates, as given by the source (may be undefined). */
  unit: string | undefined;
  /** Å per world unit (1 for Å, 10 for nm, 1e4 for µm). */
  angstromPerUnit: number;
  /** True when the source had no recognised unit and Å was assumed. */
  unitAssumed: boolean;
}

const UNIT_TO_ANGSTROM: Record<string, number> = {
  angstrom: 1,
  ångström: 1,
  å: 1,
  a: 1,
  nanometer: 10,
  nm: 10,
  micrometer: 1e4,
  µm: 1e4,
  um: 1e4,
  micron: 1e4,
};

export function angstromPerUnit(unit: string | undefined): number | null {
  if (unit === undefined) return null;
  return UNIT_TO_ANGSTROM[unit.toLowerCase()] ?? null;
}

type DimensionLike = {
  unit?: string;
  lods: AxisGeometry[];
};

/**
 * The finest-level geometry of a source, with its unit normalised to a factor
 * to Å. Copick stores are in Å; a missing unit is assumed to be Å.
 */
export function geometryFromDimensions(dimensions: {
  x: DimensionLike;
  y: DimensionLike;
  z?: DimensionLike;
}): VolumeGeometry {
  const units = AXES.map((axis) => dimensions[axis]?.unit);
  const factors = units.map(angstromPerUnit);
  const known = factors.filter((f): f is number => f !== null);
  if (known.length > 0 && known.some((f) => f !== known[0])) {
    throw new Error(
      `Mixed spatial units are not supported: ${units.join(", ")}`,
    );
  }
  const axes = AXES.map((axis) => {
    const d = dimensions[axis];
    if (!d) throw new Error(`The volume has no ${axis.toUpperCase()} axis.`);
    const first = d.lods[0];
    if (
      !first ||
      !Number.isFinite(first.scale) ||
      first.scale <= 0 ||
      !Number.isFinite(first.translation) ||
      first.size < 1
    ) {
      throw new Error(`Invalid ${axis.toUpperCase()} volume geometry.`);
    }
    return {
      size: first.size,
      scale: first.scale,
      translation: first.translation,
    };
  }) as Geometry;
  return {
    axes,
    unit: units.find((u) => u !== undefined),
    angstromPerUnit: known[0] ?? 1,
    unitAssumed: known.length === 0,
  };
}

export function indexToWorld(index: number, axis: AxisGeometry): number {
  return axis.translation + index * axis.scale;
}

export function worldToIndex(world: number, axis: AxisGeometry): number {
  return Math.max(
    0,
    Math.min(
      axis.size - 1,
      Math.round((world - axis.translation) / axis.scale),
    ),
  );
}

export function indicesToWorld(indices: XYZ, geometry: Geometry): XYZ {
  return indices.map((v, i) => indexToWorld(v, geometry[i])) as XYZ;
}

export function worldToIndices(world: XYZ, geometry: Geometry): XYZ {
  return world.map((v, i) => worldToIndex(v, geometry[i])) as XYZ;
}

export function centerIndices(geometry: Geometry): XYZ {
  return geometry.map((a) => Math.floor(a.size / 2)) as XYZ;
}

/** Extent of the volume along its largest axis, in world units. */
export function volumeSize(geometry: Geometry): number {
  return Math.max(...geometry.map((a) => a.size * a.scale));
}

export function angstromToWorld(xyz: XYZ, perUnit: number): XYZ {
  return perUnit === 1 ? xyz : (xyz.map((v) => v / perUnit) as XYZ);
}

export function worldToAngstrom(xyz: XYZ, perUnit: number): XYZ {
  return perUnit === 1 ? xyz : (xyz.map((v) => v * perUnit) as XYZ);
}

/** Radius of a sphere's cross-section at `distance` from its centre, or null. */
export function sphereIntersection(
  radius: number,
  distance: number,
): number | null {
  if (!Number.isFinite(radius) || radius <= 0 || Math.abs(distance) > radius)
    return null;
  return Math.sqrt(Math.max(0, radius * radius - distance * distance));
}

/** A readable length label (Å / nm / µm) for a length given in Å. */
export function lengthLabel(angstrom: number): string {
  if (angstrom >= 10000) return `${(angstrom / 10000).toFixed(2)} µm`;
  if (angstrom >= 10) return `${(angstrom / 10).toFixed(1)} nm`;
  return `${angstrom.toFixed(1)} Å`;
}

/**
 * Lighting of surfaces in the 3D view (segmentation meshes and points, copick meshes): a key light from above and
 * a fill light from below, fixed to the volume, so no side of a surface is left dark.
 *
 * idetik's mesh shader has one light of its own, fixed at `IDETIK_LIGHT`, and leaves faces turned away from it at
 * ambient brightness, so seen from below a surface is flat and dark. Its brightness is
 * `ambient + diffuse · max(n · IDETIK_LIGHT, 0)` for the normal `n` it is given, so with ambient 0 and diffuse 1,
 * `bakeLighting` folds this lighting into the normals: each becomes the unit vector whose dot product with
 * idetik's light is the brightness wanted here.
 */

type Vec3 = [number, number, number];

const KEY_LIGHT = normalize([0.35, -0.45, 0.82]);
const FILL_LIGHT = normalize([-0.3, 0.45, -0.85]);
const AMBIENT = 0.45;
const KEY = 0.5;
const FILL = 0.35;

/** The direction of idetik's mesh light (`mesh_frag.glsl`, 0.51): recheck on every upgrade. */
export const IDETIK_LIGHT = normalize([0, -1, 1]);

function normalize(v: number[]): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Brightness (0-1) of a surface facing along `n` (any length; 0 for unknown). */
export function brightness(nx: number, ny: number, nz: number): number {
  const l = Math.hypot(nx, ny, nz);
  if (l === 0) return 0.8;
  const key = (nx * KEY_LIGHT[0] + ny * KEY_LIGHT[1] + nz * KEY_LIGHT[2]) / l;
  const fill =
    (nx * FILL_LIGHT[0] + ny * FILL_LIGHT[1] + nz * FILL_LIGHT[2]) / l;
  return Math.min(
    1,
    AMBIENT + KEY * Math.max(0, key) + FILL * Math.max(0, fill),
  );
}

/**
 * A copy of interleaved mesh vertices (position, normal: 6 floats each) whose normals make idetik's shader, set to
 * ambient 0 and diffuse 1, draw `brightness` of the true normal. Positions are unchanged.
 */
export function bakeLighting(vertices: Float32Array): Float32Array {
  const [lx, ly, lz] = IDETIK_LIGHT;
  // A direction perpendicular to idetik's light, for normals along it.
  const [qx, qy, qz] = [1, 0, 0];
  const out = new Float32Array(vertices);
  for (let i = 0; i < out.length; i += 6) {
    const nx = out[i + 3],
      ny = out[i + 4],
      nz = out[i + 5];
    const b = brightness(nx, ny, nz);
    // n without its component along the light gives the perpendicular part, so shading still follows the surface.
    const l = Math.hypot(nx, ny, nz) || 1;
    const c = (nx * lx + ny * ly + nz * lz) / l;
    let px = nx / l - c * lx,
      py = ny / l - c * ly,
      pz = nz / l - c * lz;
    let pl = Math.hypot(px, py, pz);
    if (pl < 1e-6) [px, py, pz, pl] = [qx, qy, qz, 1];
    const s = Math.sqrt(Math.max(0, 1 - b * b)) / pl;
    out[i + 3] = b * lx + s * px;
    out[i + 4] = b * ly + s * py;
    out[i + 5] = b * lz + s * pz;
  }
  return out;
}

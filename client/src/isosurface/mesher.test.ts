import { describe, expect, test } from "vitest";
import { coarsen } from "./volume";
import {
  meshLabels,
  signedVolume,
  valueBoxes,
  type LabelArray,
  type LabelMesh,
  type LabelVolume,
  type XYZ,
} from "./mesher";

/** A volume of `size` voxels; `fill(x, y, z)` gives each channel's value. */
function volume(
  size: XYZ,
  fill: (x: number, y: number, z: number) => number[],
  { origin = [0, 0, 0], spacing = [1, 1, 1], channels = 1 } = {} as {
    origin?: XYZ;
    spacing?: XYZ;
    channels?: number;
  },
): LabelVolume {
  const n = size[0] * size[1] * size[2];
  const arrays: LabelArray[] = Array.from(
    { length: channels },
    () => new Uint16Array(n),
  );
  let i = 0;
  for (let z = 0; z < size[2]; z++)
    for (let y = 0; y < size[1]; y++)
      for (let x = 0; x < size[0]; x++, i++) {
        const v = fill(x, y, z);
        arrays.forEach((a, c) => (a[i] = v[c] ?? 0));
      }
  return { channels: arrays, size, origin, spacing };
}

const inBox = (p: XYZ, lo: XYZ, hi: XYZ) =>
  p.every((v, a) => v >= lo[a] && v <= hi[a]);

function bounds(mesh: LabelMesh): [XYZ, XYZ] {
  const lo: XYZ = [Infinity, Infinity, Infinity];
  const hi: XYZ = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < mesh.vertices.length; v += 6)
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], mesh.vertices[v + a]);
      hi[a] = Math.max(hi[a], mesh.vertices[v + a]);
    }
  return [lo, hi];
}

/** Every edge is shared by exactly two triangles, in opposite directions. */
function isClosed(mesh: LabelMesh): boolean {
  const edges = new Map<string, number>();
  const { indices } = mesh;
  for (let t = 0; t < indices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e],
        b = indices[t + ((e + 1) % 3)];
      edges.set(`${a},${b}`, (edges.get(`${a},${b}`) ?? 0) + 1);
    }
  for (const [edge, count] of edges) {
    const [a, b] = edge.split(",");
    if (count !== 1 || edges.get(`${b},${a}`) !== 1) return false;
  }
  return true;
}

const exact = { smooth: false, maxTriangles: 1e9 };

describe("meshLabels", () => {
  test("a box's surface lies half a voxel outside its voxel centres, in world units", () => {
    // Voxels x 3-10, y 2-5, z 1-2 of a 16×8×4 volume with anisotropic spacing and an offset origin.
    const spacing: XYZ = [10, 20, 40];
    const origin: XYZ = [100, 200, 300];
    const v = volume(
      [16, 8, 4],
      (x, y, z) => [inBox([x, y, z], [3, 2, 1], [10, 5, 2]) ? 7 : 0],
      { origin, spacing },
    );
    const { meshes, factor } = meshLabels(v, exact);
    expect(factor).toBe(1);
    expect(meshes.map((m) => m.values)).toEqual([[7]]);
    const [lo, hi] = bounds(meshes[0]);
    for (let a = 0; a < 3; a++) {
      const start = [3, 2, 1][a],
        end = [10, 5, 2][a];
      expect(lo[a]).toBeCloseTo(origin[a] + (start - 0.5) * spacing[a]);
      expect(hi[a]).toBeCloseTo(origin[a] + (end + 0.5) * spacing[a]);
    }
  });

  test("surfaces are closed, face outward and have outward unit normals", () => {
    const v = volume([12, 12, 12], (x, y, z) => [
      Math.hypot(x - 6, y - 6, z - 6) < 4 ? 1 : 0,
    ]);
    for (const smooth of [false, true]) {
      const [mesh] = meshLabels(v, { smooth, maxTriangles: 1e9 }).meshes;
      expect(isClosed(mesh)).toBe(true);
      expect(signedVolume(mesh.vertices, mesh.indices, 6)).toBeGreaterThan(0);
      let outward = 0;
      for (let p = 0; p < mesh.vertices.length; p += 6) {
        const n = [3, 4, 5].map((k) => mesh.vertices[p + k]);
        const r = [0, 1, 2].map((k) => mesh.vertices[p + k] - 6);
        expect(Math.hypot(...n)).toBeCloseTo(1, 4);
        if (n[0] * r[0] + n[1] * r[1] + n[2] * r[2] > 0) outward++;
      }
      expect(outward).toBe(mesh.vertices.length / 6);
    }
  });

  test("smoothing keeps a sphere's volume", () => {
    const v = volume([20, 20, 20], (x, y, z) => [
      Math.hypot(x - 10, y - 10, z - 10) < 6 ? 1 : 0,
    ]);
    const raw = meshLabels(v, exact).meshes[0];
    const smooth = meshLabels(v, { smooth: true, maxTriangles: 1e9 }).meshes[0];
    const a = signedVolume(raw.vertices, raw.indices, 6);
    const b = signedVolume(smooth.vertices, smooth.indices, 6);
    expect(Math.abs(b / a - 1)).toBeLessThan(0.1);
  });

  test("an object touching the volume's edge is still closed", () => {
    const v = volume([6, 6, 6], (x) => [x < 3 ? 1 : 0]);
    const [mesh] = meshLabels(v, exact).meshes;
    expect(isClosed(mesh)).toBe(true);
    expect(bounds(mesh)[0]).toEqual([-0.5, -0.5, -0.5]);
  });

  test("each label gets its own mesh", () => {
    const v = volume([12, 4, 4], (x, y, z) => [
      inBox([x, y, z], [1, 1, 1], [3, 2, 2])
        ? 1
        : inBox([x, y, z], [7, 1, 1], [9, 2, 2])
          ? 3
          : 0,
    ]);
    const meshes = meshLabels(v, exact).meshes;
    expect(meshes.map((m) => m.values)).toEqual([[1], [3]]);
    expect(bounds(meshes[1])[0][0]).toBeCloseTo(6.5);
    expect(meshes.every(isClosed)).toBe(true);
  });

  test("panoptic: one mesh per (label, instance), stuff (instance 0) included", () => {
    const v = volume(
      [12, 4, 4],
      (x) => (x < 3 ? [1, 1] : x < 6 ? [1, 2] : x < 9 ? [2, 0] : [0, 0]),
      { channels: 2 },
    );
    const meshes = meshLabels(v, exact).meshes;
    expect(meshes.map((m) => m.values)).toEqual([
      [1, 1],
      [1, 2],
      [2, 0],
    ]);
  });

  test("too many triangles: the volume is coarsened 2× and meshed again", () => {
    const v = volume([16, 16, 16], (x, y, z) => [
      Math.hypot(x - 8, y - 8, z - 8) < 6 ? 1 : 0,
    ]);
    const full = meshLabels(v, exact);
    const coarse = meshLabels(v, {
      smooth: false,
      maxTriangles: full.triangles - 1,
    });
    expect(coarse.factor).toBe(2);
    expect(coarse.triangles).toBeLessThan(full.triangles);
    expect(isClosed(coarse.meshes[0])).toBe(true);
  });
});

describe("coarsen", () => {
  test("block centres keep their world position and thin structures survive", () => {
    // A one-voxel-thin plane at z = 3 of an 8³ volume.
    const v = volume([8, 8, 8], (_x, _y, z) => [z === 3 ? 5 : 0], {
      origin: [10, 10, 10],
      spacing: [2, 2, 2],
    });
    const c = coarsen(v);
    expect(c.size).toEqual([4, 4, 4]);
    expect(c.spacing).toEqual([4, 4, 4]);
    // Voxels 0 and 1 (centres 10, 12) become one at 11.
    expect(c.origin).toEqual([11, 11, 11]);
    const boxes = [...valueBoxes(c).values()];
    expect(boxes.map((b) => [b.min[2], b.max[2]])).toEqual([[1, 1]]);
  });

  test("a panoptic block keeps a pair that occurs, not a mix", () => {
    const v = volume([2, 1, 1], (x) => (x === 0 ? [2, 1] : [1, 9]), {
      channels: 2,
    });
    const c = coarsen(v);
    expect(c.channels.map((a) => a[0])).toEqual([2, 1]);
  });
});

/**
 * Segmentation isosurfaces as drawable parts: each value's mesh coloured like the 2D label layers (so hidden and
 * solo IDs match the slices), and meshes of the same colour merged, so the number of draw calls stays bounded by
 * the number of colours (the instance palette and the object colours) however many instances there are.
 */

import type { LabelMesh } from "@/isosurface/mesher";
import { meshGeometry, type MeshPart } from "@/idetik/MeshObjectsLayer";
import { valueColor, type SurfaceColoring } from "./surfacePoints";

export function meshParts(
  meshes: LabelMesh[],
  coloring: SurfaceColoring,
): MeshPart[] {
  const groups = new Map<
    string,
    { color: [number, number, number]; meshes: LabelMesh[] }
  >();
  for (const mesh of meshes) {
    const c = valueColor(mesh.values, coloring);
    if (!c) continue;
    const color: [number, number, number] = [c[0], c[1], c[2]];
    const key = color.join(",");
    const group = groups.get(key) ?? { color, meshes: [] };
    group.meshes.push(mesh);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ color, meshes: group }) => {
    const { vertices, indices } = merge(group);
    return { geometry: meshGeometry(vertices, indices), color };
  });
}

/** Concatenate meshes, offsetting each one's indices past the vertices before it. */
export function merge(meshes: LabelMesh[]): {
  vertices: Float32Array;
  indices: Uint32Array;
} {
  if (meshes.length === 1) return meshes[0];
  const vertices = new Float32Array(
    meshes.reduce((n, m) => n + m.vertices.length, 0),
  );
  const indices = new Uint32Array(
    meshes.reduce((n, m) => n + m.indices.length, 0),
  );
  let v = 0;
  let t = 0;
  for (const m of meshes) {
    vertices.set(m.vertices, v);
    const base = v / 6;
    for (let k = 0; k < m.indices.length; k++)
      indices[t + k] = m.indices[k] + base;
    v += m.vertices.length;
    t += m.indices.length;
  }
  return { vertices, indices };
}

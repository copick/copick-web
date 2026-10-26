/**
 * Triangle meshes in the 3D view (copick meshes, segmentation isosurfaces): one idetik `MeshRenderable` per part,
 * each in one colour.
 *
 * idetik's `MeshLayer` loads its own source and fixes colour and size once built; here geometry is loaded with
 * React Query (so a failed load reaches the layer status) and passed in, and Å are scaled to world units. Like
 * `MeshLayer`, the layer occludes: idetik draws it first, so the volume composites against its depth and points
 * that depth-test are hidden behind it. Meshes are opaque (idetik's mesh shader ignores alpha).
 */

import { Color, Layer, MeshRenderable } from "@idetik/core";
import { bakeLighting } from "@/utils/lighting";

/** idetik's runtime context (not exported by the package). */
type Context = Parameters<Layer["onAttached"]>[0];

/** Geometry as idetik's `MeshSource` loads it (its `Geometry` class is not exported). */
export type MeshGeometry = ConstructorParameters<
  typeof MeshRenderable
>[0]["geometry"];

/**
 * Geometry from our own arrays (segmentation isosurfaces): interleaved position and normal, 6 floats per vertex,
 * and three indices per triangle. `MeshRenderable` reads only these fields, the layout idetik's GLB loader
 * produces; its `Geometry` class is not exported, hence the cast.
 */
export function meshGeometry(
  vertices: Float32Array,
  indices: Uint32Array,
): MeshGeometry {
  return {
    vertexData: vertices,
    indexData: indices,
    primitive: "triangles",
    attributes: [
      { type: "position", itemSize: 3, offset: 0 },
      { type: "normal", itemSize: 3, offset: 12 },
    ],
  } as unknown as MeshGeometry;
}

export interface MeshPart {
  geometry: MeshGeometry;
  /** RGB, 0-1. */
  color: [number, number, number];
}

export class MeshObjectsLayer extends Layer {
  public readonly type = "MeshObjectsLayer";

  /**
   * @param parts - The meshes, with vertices in Å.
   * @param angstromPerUnit - Å per world unit.
   */
  constructor(parts: MeshPart[], angstromPerUnit: number) {
    super({ blendMode: "none", occludes: true });
    const scale = 1 / angstromPerUnit;
    for (const { geometry, color } of parts) {
      // Lit by `lighting.ts` (a key and a fill light), folded into the normals: idetik's one light leaves the far
      // side of a surface dark.
      const object = new MeshRenderable({
        geometry: meshGeometry(
          bakeLighting(geometry.vertexData),
          geometry.indexData,
        ),
        color: new Color(color[0], color[1], color[2]),
        ambientStrength: 0,
        diffuseStrength: 1,
      });
      if (scale !== 1) object.transform.setScale([scale, scale, scale]);
      this.addObject(object);
    }
    this.setState("ready");
  }

  /** Release the GPU buffers; the meshes stay and are uploaded again if the layer is shown again. */
  protected detach(context: Context): void {
    for (const objects of this.coverageGroups.values())
      for (const object of objects)
        object.disposeGeometry(context.disposeGeometry);
    super.detach(context);
  }

  public update(): boolean {
    return false;
  }
}

import { describe, expect, test } from "vitest";
import type { LabelMesh } from "@/isosurface/mesher";
import { binaryColorMap, instanceColorMap } from "./labelColors";
import { meshParts, merge } from "./meshParts";
import type { SurfaceColoring } from "./surfacePoints";

/** A one-triangle mesh with its first vertex at `x`. */
function triangle(values: number[], x: number): LabelMesh {
  return {
    values,
    vertices: new Float32Array([
      x,
      0,
      0,
      0,
      0,
      1,
      x + 1,
      0,
      0,
      0,
      0,
      1,
      x,
      1,
      0,
      0,
      0,
      1,
    ]),
    indices: new Uint32Array([0, 1, 2]),
  };
}

const parts = (meshes: LabelMesh[], coloring: SurfaceColoring) =>
  meshParts(meshes, coloring).map((p) => {
    const g = p.geometry as unknown as {
      vertexData: Float32Array;
      indexData: Uint32Array;
    };
    return { color: p.color, vertices: g.vertexData, indices: g.indexData };
  });

describe("meshParts", () => {
  test("meshes of one colour are merged, each one's indices offset past the vertices before it", () => {
    const merged = merge([triangle([1], 0), triangle([1], 10)]);
    expect(merged.vertices.length).toBe(36);
    expect([...merged.indices]).toEqual([0, 1, 2, 3, 4, 5]);
    expect(merged.vertices[18]).toBe(10);
  });

  test("a binary segmentation is one part in the object's colour (RGB, alpha ignored)", () => {
    const coloring = [{ channel: 0, map: binaryColorMap([255, 0, 0, 255]) }];
    const [part, ...rest] = parts([triangle([1], 0)], coloring);
    expect(rest).toEqual([]);
    expect(part.color).toEqual([1, 0, 0]);
    expect(part.indices.length).toBe(3);
  });

  test("instances: hidden ones are dropped, solo keeps one, colours group by palette entry", () => {
    const meshes = [1, 2, 3].map((id) => triangle([id], id * 10));
    const all = parts(meshes, [
      { channel: 0, map: instanceColorMap({ hiddenIds: [], soloId: null }) },
    ]);
    expect(all.reduce((n, p) => n + p.indices.length / 3, 0)).toBe(3);

    const hidden = parts(meshes, [
      { channel: 0, map: instanceColorMap({ hiddenIds: [2], soloId: null }) },
    ]);
    expect(hidden.reduce((n, p) => n + p.indices.length / 3, 0)).toBe(2);

    const solo = parts(meshes, [
      { channel: 0, map: instanceColorMap({ hiddenIds: [], soloId: 3 }) },
    ]);
    expect(solo).toHaveLength(1);
    expect(solo[0].vertices[0]).toBe(30);
  });

  test("panoptic: the instance colour wins over the object's where it is not transparent", () => {
    const objects = binaryColorMap([0, 0, 255, 255]);
    const instances = instanceColorMap({ hiddenIds: [], soloId: null });
    const coloring = [
      { channel: 0, map: objects },
      { channel: 1, map: instances },
    ];
    // (1, 0) is stuff (instance 0 is transparent in the instance map): the object's blue.
    const [stuff] = parts([triangle([1, 0], 0)], coloring);
    expect(stuff.color).toEqual([0, 0, 1]);
    const [thing] = parts([triangle([1, 5], 0)], coloring);
    expect(thing.color).not.toEqual([0, 0, 1]);
  });
});

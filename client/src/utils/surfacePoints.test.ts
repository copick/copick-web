import { describe, expect, test } from "vitest";
import {
  decodeSurfacePoints,
  labelColor,
  pointColor,
  shade,
} from "./surfacePoints";
import {
  binaryColorMap,
  instanceColorMap,
  objectLabelColorMap,
  paletteColor,
} from "./labelColors";

function encode(
  positions: number[],
  values: number[],
  channels: number,
  normals: number[],
  voxelSize = 10,
  level = 1,
): ArrayBuffer {
  const n = positions.length / 3;
  const buffer = new ArrayBuffer(16 + 12 * n + 4 * n * channels + 3 * n);
  const view = new DataView(buffer);
  view.setUint32(0, n, true);
  view.setUint32(4, channels, true);
  view.setFloat32(8, voxelSize, true);
  view.setUint32(12, level, true);
  positions.forEach((v, i) => view.setFloat32(16 + 4 * i, v, true));
  values.forEach((v, i) => view.setUint32(16 + 12 * n + 4 * i, v, true));
  normals.forEach((v, i) =>
    view.setInt8(16 + 12 * n + 4 * n * channels + i, v),
  );
  return buffer;
}

describe("surface points", () => {
  test("decodes the server's wire format", () => {
    const points = decodeSurfacePoints(
      encode([1, 2, 3, 4, 5, 6], [7, 0, 9, 2], 2, [1, 0, 0, 0, -1, 1]),
    );
    expect(points.channels).toBe(2);
    expect(points.voxelSize).toBe(10);
    expect(points.level).toBe(1);
    expect([...points.positions]).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...points.values]).toEqual([7, 0, 9, 2]);
    expect([...points.normals]).toEqual([1, 0, 0, 0, -1, 1]);
    expect(() =>
      decodeSurfacePoints(encode([1, 2, 3], [1], 1, [0, 0, 1]).slice(0, 30)),
    ).toThrow();
  });

  test("colours match the 2D label layers, hidden and solo IDs included", () => {
    const red: [number, number, number, number] = [255, 0, 0, 255];
    expect(labelColor(binaryColorMap(red), 1)[0]).toBe(1);
    expect(labelColor(binaryColorMap(red), 0)[3]).toBe(0);
    const instances = instanceColorMap({ hiddenIds: [2], soloId: null });
    expect(labelColor(instances, 3)).toEqual(paletteColor(3, 0.5));
    expect(labelColor(instances, 2)[3]).toBe(0);
    const solo = instanceColorMap({ hiddenIds: [], soloId: 3 });
    expect(labelColor(solo, 1)[3]).toBe(0);
    expect(labelColor(solo, 3)[3]).toBeGreaterThan(0);
  });

  test("panoptic: instances draw over objects, stuff keeps its object colour", () => {
    const points = decodeSurfacePoints(
      encode([0, 0, 0, 1, 1, 1], [1, 4, 2, 0], 2, [0, 0, 1, 0, 0, 1]),
    );
    const objects = objectLabelColorMap([
      { label: 1, color: [0, 255, 0, 255] },
      { label: 2, color: [0, 0, 255, 255] },
    ]);
    const instances = instanceColorMap({ hiddenIds: [], soloId: null });
    const both = [
      { channel: 0, map: objects },
      { channel: 1, map: instances },
    ];
    expect(pointColor(points, both, 0)).toEqual(paletteColor(4, 0.5));
    expect(pointColor(points, both, 1)?.[2]).toBe(1); // label 2, no instance
    expect(pointColor(points, [{ channel: 1, map: instances }], 1)).toBeNull();
  });

  test("faces towards the key light are brighter", () => {
    expect(shade(0, 0, 1)).toBeGreaterThan(shade(0, 0, -1));
    expect(shade(0, 0, 0)).toBeGreaterThan(0);
  });
});

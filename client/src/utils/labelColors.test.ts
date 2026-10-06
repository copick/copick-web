import { describe, expect, test } from "vitest";
import { instanceRgb } from "./instanceColors";
import {
  MAX_LOOKUP_ENTRIES,
  TRANSPARENT,
  binaryColorMap,
  instanceColorMap,
  objectLabelColorMap,
} from "./labelColors";

describe("label colour maps", () => {
  test("instance maps colour every id through the shared palette cycle", () => {
    const map = instanceColorMap({ hiddenIds: [], soloId: null }, 0.5);
    expect(map.lookupTable.size).toBe(1);
    expect(map.lookupTable.get(0)).toEqual(TRANSPARENT);
    // LabelLayer colours value v with cycle[(v - 1) % n].
    const v = 7;
    expect(map.cycle![(v - 1) % map.cycle!.length]).toEqual([
      ...instanceRgb(7),
      0.5,
    ]);
  });

  test("hidden ids become transparent entries, bounded in number", () => {
    const map = instanceColorMap({ hiddenIds: [3, 5], soloId: null });
    expect(map.lookupTable.get(3)).toEqual(TRANSPARENT);
    expect(map.lookupTable.get(5)).toEqual(TRANSPARENT);
    const many = instanceColorMap({
      hiddenIds: Array.from({ length: 200 }, (_, i) => i + 1),
      soloId: null,
    });
    expect(many.lookupTable.size).toBeLessThanOrEqual(MAX_LOOKUP_ENTRIES);
  });

  test("solo keeps only one id visible", () => {
    const map = instanceColorMap({ hiddenIds: [1], soloId: 12 }, 0.4);
    expect(map.cycle).toEqual([TRANSPARENT]);
    expect(map.lookupTable.get(12)).toEqual([...instanceRgb(12), 0.4]);
    expect(map.lookupTable.size).toBe(2);
  });

  test("binary and object-label maps use object colours", () => {
    expect(binaryColorMap([255, 0, 0, 255]).lookupTable.get(1)).toEqual([
      1, 0, 0, 0.5,
    ]);
    const labels = objectLabelColorMap([
      { label: 2, color: [0, 0, 255, 255] },
      { label: null, color: [1, 1, 1, 255] },
      { label: 0, color: [1, 1, 1, 255] },
    ]);
    expect([...labels.lookupTable.keys()]).toEqual([0, 2]);
  });
});

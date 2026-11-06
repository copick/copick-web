import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LABEL_ALPHA, TRANSPARENT, objectLabelColorMap } from "./labelColors";
import {
  BACKGROUND_ALPHA,
  clearLabelOpacityCache,
  defaultLabelOpacity,
  labelOpacity,
  MESH_MIN_OPACITY,
  meshLabelOpacity,
  readLabelOpacities,
  resetLabelOpacities,
  saveLabelOpacity,
} from "./labelOpacity";

const objects = [
  { name: "background", label: 1, color: [80, 160, 255, 255] as const },
  { name: "structure", label: 2, color: [255, 160, 40, 255] as const },
].map((o) => ({
  ...o,
  color: [...o.color] as [number, number, number, number],
}));

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("label opacity", () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    clearLabelOpacityCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  test("background defaults fainter than other classes", () => {
    expect(defaultLabelOpacity("background")).toBe(BACKGROUND_ALPHA);
    expect(defaultLabelOpacity(" Background ")).toBe(BACKGROUND_ALPHA);
    expect(defaultLabelOpacity("structure")).toBe(LABEL_ALPHA);
    expect(BACKGROUND_ALPHA).toBeLessThan(LABEL_ALPHA);
  });

  test("the colour map gives each label its own opacity; unknown stays transparent", () => {
    const saved = { "2": 0.8 };
    const map = objectLabelColorMap(objects, (label, name) =>
      labelOpacity(saved, label, name),
    );
    expect(map.lookupTable.get(0)).toEqual(TRANSPARENT);
    expect(map.lookupTable.get(1)?.[3]).toBeCloseTo(BACKGROUND_ALPHA);
    expect(map.lookupTable.get(2)?.[3]).toBeCloseTo(0.8);
    // Colour and configured alpha are kept.
    expect(map.lookupTable.get(1)?.slice(0, 3)).toEqual([
      80 / 255,
      160 / 255,
      1,
    ]);
  });

  test("faint labels are left out of opaque 3D meshes; the default background is one of them", () => {
    expect(meshLabelOpacity(BACKGROUND_ALPHA)).toBe(0);
    expect(meshLabelOpacity(LABEL_ALPHA)).toBe(LABEL_ALPHA);
    expect(meshLabelOpacity(MESH_MIN_OPACITY)).toBe(MESH_MIN_OPACITY);
  });

  test("without opacities the colour map keeps the shared label alpha", () => {
    const map = objectLabelColorMap(objects);
    expect(map.lookupTable.get(1)?.[3]).toBeCloseTo(LABEL_ALPHA);
    expect(map.lookupTable.get(2)?.[3]).toBeCloseTo(LABEL_ALPHA);
  });

  test("a saved opacity changes only its label and survives a reload", () => {
    saveLabelOpacity("p1", 1, 0.4);
    saveLabelOpacity("p1", 1, 7); // clamped
    expect(readLabelOpacities("p1")).toEqual({ "1": 1 });
    saveLabelOpacity("p1", 1, 0.3);
    clearLabelOpacityCache(); // as after a page reload
    const saved = readLabelOpacities("p1");
    expect(labelOpacity(saved, 1, "background")).toBe(0.3);
    expect(labelOpacity(saved, 2, "structure")).toBe(LABEL_ALPHA);
    // Other projects are unaffected.
    expect(readLabelOpacities("p2")).toEqual({});
  });

  test("reset returns to defaults and clears storage; invalid storage is ignored", () => {
    saveLabelOpacity("p1", 1, 0.9);
    resetLabelOpacities("p1");
    expect(storage.data.size).toBe(0);
    storage.setItem(
      "copick-web.labelOpacity.v1.p3",
      JSON.stringify({ "1": 4 }),
    );
    expect(readLabelOpacities("p3")).toEqual({});
  });
});

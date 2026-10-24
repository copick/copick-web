import { describe, expect, test } from "vitest";
import type { ViewportChunkStats } from "@idetik/core";
import { loadedViewports } from "./loading";

function stats(
  viewportId: string,
  requested: number,
  resident: number,
): ViewportChunkStats {
  return {
    viewportId,
    requested: requested + 2,
    resident,
    current: { requested, resident },
  };
}

describe("loadedViewports", () => {
  test("a viewport is loaded once every current-LOD chunk is resident", () => {
    const loaded = loadedViewports([
      stats("XY", 4, 4),
      stats("XZ", 4, 3),
      stats("3D", 1, 1),
    ]);
    expect([...loaded].sort()).toEqual(["3D", "XY"]);
  });

  test("nothing requested yet is not loaded", () => {
    expect(loadedViewports([stats("XY", 0, 0)]).size).toBe(0);
  });

  test("viewports idetik omits are not loaded", () => {
    expect(loadedViewports([]).has("YZ")).toBe(false);
  });
});

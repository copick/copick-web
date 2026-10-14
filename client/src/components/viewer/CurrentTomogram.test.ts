import { describe, expect, test } from "vitest";
import { tomogramLabel } from "./CurrentTomogram";

describe("the shown tomogram's label", () => {
  test("names run, voxel spacing and tomogram type", () => {
    expect(tomogramLabel("36250", 21.6, "wbp-raw-ctfdeconv")).toBe(
      "36250 · 21.60 Å · wbp-raw-ctfdeconv",
    );
  });
  test("is empty while no tomogram is open", () => {
    expect(tomogramLabel(null, null, null)).toBeNull();
    expect(tomogramLabel("36250", null, "wbp")).toBeNull();
  });
});

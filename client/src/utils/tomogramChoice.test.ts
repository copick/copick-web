import { describe, expect, test } from "vitest";
import { chooseTomogram } from "./tomogramChoice";

const run = {
  voxel_spacings: [
    {
      voxel_size: 10,
      tomograms: [{ tomo_type: "wbp" }, { tomo_type: "denoised" }],
    },
    {
      voxel_size: 20,
      tomograms: [{ tomo_type: "raw" }, { tomo_type: "wbp-raw" }],
    },
  ],
};

describe("gallery tomogram choice", () => {
  test("keeps the type and spacing being viewed when the run has them", () => {
    expect(
      chooseTomogram(run, { voxelSize: 10, tomoType: "denoised" }),
    ).toEqual({ voxelSize: 10, tomoType: "denoised" });
  });

  test("else denoised / wbp at the coarsest spacing, like the thumbnails", () => {
    expect(chooseTomogram(run, null)).toEqual({
      voxelSize: 20,
      tomoType: "wbp-raw",
    });
    expect(chooseTomogram(run, { voxelSize: 10, tomoType: "missing" })).toEqual(
      { voxelSize: 20, tomoType: "wbp-raw" },
    );
    expect(
      chooseTomogram(
        {
          voxel_spacings: [{ voxel_size: 5, tomograms: [{ tomo_type: "x" }] }],
        },
        null,
      ),
    ).toEqual({ voxelSize: 5, tomoType: "x" });
    expect(chooseTomogram({ voxel_spacings: [] }, null)).toBeNull();
  });
});

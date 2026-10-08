/**
 * Which tomogram the gallery opens for a run: the type and voxel spacing being
 * viewed if the run has them, else the gallery's rule (the server's thumbnail
 * and the desktop galleries): denoised, then wbp, at the coarsest voxel spacing.
 */

import type { RunDetailResponse } from "@/api/types";

export const PREFERRED_TYPES = ["denoised", "wbp"];

export function chooseTomogram(
  run: Pick<RunDetailResponse, "voxel_spacings">,
  current: { voxelSize: number | null; tomoType: string | null } | null,
): { voxelSize: number; tomoType: string } | null {
  const all = run.voxel_spacings.flatMap((vs) =>
    vs.tomograms.map((t) => ({
      voxelSize: vs.voxel_size,
      tomoType: t.tomo_type,
    })),
  );
  if (current?.voxelSize != null && current.tomoType) {
    const same = all.find(
      (t) =>
        t.tomoType === current.tomoType &&
        Math.abs(t.voxelSize - current.voxelSize!) < 1e-3,
    );
    if (same) return same;
  }
  const sizes = [...new Set(all.map((t) => t.voxelSize))].sort((a, b) => b - a);
  for (const size of sizes) {
    const atSize = all.filter((t) => t.voxelSize === size);
    for (const preferred of PREFERRED_TYPES) {
      const hit = atSize.find((t) =>
        t.tomoType.toLowerCase().includes(preferred),
      );
      if (hit) return hit;
    }
    if (atSize.length) return atSize[0];
  }
  return null;
}

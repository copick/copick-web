/**
 * Show a saved painting edit. The open painting re-reads only the chunks inside the save's `changed_region`
 * (every view draws from the same chunks); no other label source is reopened. A painting that is not open yet is
 * listed again and opened, which reads it fresh. Without a region (a refused save) everything is reloaded.
 */

import type { QueryClient } from "@tanstack/react-query";
import type { PaintTarget, Saved } from "@/api/annotations";
import { refreshProjectData } from "@/api/projectRevision";
import { segmentationKey } from "@/contexts/CopickContext";
import {
  labelSourceKey,
  noteLabelEdit,
  refreshLabelRegion,
} from "@/idetik/labelRefresh";

/** How a save was shown: chunks re-read in place, the painting opened, nothing changed, or a full reload. */
export type Shown =
  | { kind: "region"; chunks: number }
  | { kind: "opened" }
  | { kind: "unchanged" }
  | { kind: "project" };

export async function showSavedEdit(
  client: QueryClient,
  projectId: string,
  target: PaintTarget,
  saved?: Saved,
): Promise<Shown> {
  if (saved && saved.changed_voxels === 0) return { kind: "unchanged" };
  if (!saved?.changed_region) {
    await refreshProjectData(client, projectId);
    return { kind: "project" };
  }
  const { run, voxel_size, painting } = target;
  const seg = {
    segmentationType: "multilabel" as const,
    name: painting.name,
    userId: painting.user_id,
    sessionId: painting.session_id,
    voxelSize: voxel_size,
  };
  const key = labelSourceKey(projectId, run, segmentationKey(seg));
  noteLabelEdit(key, saved.changed_region);
  const chunks = await refreshLabelRegion(key, saved.changed_region);
  // The browser-computed 3D isosurface of this painting, when shown, re-reads only the noted chunks. It updates
  // in the background: meshing is not awaited, so the next stroke does not wait for it.
  void client.invalidateQueries({
    queryKey: [
      "isosurface",
      projectId,
      run,
      seg.segmentationType,
      seg.name,
      seg.userId,
      seg.sessionId,
      seg.voxelSize,
    ],
  });
  if (chunks !== null) return { kind: "region", chunks };
  await client.invalidateQueries({
    queryKey: ["segmentations", projectId, run],
  });
  return { kind: "opened" };
}

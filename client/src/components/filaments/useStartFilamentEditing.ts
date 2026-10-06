/**
 * Start editing a filament set: load it (or start an empty new one), and show it.
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useObjects } from "@/api/hooks";
import { useCopick } from "@/contexts/CopickContext";
import { useFilamentEditing } from "@/contexts/FilamentEditingContext";
import { stateFromResponse, type EditState } from "@/filaments/editSession";

export interface FilamentSetIdentity {
  objectName: string;
  userId: string;
  sessionId: string;
}

const EMPTY: EditState = {
  filaments: new Map(),
  pending: new Map(),
  activeId: 1,
};

export function useStartFilamentEditing() {
  const { state, addFilaments } = useCopick();
  const { start } = useFilamentEditing();
  const { data: objects } = useObjects();
  const queryClient = useQueryClient();
  const runName = state.selectedRunName;
  const voxelSize = state.selectedVoxelSize;

  return useCallback(
    async (set: FilamentSetIdentity, isNew = false) => {
      if (!runName) return;
      const object = objects?.find((o) => o.name === set.objectName);
      let edit = EMPTY;
      let color =
        object?.color ??
        ([128, 128, 128, 255] as [number, number, number, number]);
      if (!isNew) {
        const detail = await queryClient.fetchQuery({
          queryKey: [
            "filamentDetail",
            runName,
            set.objectName,
            set.userId,
            set.sessionId,
          ],
          queryFn: () =>
            api.getFilamentDetail(
              runName,
              set.objectName,
              set.userId,
              set.sessionId,
            ),
        });
        edit = stateFromResponse(detail.filaments);
        color = detail.color;
        addFilaments(set);
      }
      start(
        { runName, ...set, color, isNew },
        { step: voxelSize ?? 10, radius: object?.radius ?? null },
        edit,
      );
    },
    [runName, voxelSize, objects, queryClient, start, addFilaments],
  );
}

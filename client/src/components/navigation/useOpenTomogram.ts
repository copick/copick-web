/**
 * Open a tomogram in the viewer. Leaving the run of an open filament edit
 * closes the editor (after asking, if there are unsaved edits).
 */

import { useCallback } from "react";
import { useCopick } from "@/contexts/CopickContext";
import { useFilamentEditing } from "@/contexts/FilamentEditingContext";
import { useNavigation } from "@/contexts/NavigationContext";

export function useOpenTomogram() {
  const { selectTomogram } = useCopick();
  const filamentEditing = useFilamentEditing();
  const { showViewer } = useNavigation();
  return useCallback(
    (runName: string, voxelSize: number, tomoType: string): boolean => {
      const leaving =
        filamentEditing.editing && filamentEditing.editing.runName !== runName;
      if (
        leaving &&
        filamentEditing.dirty &&
        !window.confirm(
          `Discard the unsaved filament edits in run ${filamentEditing.editing!.runName}?`,
        )
      )
        return false;
      if (leaving) filamentEditing.stop();
      selectTomogram(runName, voxelSize, tomoType);
      showViewer();
      return true;
    },
    [filamentEditing, selectTomogram, showViewer],
  );
}

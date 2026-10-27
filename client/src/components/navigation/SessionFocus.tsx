/**
 * Shows the layers of the sessions named by the page's `?session=` parameter (see `utils/sessionFocus`) in every run
 * that is opened. Renders nothing, and without the parameter does nothing.
 */

import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  useFeatures,
  useFilaments,
  useMeshes,
  usePicks,
  useSegmentations,
} from "@/api/hooks";
import {
  filamentsKey,
  meshKey,
  segmentationKey,
  useCopick,
  useTomogramSelection,
} from "@/contexts/CopickContext";
import {
  focusedLayers,
  parseSessions,
  type LayerIdentity,
} from "@/utils/sessionFocus";

export function SessionFocus() {
  const { search } = useLocation();
  // Read once, when the project page opens: the parameter names the sessions of this page.
  const [sessions] = useState(() => parseSessions(search));
  return sessions.length > 0 ? <ApplySessions sessions={sessions} /> : null;
}

type Kind = "picks" | "segmentations" | "filaments" | "meshes";

const pickKey = (p: LayerIdentity) =>
  `${p.objectName}:${p.userId}:${p.sessionId}`;

/**
 * Adds each kind's matching layers once per opened run, as soon as that kind's list has loaded, and only those not
 * selected already. A layer hidden or removed afterwards stays so; opening another run, which resets the overlays,
 * applies them again.
 */
function ApplySessions({ sessions }: { sessions: string[] }) {
  const { selectedRunName: run } = useTomogramSelection();
  const { state, addPick, addSegmentation, addFilaments, addMesh } =
    useCopick();
  const features = useFeatures();
  const { data: picks } = usePicks(run);
  const { data: segmentations } = useSegmentations(run);
  const { data: filaments } = useFilaments(run, features.filaments);
  const { data: meshes } = useMeshes(run);
  // The run the layers are applied to, and the kinds applied to it so far.
  const applied = useRef<{ run: string | null; kinds: Set<Kind> }>({
    run: null,
    kinds: new Set(),
  });

  useEffect(() => {
    if (applied.current.run !== run)
      applied.current = { run, kinds: new Set() };
    if (!run) return;
    const { kinds } = applied.current;
    const layers = focusedLayers(
      sessions,
      picks,
      segmentations,
      filaments,
      meshes,
    );
    // Each kind once, when its list is there: a slow list does not hold up the others.
    const due = (kind: Kind, list: unknown) => {
      if (list === undefined || kinds.has(kind)) return false;
      kinds.add(kind);
      return true;
    };
    if (due("picks", picks)) {
      const selected = new Set(state.selectedPicks.map(pickKey));
      for (const p of layers.picks) if (!selected.has(pickKey(p))) addPick(p);
    }
    if (due("segmentations", segmentations)) {
      const selected = new Set(
        state.selectedSegmentations.map(segmentationKey),
      );
      for (const s of layers.segmentations)
        if (!selected.has(segmentationKey(s))) addSegmentation(s);
    }
    if (due("filaments", filaments)) {
      const selected = new Set(state.selectedFilaments.map(filamentsKey));
      for (const f of layers.filaments)
        if (!selected.has(filamentsKey(f))) addFilaments(f);
    }
    if (due("meshes", meshes)) {
      const selected = new Set(state.selectedMeshes.map(meshKey));
      for (const m of layers.meshes) if (!selected.has(meshKey(m))) addMesh(m);
    }
  }, [
    run,
    sessions,
    picks,
    segmentations,
    filaments,
    meshes,
    state,
    addPick,
    addSegmentation,
    addFilaments,
    addMesh,
  ]);

  return null;
}

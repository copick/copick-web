/**
 * Session focus: an application that writes one job's copick entities under one session id can open a project as
 * `projects/<id>/?session=<session id>`, and every run opened there then shows that session's layers. Without the
 * parameter nothing changes.
 */

import type {
  FilamentsSummaryResponse,
  MeshSummaryResponse,
  PicksSummaryResponse,
  SegmentationSummaryResponse,
} from "@/api/types";
import type { SegmentationIdentity } from "@/contexts/CopickContext";
import { segmentationIdentity } from "./segmentationIdentity";

/**
 * The session ids of a query string's `session` parameter (with or without the leading `?`): comma-separated and
 * repeatable, trimmed, without empties and duplicates, in the order given. None when it is absent or empty.
 */
export function parseSessions(search: string): string[] {
  const sessions = new URLSearchParams(search)
    .getAll("session")
    .flatMap((value) => value.split(","))
    .map((session) => session.trim())
    .filter((session) => session !== "");
  return [...new Set(sessions)];
}

/** A pick set's, filament set's or mesh's identity in the selection state. */
export interface LayerIdentity {
  objectName: string;
  userId: string;
  sessionId: string;
}

/** The layers to show, per kind. */
export interface FocusedLayers {
  picks: LayerIdentity[];
  segmentations: SegmentationIdentity[];
  filaments: LayerIdentity[];
  meshes: LayerIdentity[];
}

const layerIdentity = (entity: {
  object_name: string;
  user_id: string;
  session_id: string;
}): LayerIdentity => ({
  objectName: entity.object_name,
  userId: entity.user_id,
  sessionId: entity.session_id,
});

/**
 * The layers of one run that belong to one of `sessions`, from the run's entity lists (as the entity hooks return
 * them; a list that has not loaded yet gives none).
 */
export function focusedLayers(
  sessions: readonly string[],
  picks: readonly PicksSummaryResponse[] | undefined,
  segmentations: readonly SegmentationSummaryResponse[] | undefined,
  filaments: readonly FilamentsSummaryResponse[] | undefined,
  meshes: readonly MeshSummaryResponse[] | undefined,
): FocusedLayers {
  const wanted = new Set(sessions);
  const inSessions = <T extends { session_id: string }>(
    entities: readonly T[] | undefined,
  ) => (entities ?? []).filter((entity) => wanted.has(entity.session_id));
  return {
    picks: inSessions(picks).map(layerIdentity),
    segmentations: inSessions(segmentations).map(segmentationIdentity),
    filaments: inSessions(filaments).map(layerIdentity),
    meshes: inSessions(meshes).map(layerIdentity),
  };
}

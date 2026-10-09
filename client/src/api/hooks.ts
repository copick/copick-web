/**
 * React Query hooks for the copick-web API.
 *
 * Project-scoped hooks take the project from the surrounding `CopickProvider` (`useProjectId`), and every
 * project-scoped query key has the project id at index 1, so one project's data is never shown for another and a
 * project can be invalidated as a whole.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { clearThumbnails } from "@/components/gallery/thumbnails";
import { useProjectId } from "@/contexts/CopickContext";
import type {
  CreatePicksRequest,
  ObjectTypeFields,
  SaveFilamentsRequest,
  PointRequest,
  SegmentationType,
} from "./types";

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: api.getProjects,
    staleTime: 30_000,
  });
}

export function useConfig() {
  const projectId = useProjectId();
  return useQuery({
    queryKey: ["config", projectId],
    queryFn: () => api.getConfig(projectId),
  });
}

export function useObjects() {
  const projectId = useProjectId();
  return useQuery({
    queryKey: ["objects", projectId],
    queryFn: () => api.getObjects(projectId),
  });
}

/** The object types with every editable field (for the object types dialog). */
export function useObjectTypes(enabled = true) {
  const projectId = useProjectId();
  return useQuery({
    queryKey: ["object-types", projectId],
    queryFn: () => api.getObjectTypes(projectId),
    enabled,
  });
}

type ObjectTypeChange =
  | { kind: "create"; version: string; fields: ObjectTypeFields }
  | { kind: "update"; version: string; name: string; fields: ObjectTypeFields }
  | { kind: "delete"; version: string; name: string };

/** Create, change or delete an object type; on success everything coloured by objects is reloaded. */
export function useEditObjectType() {
  const projectId = useProjectId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: ObjectTypeChange) =>
      change.kind === "create"
        ? api.createObjectType(projectId, change.version, change.fields)
        : change.kind === "update"
          ? api.updateObjectType(
              projectId,
              change.version,
              change.name,
              change.fields,
            )
          : api.deleteObjectType(projectId, change.version, change.name),
    onSuccess: (data) => {
      queryClient.setQueryData(["object-types", projectId], data);
      // Object colours, radii and labels feed the tables and every overlay (not voxel data: surfaces, instances).
      queryClient.invalidateQueries({
        predicate: (q) =>
          q.queryKey[1] === projectId &&
          !["object-types", "surface", "instances"].includes(
            String(q.queryKey[0]),
          ),
      });
    },
  });
}

/**
 * Reload the project (new runs, tomograms and annotations written by other tools): the server re-opens it, then
 * everything of the project is fetched again; the mutation is pending until what is shown has been fetched. Edits
 * in progress are kept: they hold their own copy of what they edit.
 */
export function useReloadProject() {
  const projectId = useProjectId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.reloadProject(projectId),
    onSuccess: () => {
      clearThumbnails(projectId);
      return queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[1] === projectId,
      });
    },
  });
}

export function useRuns() {
  const projectId = useProjectId();
  return useQuery({
    queryKey: ["runs", projectId],
    queryFn: () => api.getRuns(projectId),
  });
}

export function useRun(runName: string | null) {
  const projectId = useProjectId();
  return useQuery({
    queryKey: ["run", projectId, runName],
    queryFn: () => api.getRun(projectId, runName!),
    enabled: !!runName,
  });
}

/** Paths, portal links and contents of a run (the run info dialog). */
export function useRunInfo(runName: string | null) {
  const projectId = useProjectId();
  return useQuery({
    queryKey: ["runInfo", projectId, runName],
    queryFn: () => api.getRunInfo(projectId, runName!),
    enabled: !!runName,
    staleTime: 60_000,
  });
}

export function useTomogram(
  runName: string | null,
  voxelSize: number | null,
  tomoType: string | null,
) {
  const projectId = useProjectId();
  return useQuery({
    queryKey: ["tomogram", projectId, runName, voxelSize, tomoType],
    queryFn: () => api.getTomogram(projectId, runName!, voxelSize!, tomoType!),
    enabled: !!(runName && voxelSize !== null && tomoType),
  });
}

export function usePicks(runName: string | null) {
  const projectId = useProjectId();
  return useQuery({
    queryKey: ["picks", projectId, runName],
    queryFn: () => api.getPicks(projectId, runName!),
    enabled: !!runName,
  });
}

export function usePickPoints(
  runName: string | null,
  objectName: string | null,
  userId: string | null,
  sessionId: string | null,
) {
  const projectId = useProjectId();
  return useQuery({
    queryKey: ["pickPoints", projectId, runName, objectName, userId, sessionId],
    queryFn: () =>
      api.getPickPoints(projectId, runName!, objectName!, userId!, sessionId!),
    enabled: !!(runName && objectName && userId && sessionId),
  });
}

export function useSegmentations(runName: string | null) {
  const projectId = useProjectId();
  return useQuery({
    queryKey: ["segmentations", projectId, runName],
    queryFn: () => api.getSegmentations(projectId, runName!),
    enabled: !!runName,
  });
}

export function useFeatures() {
  const { data } = useConfig();
  return {
    filaments: data?.features?.filaments ?? false,
    segmentationTypes: data?.features?.segmentation_types ?? false,
    pickIdentity: data?.features?.pick_identity ?? false,
  };
}

export function useInstances(
  runName: string | null,
  seg: {
    segmentationType: SegmentationType;
    name: string;
    userId: string;
    sessionId: string;
    voxelSize: number;
  } | null,
  level = 1,
) {
  const projectId = useProjectId();
  return useQuery({
    queryKey: [
      "instances",
      projectId,
      runName,
      seg?.segmentationType,
      seg?.name,
      seg?.userId,
      seg?.sessionId,
      seg?.voxelSize,
      level,
    ],
    queryFn: () =>
      api.getInstances(
        projectId,
        runName!,
        seg!.segmentationType,
        seg!.name,
        seg!.userId,
        seg!.sessionId,
        seg!.voxelSize,
        level,
      ),
    enabled:
      !!runName &&
      !!seg &&
      (seg.segmentationType === "instance" ||
        seg.segmentationType === "panoptic"),
    staleTime: Infinity,
  });
}

/** Boundary voxels of a segmentation for the 3D view (fetched only while `enabled`). */
export function useSurfacePoints(
  runName: string | null,
  seg: {
    segmentationType: SegmentationType;
    name: string;
    userId: string;
    sessionId: string;
    voxelSize: number;
  } | null,
  enabled: boolean,
) {
  const projectId = useProjectId();
  return useQuery({
    queryKey: [
      "surface",
      projectId,
      runName,
      seg?.segmentationType,
      seg?.name,
      seg?.userId,
      seg?.sessionId,
      seg?.voxelSize,
    ],
    queryFn: () =>
      api.getSurfacePoints(
        projectId,
        runName!,
        seg!.segmentationType,
        seg!.name,
        seg!.userId,
        seg!.sessionId,
        seg!.voxelSize,
      ),
    enabled: enabled && !!runName && !!seg,
    staleTime: Infinity,
    gcTime: 60_000,
  });
}

export function useFilaments(runName: string | null, enabled = true) {
  const projectId = useProjectId();
  return useQuery({
    queryKey: ["filaments", projectId, runName],
    queryFn: () => api.getFilaments(projectId, runName!),
    enabled: !!runName && enabled,
  });
}

export function useFilamentDetail(
  runName: string | null,
  objectName: string | null,
  userId: string | null,
  sessionId: string | null,
) {
  const projectId = useProjectId();
  return useQuery({
    queryKey: [
      "filamentDetail",
      projectId,
      runName,
      objectName,
      userId,
      sessionId,
    ],
    queryFn: () =>
      api.getFilamentDetail(
        projectId,
        runName!,
        objectName!,
        userId!,
        sessionId!,
      ),
    enabled: !!(runName && objectName && userId && sessionId),
  });
}

export interface FilamentSetKey {
  runName: string;
  objectName: string;
  userId: string;
  sessionId: string;
}

export function useSaveFilaments() {
  const projectId = useProjectId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      key,
      data,
    }: {
      key: FilamentSetKey;
      data: SaveFilamentsRequest;
    }) =>
      api.saveFilaments(
        projectId,
        key.runName,
        key.objectName,
        key.userId,
        key.sessionId,
        data,
      ),
    onSuccess: (result, { key, data }) => {
      queryClient.setQueryData(
        [
          "filamentDetail",
          projectId,
          key.runName,
          key.objectName,
          key.userId,
          key.sessionId,
        ],
        result.filaments,
      );
      queryClient.invalidateQueries({
        queryKey: ["filaments", projectId, key.runName],
      });
      if (data.pick_spacing) {
        queryClient.invalidateQueries({
          queryKey: ["picks", projectId, key.runName],
        });
        queryClient.invalidateQueries({
          queryKey: ["pickPoints", projectId, key.runName],
        });
      }
    },
  });
}

export function useDeleteFilaments() {
  const projectId = useProjectId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: FilamentSetKey) =>
      api.deleteFilaments(
        projectId,
        key.runName,
        key.objectName,
        key.userId,
        key.sessionId,
      ),
    onSuccess: (_, key) => {
      queryClient.removeQueries({
        queryKey: [
          "filamentDetail",
          projectId,
          key.runName,
          key.objectName,
          key.userId,
          key.sessionId,
        ],
      });
      queryClient.invalidateQueries({
        queryKey: ["filaments", projectId, key.runName],
      });
    },
  });
}

// --- Picks mutation hooks ---

export function useCreatePicks() {
  const projectId = useProjectId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      runName,
      data,
    }: {
      runName: string;
      data: CreatePicksRequest;
    }) => api.createPicks(projectId, runName, data),
    onSuccess: (_, { runName }) => {
      // Invalidate picks list to refetch
      queryClient.invalidateQueries({
        queryKey: ["picks", projectId, runName],
      });
    },
  });
}

export function useUpdatePicks() {
  const projectId = useProjectId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      runName,
      objectName,
      userId,
      sessionId,
      points,
    }: {
      runName: string;
      objectName: string;
      userId: string;
      sessionId: string;
      points: PointRequest[];
    }) =>
      api.updatePicks(projectId, runName, objectName, userId, sessionId, {
        points,
      }),
    onSuccess: (_, { runName, objectName, userId, sessionId }) => {
      // Invalidate specific pick points
      queryClient.invalidateQueries({
        queryKey: [
          "pickPoints",
          projectId,
          runName,
          objectName,
          userId,
          sessionId,
        ],
      });
      // Also invalidate picks list (point count changed)
      queryClient.invalidateQueries({
        queryKey: ["picks", projectId, runName],
      });
    },
  });
}

export function useDeletePicks() {
  const projectId = useProjectId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      runName,
      objectName,
      userId,
      sessionId,
    }: {
      runName: string;
      objectName: string;
      userId: string;
      sessionId: string;
    }) => api.deletePicks(projectId, runName, objectName, userId, sessionId),
    onSuccess: (_, { runName }) => {
      queryClient.invalidateQueries({
        queryKey: ["picks", projectId, runName],
      });
    },
  });
}

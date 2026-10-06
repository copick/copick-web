/**
 * React Query hooks for the copick-web API.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type {
  CreatePicksRequest,
  ObjectTypeFields,
  SaveFilamentsRequest,
  PointRequest,
  SegmentationType,
} from "./types";

export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: api.getConfig,
  });
}

export function useObjects() {
  return useQuery({
    queryKey: ["objects"],
    queryFn: api.getObjects,
  });
}

/** The object types with every editable field (for the object types dialog). */
export function useObjectTypes(enabled = true) {
  return useQuery({
    queryKey: ["object-types"],
    queryFn: api.getObjectTypes,
    enabled,
  });
}

type ObjectTypeChange =
  | { kind: "create"; version: string; fields: ObjectTypeFields }
  | { kind: "update"; version: string; name: string; fields: ObjectTypeFields }
  | { kind: "delete"; version: string; name: string };

/** Create, change or delete an object type; on success everything coloured by objects is reloaded. */
export function useEditObjectType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: ObjectTypeChange) =>
      change.kind === "create"
        ? api.createObjectType(change.version, change.fields)
        : change.kind === "update"
          ? api.updateObjectType(change.version, change.name, change.fields)
          : api.deleteObjectType(change.version, change.name),
    onSuccess: (data) => {
      queryClient.setQueryData(["object-types"], data);
      // Object colours, radii and labels feed the tables and every overlay (not voxel data: surfaces, instances).
      queryClient.invalidateQueries({
        predicate: (q) =>
          !["object-types", "surface", "instances"].includes(
            String(q.queryKey[0]),
          ),
      });
    },
  });
}

export function useRuns() {
  return useQuery({
    queryKey: ["runs"],
    queryFn: api.getRuns,
  });
}

export function useRun(runName: string | null) {
  return useQuery({
    queryKey: ["run", runName],
    queryFn: () => api.getRun(runName!),
    enabled: !!runName,
  });
}

/** Paths, portal links and contents of a run (the run info dialog). */
export function useRunInfo(runName: string | null) {
  return useQuery({
    queryKey: ["runInfo", runName],
    queryFn: () => api.getRunInfo(runName!),
    enabled: !!runName,
    staleTime: 60_000,
  });
}

export function useTomogram(
  runName: string | null,
  voxelSize: number | null,
  tomoType: string | null,
) {
  return useQuery({
    queryKey: ["tomogram", runName, voxelSize, tomoType],
    queryFn: () => api.getTomogram(runName!, voxelSize!, tomoType!),
    enabled: !!(runName && voxelSize !== null && tomoType),
  });
}

export function usePicks(runName: string | null) {
  return useQuery({
    queryKey: ["picks", runName],
    queryFn: () => api.getPicks(runName!),
    enabled: !!runName,
  });
}

export function usePickPoints(
  runName: string | null,
  objectName: string | null,
  userId: string | null,
  sessionId: string | null,
) {
  return useQuery({
    queryKey: ["pickPoints", runName, objectName, userId, sessionId],
    queryFn: () =>
      api.getPickPoints(runName!, objectName!, userId!, sessionId!),
    enabled: !!(runName && objectName && userId && sessionId),
  });
}

export function useSegmentations(runName: string | null) {
  return useQuery({
    queryKey: ["segmentations", runName],
    queryFn: () => api.getSegmentations(runName!),
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
  return useQuery({
    queryKey: [
      "instances",
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
  return useQuery({
    queryKey: [
      "surface",
      runName,
      seg?.segmentationType,
      seg?.name,
      seg?.userId,
      seg?.sessionId,
      seg?.voxelSize,
    ],
    queryFn: () =>
      api.getSurfacePoints(
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
  return useQuery({
    queryKey: ["filaments", runName],
    queryFn: () => api.getFilaments(runName!),
    enabled: !!runName && enabled,
  });
}

export function useFilamentDetail(
  runName: string | null,
  objectName: string | null,
  userId: string | null,
  sessionId: string | null,
) {
  return useQuery({
    queryKey: ["filamentDetail", runName, objectName, userId, sessionId],
    queryFn: () =>
      api.getFilamentDetail(runName!, objectName!, userId!, sessionId!),
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
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, data }: { key: FilamentSetKey; data: SaveFilamentsRequest }) =>
      api.saveFilaments(key.runName, key.objectName, key.userId, key.sessionId, data),
    onSuccess: (result, { key, data }) => {
      queryClient.setQueryData(
        ["filamentDetail", key.runName, key.objectName, key.userId, key.sessionId],
        result.filaments,
      );
      queryClient.invalidateQueries({ queryKey: ["filaments", key.runName] });
      if (data.pick_spacing) {
        queryClient.invalidateQueries({ queryKey: ["picks", key.runName] });
        queryClient.invalidateQueries({ queryKey: ["pickPoints", key.runName] });
      }
    },
  });
}

export function useDeleteFilaments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: FilamentSetKey) =>
      api.deleteFilaments(key.runName, key.objectName, key.userId, key.sessionId),
    onSuccess: (_, key) => {
      queryClient.removeQueries({
        queryKey: ["filamentDetail", key.runName, key.objectName, key.userId, key.sessionId],
      });
      queryClient.invalidateQueries({ queryKey: ["filaments", key.runName] });
    },
  });
}

// --- Picks mutation hooks ---

export function useCreatePicks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      runName,
      data,
    }: {
      runName: string;
      data: CreatePicksRequest;
    }) => api.createPicks(runName, data),
    onSuccess: (_, { runName }) => {
      // Invalidate picks list to refetch
      queryClient.invalidateQueries({ queryKey: ["picks", runName] });
    },
  });
}

export function useUpdatePicks() {
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
    }) => api.updatePicks(runName, objectName, userId, sessionId, { points }),
    onSuccess: (_, { runName, objectName, userId, sessionId }) => {
      // Invalidate specific pick points
      queryClient.invalidateQueries({
        queryKey: ["pickPoints", runName, objectName, userId, sessionId],
      });
      // Also invalidate picks list (point count changed)
      queryClient.invalidateQueries({ queryKey: ["picks", runName] });
    },
  });
}

export function useDeletePicks() {
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
    }) => api.deletePicks(runName, objectName, userId, sessionId),
    onSuccess: (_, { runName }) => {
      queryClient.invalidateQueries({ queryKey: ["picks", runName] });
    },
  });
}

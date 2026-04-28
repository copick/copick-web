/**
 * React Query hooks for the copick-web API.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { CreatePicksRequest, PointRequest } from "./types";

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: api.getProjects,
    staleTime: 30_000,
  });
}

export function useConfig(projectId: string | null) {
  return useQuery({
    queryKey: ["config", projectId],
    queryFn: () => api.getConfig(projectId!),
    enabled: !!projectId,
  });
}

export function useObjects(projectId: string | null) {
  return useQuery({
    queryKey: ["objects", projectId],
    queryFn: () => api.getObjects(projectId!),
    enabled: !!projectId,
  });
}

export function useRuns(projectId: string | null) {
  return useQuery({
    queryKey: ["runs", projectId],
    queryFn: () => api.getRuns(projectId!),
    enabled: !!projectId,
  });
}

export function useRun(projectId: string | null, runName: string | null) {
  return useQuery({
    queryKey: ["run", projectId, runName],
    queryFn: () => api.getRun(projectId!, runName!),
    enabled: !!(projectId && runName),
  });
}

export function useTomogram(
  projectId: string | null,
  runName: string | null,
  voxelSize: number | null,
  tomoType: string | null
) {
  return useQuery({
    queryKey: ["tomogram", projectId, runName, voxelSize, tomoType],
    queryFn: () => api.getTomogram(projectId!, runName!, voxelSize!, tomoType!),
    enabled: !!(projectId && runName && voxelSize !== null && tomoType),
  });
}

export function usePicks(projectId: string | null, runName: string | null) {
  return useQuery({
    queryKey: ["picks", projectId, runName],
    queryFn: () => api.getPicks(projectId!, runName!),
    enabled: !!(projectId && runName),
  });
}

export function usePickPoints(
  projectId: string | null,
  runName: string | null,
  objectName: string | null,
  userId: string | null,
  sessionId: string | null
) {
  return useQuery({
    queryKey: ["pickPoints", projectId, runName, objectName, userId, sessionId],
    queryFn: () => api.getPickPoints(projectId!, runName!, objectName!, userId!, sessionId!),
    enabled: !!(projectId && runName && objectName && userId && sessionId),
  });
}

export function useSegmentations(projectId: string | null, runName: string | null) {
  return useQuery({
    queryKey: ["segmentations", projectId, runName],
    queryFn: () => api.getSegmentations(projectId!, runName!),
    enabled: !!(projectId && runName),
  });
}

export function useReloadProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) => api.reloadProject(projectId),
    onSuccess: (_, projectId) => {
      // Drop every query keyed to this project so consumers re-enter their
      // `isLoading` state on the next render
      // All project-scoped query keys put projectId at index 1.
      queryClient.removeQueries({
        predicate: (q) => q.queryKey[1] === projectId,
      });
    },
  });
}

// --- Picks mutation hooks ---

export function useCreatePicks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      runName,
      data,
    }: {
      projectId: string;
      runName: string;
      data: CreatePicksRequest;
    }) => api.createPicks(projectId, runName, data),
    onSuccess: (_, { projectId, runName }) => {
      queryClient.invalidateQueries({ queryKey: ["picks", projectId, runName] });
    },
  });
}

export function useUpdatePicks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      runName,
      objectName,
      userId,
      sessionId,
      points,
    }: {
      projectId: string;
      runName: string;
      objectName: string;
      userId: string;
      sessionId: string;
      points: PointRequest[];
    }) => api.updatePicks(projectId, runName, objectName, userId, sessionId, { points }),
    onSuccess: (_, { projectId, runName, objectName, userId, sessionId }) => {
      queryClient.invalidateQueries({
        queryKey: ["pickPoints", projectId, runName, objectName, userId, sessionId],
      });
      queryClient.invalidateQueries({ queryKey: ["picks", projectId, runName] });
    },
  });
}

export function useDeletePicks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      runName,
      objectName,
      userId,
      sessionId,
    }: {
      projectId: string;
      runName: string;
      objectName: string;
      userId: string;
      sessionId: string;
    }) => api.deletePicks(projectId, runName, objectName, userId, sessionId),
    onSuccess: (_, { projectId, runName }) => {
      queryClient.invalidateQueries({ queryKey: ["picks", projectId, runName] });
    },
  });
}

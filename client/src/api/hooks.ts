/**
 * React Query hooks for the copick-web API.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { CreatePicksRequest, PointRequest } from "./types";

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

export function useTomogram(runName: string | null, voxelSize: number | null, tomoType: string | null) {
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
  sessionId: string | null
) {
  return useQuery({
    queryKey: ["pickPoints", runName, objectName, userId, sessionId],
    queryFn: () => api.getPickPoints(runName!, objectName!, userId!, sessionId!),
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

// --- Picks mutation hooks ---

export function useCreatePicks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ runName, data }: { runName: string; data: CreatePicksRequest }) => api.createPicks(runName, data),
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

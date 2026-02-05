/**
 * React Query hooks for the copick-web API.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

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

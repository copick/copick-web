import {
  segmentationTypeOf,
  type SegmentationSummaryResponse,
} from "@/api/types";
import type { SegmentationIdentity } from "@/contexts/CopickContext";

/** A listed segmentation's identity in the selection state (its type included, see `segmentationKey`). */
export function segmentationIdentity(
  seg: SegmentationSummaryResponse,
): SegmentationIdentity {
  return {
    name: seg.name,
    userId: seg.user_id,
    sessionId: seg.session_id,
    voxelSize: seg.voxel_size,
    segmentationType: segmentationTypeOf(seg),
  };
}

import type { SliceOrientation } from "@idetik/core";
import { Idetik } from "@/idetik/Idetik";
import { SegmentationLayer } from "@/idetik/components/SegmentationLayer";
import { useCopick, useProjectId } from "@/contexts/CopickContext";
import { useSegmentations, useObjects } from "@/api/hooks";

type Rgba = [number, number, number, number];

function toLabelColor([r, g, b, a]: Rgba): Rgba {
  return [r / 255, g / 255, b / 255, (a / 255) * 0.5];
}

interface SegmentationOverlayProps {
  viewer: Idetik | null;
  orientation: SliceOrientation;
  sliceIndex: number;
  voxelSpacing: number;
}

export function SegmentationOverlay({
  viewer,
  orientation,
  sliceIndex,
  voxelSpacing,
}: SegmentationOverlayProps) {
  const { state: copickState } = useCopick();
  const projectId = useProjectId();
  const { data: segmentations } = useSegmentations(
    projectId,
    copickState.selectedRunName,
  );
  const { data: objects } = useObjects(projectId);

  const slicePosition = sliceIndex * voxelSpacing;
  const visibleSegmentations = copickState.selectedSegmentations.filter(
    (s) => s.visible,
  );

  const labelColorMap = new Map<number, Rgba>();
  if (objects) {
    for (const obj of objects) {
      if (obj.label !== null && obj.label !== 0) {
        labelColorMap.set(obj.label, obj.color);
      }
    }
  }

  if (!viewer || visibleSegmentations.length === 0 || !segmentations) {
    return null;
  }

  return (
    <>
      {visibleSegmentations.map((seg) => {
        const segData = segmentations.find(
          (s) =>
            s.name === seg.name &&
            s.user_id === seg.userId &&
            s.session_id === seg.sessionId &&
            s.voxel_size === seg.voxelSize,
        );
        if (!segData?.zarr_url) return null;

        const lookupTable = new Map<number, Rgba>([[0, [0, 0, 0, 0]]]);
        if (segData.is_multilabel && labelColorMap.size > 0) {
          for (const [label, rgba] of labelColorMap) {
            lookupTable.set(label, toLabelColor(rgba));
          }
        } else {
          const color = objects?.find((obj) => obj.name === seg.name)?.color ??
            segData.color ?? [255, 0, 0, 128];
          lookupTable.set(1, toLabelColor(color));
        }

        return (
          <SegmentationLayer
            key={`${seg.name}-${seg.userId}-${seg.sessionId}-${seg.voxelSize}`}
            viewer={viewer}
            sourceUrl={`${window.location.origin}${segData.zarr_url}`}
            lookupTable={lookupTable}
            orientation={orientation}
            slicePosition={slicePosition}
          />
        );
      })}
    </>
  );
}

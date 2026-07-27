import { useCallback, useRef, useState } from "react";
import { Box } from "@mui/material";
import { useIdetik } from "@/idetik/useIdetik";
import { Canvas } from "@/idetik/components/Canvas";
import { ImageLayer } from "@/idetik/components/ImageLayer";
import { ScaleBar } from "@/idetik/components/ScaleBar";
import { ViewerProvider } from "@/contexts/ViewerContext";
import { useCopick } from "@/contexts/CopickContext";
import { ViewerControls } from "./ViewerControls";
import { ChannelControls } from "./ChannelControls";
import type { Contrast } from "@/idetik/contrastStats";
import { SegmentationOverlay } from "@/components/overlays/SegmentationOverlay";
import { InteractivePicksOverlay } from "@/components/overlays/InteractivePicksOverlay";
import { PickingToolbar } from "@/components/picking/PickingToolbar";
import { PickingEventHandler } from "@/components/picking/PickingEventHandler";

export function TomogramViewer({ zarrUrl }: { zarrUrl: string }) {
  const { viewer, canvasRefCallback } = useIdetik();
  const { state: copickState } = useCopick();
  const voxelSpacing = copickState.selectedVoxelSize ?? 1;
  const [zIndex, setZIndex] = useState(0);
  const [maxZ, setMaxZ] = useState<number | undefined>(undefined);

  const [color, setColor] = useState("#ffffff");
  const [contrastLimits, setContrastLimits] = useState<
    [number, number] | undefined
  >(undefined);
  const [contrastRange, setContrastRange] = useState<
    [number, number] | undefined
  >(undefined);
  const autoLimitsRef = useRef<[number, number] | null>(null);

  const handleZMaxIndex = useCallback((max: number | undefined) => {
    setMaxZ(max);
    if (max !== undefined) {
      setZIndex(Math.floor(max / 2));
    }
  }, []);

  const handleAutoContrast = useCallback((contrast: Contrast) => {
    autoLimitsRef.current = contrast.limits;
    setContrastLimits(contrast.limits);
    setContrastRange(contrast.range);
  }, []);

  const handleResetContrast = useCallback(() => {
    if (autoLimitsRef.current) {
      setContrastLimits(autoLimitsRef.current);
    }
  }, []);

  return (
    <ViewerProvider>
      <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <PickingToolbar />
        <ViewerControls
          currentZIndex={zIndex}
          maxZIndex={maxZ}
          onZIndexChange={setZIndex}
        />
        <Box sx={{ flexGrow: 1, position: "relative", overflow: "hidden" }}>
          <Canvas canvasRefCallback={canvasRefCallback} />
          <ImageLayer
            viewer={viewer}
            sourceUrl={`${window.location.origin}${zarrUrl}`}
            zIndex={zIndex}
            color={color}
            contrastLimits={contrastLimits}
            onZMaxIndex={handleZMaxIndex}
            onAutoContrast={handleAutoContrast}
          />
          <SegmentationOverlay
            viewer={viewer}
            currentZIndex={zIndex}
            voxelSpacing={voxelSpacing}
          />
          <InteractivePicksOverlay
            viewer={viewer}
            currentZIndex={zIndex}
            voxelSpacing={voxelSpacing}
          />
          <PickingEventHandler
            viewer={viewer}
            currentZIndex={zIndex}
            onZIndexChange={setZIndex}
            maxZIndex={maxZ}
            voxelSpacing={voxelSpacing}
          />
          {contrastLimits && contrastRange && (
            <Box sx={{ position: "absolute", bottom: 0, right: 0, m: 1 }}>
              <ChannelControls
                color={color}
                contrastLimits={contrastLimits}
                contrastRange={contrastRange}
                onColorChange={setColor}
                onContrastChange={setContrastLimits}
                onResetContrast={handleResetContrast}
              />
            </Box>
          )}
          <Box
            sx={{
              position: "absolute",
              bottom: 0,
              left: 0,
              width: "20%",
              m: 2,
              userSelect: "none",
              pointerEvents: "none",
            }}
          >
            <ScaleBar viewer={viewer} unit="angstrom" align="start" />
          </Box>
        </Box>
      </Box>
    </ViewerProvider>
  );
}

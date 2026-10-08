/**
 * Segmentation overlays: on the ortho views one LabelLayer per view, in the 3D
 * view a point cloud of the segmentation's boundary voxels (SurfacePointsLayer)
 * coloured with the same colour maps:
 *
 * - binary: the object's colour;
 * - multilabel: each object label in its object's colour;
 * - instance: the shared instance palette (LabelLayer `cycle`), with hidden /
 *   solo IDs in a small lookup table, click-to-identify and an outline on the
 *   selected instance;
 * - panoptic: a (2, Z, Y, X) store split by ChannelViewSource into the label
 *   channel (object colours) and the instance channel (palette); objects,
 *   instances or both.
 *
 * Label sources are opened once per segmentation and shared by the views
 * (idetik caches chunks per source). They are added after the XY slice has
 * loaded, so the density comes first.
 */

import { useEffect, useMemo, useState } from "react";
import { Box, Chip } from "@mui/material";
import { LabelLayer, OmeZarrImageSource } from "@idetik/core";
import { useSegmentations, useObjects, useSurfacePoints } from "@/api/hooks";
import { appUrl } from "@/api/client";
import {
  segmentationTypeOf,
  type PickableObjectResponse,
  type SegmentationSummaryResponse,
} from "@/api/types";
import {
  segmentationKey,
  useCopick,
  type SegmentationSelection,
} from "@/contexts/CopickContext";
import { useScene } from "@/contexts/SceneContext";
import {
  layerStatusFromError,
  useLayerStatus,
} from "@/contexts/LayerStatusContext";
import { ChannelViewSource } from "@/idetik/ChannelViewSource";
import { PLANES, VIEW_IDS, type Plane } from "@/idetik/coordinates";
import { isAbortError, withSceneSignal } from "@/idetik/lifecycle";
import { sourcePolicy } from "@/idetik/policy";
import { usePerViewportLayers } from "@/components/viewer/usePerViewportLayers";
import { SurfacePointsLayer } from "@/idetik/SurfacePointsLayer";
import type { SurfaceColoring } from "@/utils/surfacePoints";
import {
  binaryColorMap,
  instanceColorMap,
  objectLabelColorMap,
  type LabelColorMapProps,
} from "@/utils/labelColors";

type Rgba = [number, number, number, number];
type LabelSource = OmeZarrImageSource | ChannelViewSource;

interface OpenedSource {
  base: OmeZarrImageSource;
  /** Panoptic: [label channel, instance channel]. */
  channels: ChannelViewSource[] | null;
  maxLod: number;
}

interface PickedValue {
  key: string;
  text: string;
}

export function SegmentationOverlay() {
  const { state: copickState } = useCopick();
  const { data: segmentations } = useSegmentations(copickState.selectedRunName);
  const { data: objects } = useObjects();
  const { scene, stage } = useScene();
  const [picked, setPicked] = useState<Record<string, string | null>>({});

  const visibleSegmentations = copickState.selectedSegmentations.filter(
    (s) => s.visible,
  );
  if (
    !scene ||
    stage === "xy" ||
    !segmentations ||
    visibleSegmentations.length === 0
  ) {
    return null;
  }

  const pickedValues: PickedValue[] = Object.entries(picked)
    .filter(
      ([key, text]) =>
        text && visibleSegmentations.some((s) => segmentationKey(s) === key),
    )
    .map(([key, text]) => ({ key, text: text! }));

  return (
    <>
      {visibleSegmentations.map((selection) => {
        const key = segmentationKey(selection);
        const segData = segmentations.find(
          (s) =>
            segmentationTypeOf(s) === selection.segmentationType &&
            s.name === selection.name &&
            s.user_id === selection.userId &&
            s.session_id === selection.sessionId &&
            s.voxel_size === selection.voxelSize,
        );
        if (!segData?.zarr_url) return null;
        return (
          <SegmentationLayers
            key={key}
            segKey={key}
            runName={copickState.selectedRunName}
            selection={selection}
            seg={segData}
            objects={objects ?? []}
            onPicked={(text) => setPicked((old) => ({ ...old, [key]: text }))}
          />
        );
      })}
      {pickedValues.length > 0 && (
        <Box
          sx={{
            position: "absolute",
            top: 8,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            gap: 0.5,
            zIndex: 3,
            pointerEvents: "none",
          }}
        >
          {pickedValues.map(({ key, text }) => (
            <Chip
              key={key}
              size="small"
              label={text}
              sx={{ bgcolor: "rgba(0,0,0,0.75)" }}
            />
          ))}
        </Box>
      )}
    </>
  );
}

interface SegmentationLayersProps {
  segKey: string;
  runName: string | null;
  selection: SegmentationSelection;
  seg: SegmentationSummaryResponse;
  objects: PickableObjectResponse[];
  onPicked: (text: string | null) => void;
}

function SegmentationLayers({
  segKey,
  runName,
  selection,
  seg,
  objects,
  onPicked,
}: SegmentationLayersProps) {
  const { updateSegmentation } = useCopick();
  const { setStatus } = useLayerStatus();
  const [opened, setOpened] = useState<OpenedSource | null>(null);
  const type = selection.segmentationType;
  const url = appUrl(seg.zarr_url);

  useEffect(() => {
    let alive = true;
    const abort = new AbortController();
    setOpened(null);
    (async () => {
      const base = await OmeZarrImageSource.fromHttp({ url });
      if (!alive) return;
      const load = base.loader.loadChunkData.bind(base.loader);
      base.loader.loadChunkData = async (chunk, signal) => {
        if (!alive) throw new DOMException("Layer hidden", "AbortError");
        return withSceneSignal(abort.signal, signal, (combined) =>
          load(chunk, combined),
        );
      };
      const channelCount = base.getChannelCount();
      let channels: ChannelViewSource[] | null = null;
      if (type === "panoptic") {
        if (channelCount < 2)
          throw new Error("A panoptic segmentation needs two channels.");
        channels = [
          new ChannelViewSource(base, 0),
          new ChannelViewSource(base, 1),
        ];
      } else if (channelCount > 1) {
        throw new Error(
          `Unexpected ${channelCount}-channel ${type} segmentation.`,
        );
      }
      setStatus(segKey, null);
      setOpened({
        base,
        channels,
        maxLod: Math.max(0, base.getDimensions().numLods - 1),
      });
    })().catch((e) => {
      if (alive && !isAbortError(e)) setStatus(segKey, layerStatusFromError(e));
    });
    return () => {
      alive = false;
      abort.abort();
    };
  }, [url, type, segKey, setStatus]);

  const objectColor: Rgba = objects.find((o) => o.name === seg.name)?.color ??
    seg.color ?? [255, 0, 0, 255];

  const instanceMap = useMemo(
    () =>
      instanceColorMap({
        hiddenIds: selection.hiddenIds,
        soloId: selection.soloId,
      }),
    [selection.hiddenIds, selection.soloId],
  );
  const objectMap = useMemo(() => objectLabelColorMap(objects), [objects]);
  const binaryMap = useMemo(
    () => binaryColorMap(objectColor),
    [objectColor.join(",")],
  ); // eslint-disable-line react-hooks/exhaustive-deps

  const objectName = (label: number) =>
    objects.find((o) => o.label === label)?.name ?? `label ${label}`;

  const report = (channel: "instance" | "label" | "binary", value: number) => {
    if (channel === "label") {
      onPicked(value ? `${seg.name}: ${objectName(value)}` : null);
      return;
    }
    if (channel === "instance")
      updateSegmentation(segKey, { selectedId: value || null });
    onPicked(value ? `${seg.name} #${value}` : null);
  };

  const coloring: SurfaceColoring =
    type === "panoptic"
      ? [
          ...(selection.panopticMode !== "instances"
            ? [{ channel: 0, map: objectMap }]
            : []),
          ...(selection.panopticMode !== "objects"
            ? [{ channel: 1, map: instanceMap }]
            : []),
        ]
      : [
          {
            channel: 0,
            map:
              type === "instance"
                ? instanceMap
                : type === "multilabel"
                  ? objectMap
                  : binaryMap,
          },
        ];
  const surface = (
    <SurfacePoints3D
      segKey={segKey}
      runName={runName}
      selection={selection}
      coloring={coloring}
    />
  );

  if (!opened) return surface;

  if (type === "panoptic" && opened.channels) {
    const mode = selection.panopticMode;
    return (
      <>
        {surface}
        {(mode === "objects" || mode === "both") && (
          <LabelLayerSet
            source={opened.channels[0]}
            maxLod={opened.maxLod}
            colorMap={objectMap}
            selectedId={null}
            onPick={(v) => report("label", v)}
          />
        )}
        {(mode === "instances" || mode === "both") && (
          <LabelLayerSet
            source={opened.channels[1]}
            maxLod={opened.maxLod}
            colorMap={instanceMap}
            selectedId={selection.selectedId}
            onPick={(v) => report("instance", v)}
            outline
          />
        )}
      </>
    );
  }

  const colorMap =
    type === "instance"
      ? instanceMap
      : type === "multilabel"
        ? objectMap
        : binaryMap;
  return (
    <>
      {surface}
      <LabelLayerSet
        source={opened.base}
        maxLod={opened.maxLod}
        colorMap={colorMap}
        selectedId={type === "instance" ? selection.selectedId : null}
        outline={type === "instance"}
        onPick={(v) =>
          type === "instance"
            ? report("instance", v)
            : type === "multilabel"
              ? report("label", v)
              : onPicked(v ? seg.name : null)
        }
      />
    </>
  );
}

/** Minimum size of a surface point in the 3D view (CSS pixels). */
const SURFACE_MIN_PIXELS = 2;

/** The segmentation in the 3D view: its boundary voxels, fetched while the 3D pane is shown. */
function SurfacePoints3D({
  segKey,
  runName,
  selection,
  coloring,
}: {
  segKey: string;
  runName: string | null;
  selection: SegmentationSelection;
  coloring: SurfaceColoring;
}) {
  const { scene, visible } = useScene();
  const { setStatus } = useLayerStatus();
  const show3d = visible[VIEW_IDS.indexOf("3D")];
  const { data: points, error } = useSurfacePoints(runName, selection, show3d);
  const perUnit = scene?.geometry.angstromPerUnit ?? 1;
  // Rebuild on colour changes (hidden / solo IDs, panoptic mode), not on every render.
  const coloringKey = JSON.stringify(coloring, (_, v) =>
    v instanceof Map ? [...v.entries()] : v,
  );

  useEffect(() => {
    if (error) setStatus(segKey, layerStatusFromError(error));
  }, [error, segKey, setStatus]);

  usePerViewportLayers(
    ["3D"],
    scene && points && points.values.length > 0
      ? () =>
          new SurfacePointsLayer({
            points,
            coloring,
            angstromPerUnit: perUnit,
            minPixels: SURFACE_MIN_PIXELS,
          })
      : null,
    [points, coloringKey, perUnit],
  );
  return null;
}

interface LabelLayerSetProps {
  source: LabelSource;
  maxLod: number;
  colorMap: LabelColorMapProps;
  selectedId: number | null;
  onPick: (value: number) => void;
  /** Outline the selected value (instances). */
  outline?: boolean;
}

/** One LabelLayer per visible ortho view; colour map and selection update in place. */
function LabelLayerSet({
  source,
  maxLod,
  colorMap,
  selectedId,
  onPick,
  outline = false,
}: LabelLayerSetProps) {
  const { scene } = useScene();
  const onPickRef = useLatest(onPick);
  const colorMapRef = useLatest(colorMap);
  const selectedRef = useLatest(selectedId);

  const layersRef = usePerViewportLayers<LabelLayer>(
    PLANES,
    scene
      ? (view) => {
          const layer = new LabelLayer({
            source,
            sliceCoords: scene.sliceCoords,
            policy: sourcePolicy(0, maxLod),
            orientation: view as Plane,
            colorMap: colorMapRef.current,
            blendMode: "normal",
            outlineSelected: outline,
            onPickValue: (info) => onPickRef.current(info.value),
          });
          layer.setSelectedValue(selectedRef.current);
          return layer;
        }
      : null,
    [source, maxLod, outline],
  );

  useEffect(() => {
    for (const layer of layersRef.current) layer.setColorMap(colorMap);
  }, [colorMap, layersRef]);

  useEffect(() => {
    for (const layer of layersRef.current) layer.setSelectedValue(selectedId);
  }, [selectedId, layersRef]);

  return null;
}

function useLatest<T>(value: T) {
  const [ref] = useState(() => ({ current: value }));
  ref.current = value;
  return ref;
}

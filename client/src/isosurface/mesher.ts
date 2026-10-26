/**
 * Isosurfaces of label volumes: one closed triangle mesh per value (a label, or a (label, instance) pair of a
 * panoptic segmentation), made by vtk.js marching cubes on the value's mask, smoothed with vtk.js's windowed-sinc
 * filter (as 3D Slicer smooths segment surfaces), with per-vertex normals.
 *
 * Pure functions on typed arrays, run in a worker (`isosurface.worker.ts`) and in tests. Only the worker imports
 * this module, so vtk.js stays out of the main bundle.
 */

import vtkDataArray from "@kitware/vtk.js/Common/Core/DataArray";
import vtkImageData from "@kitware/vtk.js/Common/DataModel/ImageData";
import type { vtkPolyData } from "@kitware/vtk.js/Common/DataModel/PolyData";
import vtkPolyDataNormals from "@kitware/vtk.js/Filters/Core/PolyDataNormals";
import vtkImageMarchingCubes from "@kitware/vtk.js/Filters/General/ImageMarchingCubes";
import vtkWindowedSincPolyDataFilter from "@kitware/vtk.js/Filters/General/WindowedSincPolyDataFilter";
import { coarsen, type LabelArray, type LabelVolume, type XYZ } from "./volume";

export type { LabelArray, LabelVolume, XYZ } from "./volume";

export interface LabelMesh {
  /** The value in each channel: [label], or [label, instance] for a panoptic segmentation. */
  values: number[];
  /** Interleaved position (world units) and unit normal: 6 floats per vertex. */
  vertices: Float32Array;
  /** Three vertex indices per triangle, counter-clockwise seen from outside. */
  indices: Uint32Array;
}

export interface MeshOptions {
  /** Smooth the surfaces (marching cubes on a mask alone gives a terraced surface). */
  smooth: boolean;
  /** More triangles than this and the volume is coarsened 2× (block maximum), then meshed again. */
  maxTriangles: number;
}

export interface MeshResult {
  meshes: LabelMesh[];
  /** How many times the volume was coarsened 2× (1, 2, 4, ...) to fit `maxTriangles`. */
  factor: number;
  triangles: number;
}

const SMOOTHING_ITERATIONS = 15;
const SMOOTHING_PASS_BAND = 0.1;

/** Mesh every non-zero value of a volume. */
export function meshLabels(
  volume: LabelVolume,
  options: MeshOptions,
): MeshResult {
  let factor = 1;
  for (;;) {
    const surfaces = [...valueBoxes(volume)].map(([, box]) => ({
      values: box.values,
      polydata: marchingCubes(volume, box),
    }));
    const triangles = surfaces.reduce(
      (n, s) => n + s.polydata.getPolys().getNumberOfCells(),
      0,
    );
    const canCoarsen = Math.min(...volume.size) > 2;
    if (triangles > options.maxTriangles && canCoarsen) {
      volume = coarsen(volume);
      factor *= 2;
      continue;
    }
    const meshes = surfaces
      .filter((s) => s.polydata.getPolys().getNumberOfCells() > 0)
      .map((s) => toMesh(s.values, s.polydata, options.smooth));
    return { meshes, factor, triangles };
  }
}

interface ValueBox {
  values: number[];
  key: number;
  min: XYZ;
  max: XYZ;
}

/**
 * The key of a voxel's values: the value, or label × 2³² + instance for two channels (exact while labels stay
 * below 2²¹). 0 is background.
 */
function keyAt(channels: LabelArray[], i: number): number {
  return channels.length === 1
    ? channels[0][i]
    : channels[0][i] * 4294967296 + channels[1][i];
}

/** The bounding box (voxel indices, inclusive) of every non-zero value, in order of first appearance. */
export function valueBoxes(volume: LabelVolume): Map<number, ValueBox> {
  const { channels, size } = volume;
  const [nx, ny, nz] = size;
  const boxes = new Map<number, ValueBox>();
  let last: ValueBox | undefined;
  let i = 0;
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++, i++) {
        const key = keyAt(channels, i);
        if (key === 0) continue;
        let box = last?.key === key ? last : boxes.get(key);
        if (!box) {
          box = {
            key,
            values: channels.map((c) => c[i]),
            min: [x, y, z],
            max: [x, y, z],
          };
          boxes.set(key, box);
        } else {
          if (x < box.min[0]) box.min[0] = x;
          if (x > box.max[0]) box.max[0] = x;
          if (y < box.min[1]) box.min[1] = y;
          if (y > box.max[1]) box.max[1] = y;
          if (z < box.min[2]) box.min[2] = z;
          if (z > box.max[2]) box.max[2] = z;
        }
        last = box;
      }
  return boxes;
}

/** Marching cubes on one value's mask, padded by a voxel of background so the surface closes at the volume edge. */
function marchingCubes(volume: LabelVolume, box: ValueBox): vtkPolyData {
  const { channels, size, origin, spacing } = volume;
  const [w, h, d] = [0, 1, 2].map((a) => box.max[a] - box.min[a] + 3);
  const mask = new Uint8Array(w * h * d);
  for (let z = box.min[2]; z <= box.max[2]; z++)
    for (let y = box.min[1]; y <= box.max[1]; y++) {
      const row = (z * size[1] + y) * size[0];
      const out = ((z - box.min[2] + 1) * h + (y - box.min[1] + 1)) * w + 1;
      for (let x = box.min[0]; x <= box.max[0]; x++)
        if (keyAt(channels, row + x) === box.key)
          mask[out + x - box.min[0]] = 1;
    }
  const image = vtkImageData.newInstance();
  image.setDimensions(w, h, d);
  image.setSpacing([...spacing]);
  image.setOrigin([
    origin[0] + (box.min[0] - 1) * spacing[0],
    origin[1] + (box.min[1] - 1) * spacing[1],
    origin[2] + (box.min[2] - 1) * spacing[2],
  ]);
  image
    .getPointData()
    .setScalars(
      vtkDataArray.newInstance({ numberOfComponents: 1, values: mask }),
    );
  const filter = vtkImageMarchingCubes.newInstance({
    contourValue: 0.5,
    mergePoints: true,
  });
  filter.setInputData(image);
  return quietly(() => filter.getOutputData());
}

/** vtk.js's marching cubes times every run on the console; keep that out of the browser console. */
function quietly<T>(run: () => T): T {
  const { time, timeEnd } = console;
  console.time = () => undefined;
  console.timeEnd = () => undefined;
  try {
    return run();
  } finally {
    console.time = time;
    console.timeEnd = timeEnd;
  }
}

/** Smooth, orient outward, add normals, and pack for idetik. */
function toMesh(
  values: number[],
  surface: vtkPolyData,
  smooth: boolean,
): LabelMesh {
  if (smooth) {
    const filter = vtkWindowedSincPolyDataFilter.newInstance({
      numberOfIterations: SMOOTHING_ITERATIONS,
      passBand: SMOOTHING_PASS_BAND,
      normalizeCoordinates: true,
      nonManifoldSmoothing: true,
    });
    filter.setInputData(surface);
    surface = filter.getOutputData();
  }
  const points = surface.getPoints().getData() as Float32Array | Float64Array;
  // vtk.js cell array: [3, a, b, c, 3, ...].
  const cells = surface.getPolys().getData() as Uint32Array;
  const indices = new Uint32Array((cells.length / 4) * 3);
  for (let c = 0, t = 0; c < cells.length; c += 4, t += 3) {
    indices[t] = cells[c + 1];
    indices[t + 1] = cells[c + 2];
    indices[t + 2] = cells[c + 3];
  }
  // Each mask surface is closed, so the sign of its volume says which way its triangles face.
  if (signedVolume(points, indices) < 0)
    for (let c = 0, t = 0; c < cells.length; c += 4, t += 3) {
      [cells[c + 2], cells[c + 3]] = [cells[c + 3], cells[c + 2]];
      [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]];
    }
  const normalsFilter = vtkPolyDataNormals.newInstance({
    computePointNormals: true,
    computeCellNormals: false,
  });
  normalsFilter.setInputData(surface);
  const normals = normalsFilter
    .getOutputData()
    .getPointData()
    .getNormals()
    .getData() as Float32Array | Float64Array;
  const n = points.length / 3;
  const vertices = new Float32Array(n * 6);
  for (let v = 0; v < n; v++) {
    vertices.set(points.subarray(3 * v, 3 * v + 3), 6 * v);
    vertices.set(normals.subarray(3 * v, 3 * v + 3), 6 * v + 3);
  }
  return { values, vertices, indices };
}

/**
 * The volume enclosed by a closed triangle mesh: positive when its triangles face outward. `stride` is the number
 * of floats per vertex (6 for interleaved position and normal).
 */
export function signedVolume(
  points: ArrayLike<number>,
  indices: ArrayLike<number>,
  stride = 3,
): number {
  let volume = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = stride * indices[t],
      b = stride * indices[t + 1],
      c = stride * indices[t + 2];
    volume +=
      points[a] *
        (points[b + 1] * points[c + 2] - points[b + 2] * points[c + 1]) -
      points[a + 1] * (points[b] * points[c + 2] - points[b + 2] * points[c]) +
      points[a + 2] * (points[b] * points[c + 1] - points[b + 1] * points[c]);
  }
  return volume / 6;
}

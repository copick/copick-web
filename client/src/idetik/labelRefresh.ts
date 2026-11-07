/**
 * Re-read the chunks of an open label source that a saved edit changed, without reopening the source.
 *
 * idetik keeps one chunk object per grid cell of a source, each drawn from one GPU texture shared by every view.
 * The overlay routes the source's chunk reads through `load`, which records those chunks. After a save,
 * `refresh(region)` re-reads only the chunks that intersect the changed voxel box and swaps the new data into
 * their existing textures (`Texture.data`, which re-uploads on the next draw), so every view shows the edit and
 * nothing else is fetched. Chunks that are not on the GPU need nothing: they are read from the store when next
 * needed (the server marks segmentation chunks `no-store`). A read that was in flight when an edit touched its
 * chunk is repeated, and of two refreshes of one chunk only the later one is kept.
 */

import type { ChunkLike, ChunkLoaderLike } from "./ChannelViewSource";

/** Half-open voxel box of the finest level, `[[x0, x1], [y0, y1], [z0, z1]]`. */
export type VoxelBox = [[number, number], [number, number], [number, number]];

type Load = ChunkLoaderLike["loadChunkData"];

const AXES = ["x", "y", "z"] as const;

export class EditableLabelSource {
  // idetik's grid chunks: one object per chunk of the source, so this is bounded by the grid.
  private readonly chunks = new Set<ChunkLike>();
  private readonly edits = new WeakMap<ChunkLike, number>();

  constructor(
    private readonly loader: ChunkLoaderLike,
    private readonly read: Load,
    private readonly requestRender: () => void,
    private readonly signal: AbortSignal,
  ) {}

  /** The chunk read to install as the source's `loadChunkData` (for idetik's chunks only: they are kept). */
  load: Load = async (chunk, signal) => {
    this.chunks.add(chunk);
    for (;;) {
      const edits = this.edits.get(chunk) ?? 0;
      await this.read(chunk, signal);
      if ((this.edits.get(chunk) ?? 0) === edits) return;
    }
  };

  /** Re-read the drawn chunks inside `region`; resolves when their new data is set. Returns how many were read. */
  async refresh(region: VoxelBox): Promise<number> {
    const hit = [...this.chunks].filter((chunk) =>
      this.intersects(chunk, region),
    );
    for (const chunk of hit)
      this.edits.set(chunk, (this.edits.get(chunk) ?? 0) + 1);
    const drawn = hit.filter(
      (c) => c.texture || (c.state === "loaded" && c.data),
    );
    await Promise.all(drawn.map((chunk) => this.reread(chunk)));
    if (drawn.length) this.requestRender();
    return drawn.length;
  }

  private async reread(chunk: ChunkLike) {
    const edit = this.edits.get(chunk);
    const copy: ChunkLike = { ...chunk, data: undefined, texture: undefined };
    await this.read(copy, this.signal);
    if (this.edits.get(chunk) !== edit || !copy.data) return;
    const texture = chunk.texture;
    if (texture) {
      texture.data = copy.data;
      releaseAfterUpload(texture);
    } else if (chunk.data) {
      // Loaded but not yet uploaded: same size, so idetik's CPU byte count stays right.
      chunk.data = copy.data;
    }
  }

  private intersects(chunk: ChunkLike, region: VoxelBox): boolean {
    const dims = this.loader.getSourceDimensionMap();
    return AXES.every((axis, i) => {
      const lod0 = dims[axis]?.lods[0];
      if (!lod0) return true;
      const lo = lod0.translation + region[i][0] * lod0.scale;
      const hi = lod0.translation + region[i][1] * lod0.scale;
      const start = chunk.offset[axis];
      const end = start + chunk.shape[axis] * chunk.scale[axis];
      const eps = 1e-6 * Math.max(1, Math.abs(lod0.scale));
      return start < hi - eps && lo < end - eps;
    });
  }
}

/** Drop the CPU copy once the renderer has uploaded it, as idetik does after a first upload. */
function releaseAfterUpload(texture: NonNullable<ChunkLike["texture"]>) {
  const data = texture.data;
  let frames = 0;
  const check = () => {
    if (texture.data !== data) return;
    if (!texture.needsUpdate) texture.releaseCpuData();
    // A texture not drawn now keeps its data until a view draws it.
    else if (++frames < 600) requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}

const open = new Map<string, Set<EditableLabelSource>>();

/** Make an open source reachable by `refreshLabelRegion` under `key` until the returned function is called. */
export function registerLabelSource(
  key: string,
  source: EditableLabelSource,
): () => void {
  let sources = open.get(key);
  if (!sources) open.set(key, (sources = new Set()));
  sources.add(source);
  return () => {
    sources.delete(source);
    if (!sources.size && open.get(key) === sources) open.delete(key);
  };
}

/**
 * Show a saved edit of the label source `key` in place. Returns the number of chunks re-read, or null when no
 * source for `key` is open (the caller must then open it, which reads it fresh).
 */
export async function refreshLabelRegion(
  key: string,
  region: VoxelBox,
): Promise<number | null> {
  const sources = open.get(key);
  if (!sources?.size) return null;
  const counts = await Promise.all([...sources].map((s) => s.refresh(region)));
  return counts.reduce((a, b) => a + b, 0);
}

export function labelSourceKey(
  projectId: string,
  runName: string,
  segmentation: string,
): string {
  return `${projectId}|${runName}|${segmentation}`;
}

/** Saved edits per label source key, for derived views (the 3D isosurface) that update from the changed chunks. */
interface Edits {
  seq: number;
  /** Boxes up to `floor` were dropped: a view older than that reads everything again. */
  floor: number;
  boxes: { seq: number; box: VoxelBox }[];
}

const MAX_PENDING_EDITS = 256;
const edited = new Map<string, Edits>();

export function noteLabelEdit(key: string, box: VoxelBox): void {
  const edits = edited.get(key) ?? { seq: 0, floor: 0, boxes: [] };
  edited.set(key, edits);
  edits.seq += 1;
  edits.boxes.push({ seq: edits.seq, box });
  if (edits.boxes.length > MAX_PENDING_EDITS) {
    edits.floor = edits.seq;
    edits.boxes = [];
  }
}

/**
 * The edits of `key` a view that has seen edits up to `seen` still has to apply: their boxes, or null when they are
 * no longer all known. `seq` is the edit the view is current with once applied; undefined when `key` was never edited.
 */
export function labelEditsSince(
  key: string,
  seen: number,
): { seq: number; boxes: VoxelBox[] | null } | undefined {
  const edits = edited.get(key);
  if (!edits) return undefined;
  return {
    seq: edits.seq,
    boxes:
      seen >= edits.floor
        ? edits.boxes.filter((e) => e.seq > seen).map((e) => e.box)
        : null,
  };
}

/** A view is current with the edits of `key` up to `seq`: their boxes are no longer needed. */
export function settleLabelEdits(key: string, seq: number): void {
  const edits = edited.get(key);
  if (edits) edits.boxes = edits.boxes.filter((e) => e.seq > seq);
}

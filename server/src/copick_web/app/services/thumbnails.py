"""Run gallery thumbnails: the central XY slice of a run's tomogram as a small grayscale PNG.

Bounded like apex-agent's tomogram gallery: one plane of the pyramid level closest to the requested size is read
(never the full-resolution volume), contrast is the slice's 2nd-98th percentiles, renders run a few at a time and
results are kept in a bounded in-memory cache (see ``cache.BoundedCache``). Which tomogram represents a run follows the desktop galleries
(napari-copick / chimerax-copick): denoised, then wbp, at the coarsest voxel spacing.
"""

import math
import struct
import threading
import zlib
from typing import Any, Callable, NamedTuple, Optional

import numpy as np

from .cache import BoundedCache

#: Tomogram types preferred for a run's thumbnail, in order (substring match, as the desktop galleries).
PREFERRED_TYPES = ("denoised", "wbp")
#: Pyramid levels larger than this (in x or y) are not read for thumbnails.
MAX_LEVEL_EDGE = 2048
_RENDER_SLOTS = threading.BoundedSemaphore(4)


def best_tomogram(run: Any, voxel_size: Optional[float] = None, tomo_type: Optional[str] = None) -> Optional[Any]:
    """The tomogram for a run's thumbnail: the requested one if given and present, else the first preferred type at
    the coarsest voxel spacing (or that spacing's first tomogram)."""
    tomograms = [t for vs in run.voxel_spacings for t in vs.tomograms]
    if voxel_size is not None and tomo_type:
        for t in tomograms:
            if t.tomo_type == tomo_type and math.isclose(t.voxel_spacing.voxel_size, voxel_size, abs_tol=1e-3):
                return t
    for size in sorted({t.voxel_spacing.voxel_size for t in tomograms}, reverse=True):
        at_size = [t for t in tomograms if t.voxel_spacing.voxel_size == size]
        for preferred in PREFERRED_TYPES:
            for t in at_size:
                if preferred in t.tomo_type.lower():
                    return t
        if at_size:
            return at_size[0]
    return None


def encode_png(gray: np.ndarray) -> bytes:
    """A grayscale 8-bit PNG of a 2D uint8 array."""
    height, width = gray.shape

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    rows = b"".join(b"\x00" + np.ascontiguousarray(gray[y], dtype=np.uint8).tobytes() for y in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows, 6)) + chunk(b"IEND", b"")


def _reduce(plane: np.ndarray, size: int) -> np.ndarray:
    """Block-average a plane so its longer edge is at most ``size``."""
    factor = max(1, math.ceil(max(plane.shape) / size))
    if factor == 1:
        return plane
    h, w = (plane.shape[0] // factor) * factor, (plane.shape[1] // factor) * factor
    return plane[:h, :w].reshape(h // factor, factor, w // factor, factor).mean(axis=(1, 3))


def _choose_level(store: Any, size: int, open_level: Callable) -> Any:
    """The pyramid level whose larger xy edge is closest to ``size`` (but not above MAX_LEVEL_EDGE)."""
    array, *_rest, n_levels = open_level(store, 0)
    best, best_score = None, math.inf
    for level in range(n_levels):
        candidate = array if level == 0 else open_level(store, level)[0]
        edge = max(candidate.shape[-2:])
        if edge > MAX_LEVEL_EDGE:
            continue
        score = abs(math.log(max(edge, 1) / size))
        if score < best_score:
            best, best_score = candidate, score
    if best is None:  # every level is huge: the coarsest one
        best = open_level(store, n_levels - 1)[0]
    return best


def render_thumbnail(tomogram: Any, size: int, open_level: Callable) -> bytes:
    """PNG of the central XY slice of a tomogram, at most ``size`` pixels on its longer edge."""
    array = _choose_level(tomogram.zarr(), size, open_level)
    plane = np.asarray(array[array.shape[-3] // 2], dtype=np.float32)
    plane = _reduce(plane, size)
    finite = plane[np.isfinite(plane)]
    if finite.size == 0:
        gray = np.zeros(plane.shape, dtype=np.uint8)
    else:
        low, high = np.percentile(finite, [2, 98])
        scale = (high - low) or 1.0
        gray = (np.clip((np.nan_to_num(plane, nan=low) - low) / scale, 0, 1) * 255).astype(np.uint8)
    return encode_png(gray)


class Thumbnail(NamedTuple):
    png: bytes
    tomo_type: str
    voxel_size: float


def thumbnail_size(value: Thumbnail) -> int:
    return len(value.png) + len(value.tomo_type) + 64


def thumbnail(
    service: Any,
    cache: BoundedCache,
    run_name: str,
    size: int,
    open_level: Callable,
    voxel_size: Optional[float] = None,
    tomo_type: Optional[str] = None,
) -> Optional[Thumbnail]:
    """A run's thumbnail and the tomogram it shows, or None if the run has no tomogram."""
    key = (run_name, None if voxel_size is None else round(float(voxel_size), 3), tomo_type, size)
    hit = cache.get(key)
    if hit is not None:
        return hit
    run = service.get_run(run_name)
    if run is None:
        return None
    tomogram = best_tomogram(run, voxel_size, tomo_type)
    if tomogram is None:
        return None
    with _RENDER_SLOTS:
        png = render_thumbnail(tomogram, size, open_level)
    result = Thumbnail(png, tomogram.tomo_type, float(tomogram.voxel_spacing.voxel_size))
    cache.put(key, result)
    return result

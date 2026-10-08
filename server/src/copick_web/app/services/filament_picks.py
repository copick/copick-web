"""Picks sampled along filament centrelines (written with "save filaments" when a pick spacing is given).

Same conventions as copick-shared-ui's ``copick_shared_ui.util.filaments`` (used by napari-copick and chimerax-copick),
so the three viewers write identical picks: samples every ``spacing`` Angstrom along each filament, grouped by filament
and ordered along it, ``instance_id`` = filament ID, transforms with +Z along the tangent (rotation-minimising frames).
"""

from typing import Iterable, Optional, Sequence, Tuple

import numpy as np


def _arc_lengths(points: np.ndarray) -> np.ndarray:
    seg = np.linalg.norm(np.diff(points, axis=0), axis=1)
    return np.concatenate([[0.0], np.cumsum(seg)])


def resample_by_arc_length(points: np.ndarray, spacing: float, include_end: bool = False) -> np.ndarray:
    """Points ``spacing`` apart along a polyline, starting at its first point.

    Args:
        points: (M, 3) ordered polyline.
        spacing: Distance between samples (same units as the points), > 0.
        include_end: Also add the last point if it is not already a sample.
    """
    if spacing <= 0:
        raise ValueError("spacing must be positive")
    pts = np.asarray(points, dtype=float).reshape(-1, 3)
    if len(pts) < 2:
        return pts.copy()
    s = _arc_lengths(pts)
    targets = np.arange(0.0, s[-1] + 1e-9, spacing)
    if include_end and s[-1] - targets[-1] > 1e-6:
        targets = np.append(targets, s[-1])
    return np.stack([np.interp(targets, s, pts[:, i]) for i in range(3)], axis=1)


def polyline_tangents(points: np.ndarray) -> np.ndarray:
    """Unit tangents in point order (central differences inside, one-sided at the ends)."""
    pts = np.asarray(points, dtype=float).reshape(-1, 3)
    if len(pts) < 2:
        return np.tile([0.0, 0.0, 1.0], (len(pts), 1))
    t = np.gradient(pts, axis=0)
    norms = np.linalg.norm(t, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return t / norms


def parallel_transport_frames(tangents: np.ndarray, reference: Optional[Sequence[float]] = None) -> np.ndarray:
    """Rotation-minimising frames along a curve: (N, 3, 3) matrices whose columns are x, y, z with z = tangent.

    The first frame's x axis is ``reference`` (default the coordinate axis least aligned with the first tangent)
    made orthogonal to the tangent; later x axes are transported along the curve, so the frame does not spin.
    """
    t = np.asarray(tangents, dtype=float).reshape(-1, 3)
    n = len(t)
    frames = np.zeros((n, 3, 3))
    if n == 0:
        return frames
    if reference is None:
        reference = np.eye(3)[int(np.argmin(np.abs(t[0])))]
    x = np.asarray(reference, dtype=float) - t[0] * float(np.dot(reference, t[0]))
    if np.linalg.norm(x) < 1e-9:
        x = np.eye(3)[int(np.argmin(np.abs(t[0])))] - t[0] * t[0][int(np.argmin(np.abs(t[0])))]
    x /= np.linalg.norm(x)
    for i in range(n):
        if i:
            x = x - t[i] * float(np.dot(x, t[i]))
            norm = np.linalg.norm(x)
            if norm < 1e-9:  # tangent flipped onto x; restart from a fresh orthogonal axis
                x = np.eye(3)[int(np.argmin(np.abs(t[i])))] - t[i] * t[i][int(np.argmin(np.abs(t[i])))]
                norm = np.linalg.norm(x)
            x /= norm
        frames[i, :, 0] = x
        frames[i, :, 1] = np.cross(t[i], x)
        frames[i, :, 2] = t[i]
    return frames


def sample_filament_poses(points: np.ndarray, spacing: float) -> Tuple[np.ndarray, np.ndarray]:
    """Sample a centreline every ``spacing``: positions (N, 3) and transforms (N, 4, 4) with +Z along the tangent and
    no translation."""
    pos = resample_by_arc_length(points, spacing)
    if len(pos) < 2:
        tangents = polyline_tangents(np.asarray(points, dtype=float).reshape(-1, 3))[:1]
    else:
        tangents = polyline_tangents(pos)
    frames = parallel_transport_frames(tangents)
    transforms = np.tile(np.eye(4), (len(pos), 1, 1))
    transforms[:, :3, :3] = frames
    return pos, transforms


def filaments_to_picks(
    filaments: Iterable,
    spacing: float,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Picks sampled along ``CopickFilament`` centrelines, grouped by filament (file order) and ordered along each.

    Returns:
        positions (N, 3), transforms (N, 4, 4), instance_ids (N,) and scores (N,), ready for
        ``CopickPicks.from_numpy(positions, transforms, instance_ids=..., scores=...)``.
    """
    pos, tr, ids, sc = [], [], [], []
    for f in filaments:
        p, t = sample_filament_poses(np.asarray(f.points, dtype=float), spacing)
        pos.append(p)
        tr.append(t)
        ids.append(np.full(len(p), int(f.instance_id), dtype=np.int64))
        sc.append(np.full(len(p), float(f.score)))
    if not pos:
        return np.zeros((0, 3)), np.zeros((0, 4, 4)), np.zeros(0, dtype=np.int64), np.zeros(0)
    return np.concatenate(pos), np.concatenate(tr), np.concatenate(ids), np.concatenate(sc)

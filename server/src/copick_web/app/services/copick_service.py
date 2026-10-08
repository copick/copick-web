"""Copick data access service."""

import logging
import math
import threading
from typing import Iterable, Optional

import copick
import numpy as np

from . import compat
from .cache import BoundedCache
from .object_types import ObjectTypesEditor
from .thumbnails import thumbnail_size

logger = logging.getLogger(__name__)

#: Segmentation types served under the legacy ``/zarr/seg/`` prefix.
LEGACY_SEG_TYPES = ("binary", "multilabel")

_MB = 1024 * 1024

#: Default cap on the boundary voxels returned for the 3D view.
DEFAULT_SURFACE_POINTS = 250_000
#: Largest pyramid level (in voxels) scanned for boundary voxels; finer levels are skipped.
SURFACE_MAX_VOXELS = 40_000_000


def _same_voxel_size(a: float, b: float) -> bool:
    return math.isclose(float(a), float(b), rel_tol=0.0, abs_tol=1e-3)


class CopickService:
    """Service for accessing copick data."""

    def __init__(
        self,
        config_path: str,
        thumbnail_cache_bytes: int = 64 * _MB,
        measurement_cache_bytes: int = 512 * _MB,
        cache_max_age: Optional[float] = 3600,
    ):
        """Initialize with a copick configuration file path.

        Args:
            thumbnail_cache_bytes: Size limit of the run gallery thumbnail cache.
            measurement_cache_bytes: Size limit of the instance measurement and segmentation surface cache.
            cache_max_age: Seconds after which cached entries are dropped (None: never).
        """
        self.root = copick.from_file(config_path)
        self.config_path = config_path
        self.object_types = ObjectTypesEditor(self.root, config_path)
        self.thumbnails: BoundedCache = BoundedCache(thumbnail_cache_bytes, cache_max_age, size_of=thumbnail_size)
        self._measurements: BoundedCache = BoundedCache(measurement_cache_bytes, cache_max_age)
        self._reload_lock = threading.Lock()

    def reload(self) -> int:
        """Re-open the project from its configuration file, like the desktop plugins' Reload.

        copick keeps the runs and the entity lists it has read, so runs, tomograms and annotations added (or
        removed) by other tools only show up after this. The old root's filesystems are reconnected first, which
        also drops fsspec's cached instances and directory listings, and the thumbnail and measurement caches are
        cleared. If the configuration cannot be opened, the project stays as it was and the error is raised.

        Returns:
            The number of runs.
        """
        with self._reload_lock:
            reconnect = getattr(self.root, "reconnect", None)  # also drops fsspec's cached filesystems
            if reconnect is not None:
                try:
                    reconnect()
                except Exception:  # noqa: BLE001  (the new root connects on its own)
                    logger.warning("Reconnecting the copick filesystems failed", exc_info=True)
            root = copick.from_file(self.config_path)
            self.root = root
            self.object_types = ObjectTypesEditor(root, self.config_path)
            self.thumbnails.clear()
            self._measurements.clear()
            return len(root.runs)

    def sweep_caches(self) -> int:
        """Drop expired cache entries (run periodically by the app); returns how many."""
        return self.thumbnails.sweep() + self._measurements.sweep()

    @property
    def config(self):
        """Get the copick configuration."""
        return self.root.config

    @property
    def pickable_objects(self):
        """Get all pickable objects (re-read if the configuration file's object types changed on disk)."""
        self.object_types.sync()
        return self.root.config.pickable_objects

    def get_pickable_object(self, name: str):
        """Get a pickable object by name."""
        for obj in self.pickable_objects:
            if obj.name == name:
                return obj
        return None

    def get_runs(self) -> list[str]:
        """Get all run names."""
        return [run.name for run in self.root.runs]

    def get_run(self, name: str):
        """Get a run by name."""
        return self.root.get_run(name)

    def get_voxel_spacings(self, run_name: str) -> list[float]:
        """Get all voxel spacings for a run."""
        run = self.get_run(run_name)
        if not run:
            return []
        return [vs.voxel_size for vs in run.voxel_spacings]

    def get_tomograms(self, run_name: str, voxel_size: float) -> list[str]:
        """Get all tomogram types for a run and voxel spacing."""
        run = self.get_run(run_name)
        if not run:
            return []
        vs = run.get_voxel_spacing(voxel_size)
        if not vs:
            return []
        return [tomo.tomo_type for tomo in vs.tomograms]

    def get_tomogram(self, run_name: str, voxel_size: float, tomo_type: str):
        """Get a specific tomogram."""
        run = self.get_run(run_name)
        if not run:
            return None
        vs = run.get_voxel_spacing(voxel_size)
        if not vs:
            return None
        return vs.get_tomogram(tomo_type)

    def get_tomogram_zarr_store(self, run_name: str, voxel_size: float, tomo_type: str):
        """Get the zarr store for a tomogram."""
        tomo = self.get_tomogram(run_name, voxel_size, tomo_type)
        if not tomo:
            return None
        return tomo.zarr()

    def get_picks(
        self,
        run_name: str,
        object_name: Optional[str] = None,
        user_id: Optional[str] = None,
        session_id: Optional[str] = None,
    ):
        """Get picks for a run with optional filtering."""
        run = self.get_run(run_name)
        if not run:
            return []

        picks = run.picks

        if object_name:
            picks = [p for p in picks if p.pickable_object_name == object_name]
        if user_id:
            picks = [p for p in picks if p.user_id == user_id]
        if session_id:
            picks = [p for p in picks if p.session_id == session_id]

        return picks

    def get_pick(self, run_name: str, object_name: str, user_id: str, session_id: str):
        """Get a specific picks collection."""
        picks = self.get_picks(run_name, object_name, user_id, session_id)
        return picks[0] if picks else None

    def get_segmentations(
        self,
        run_name: str,
        name: Optional[str] = None,
        user_id: Optional[str] = None,
        session_id: Optional[str] = None,
        voxel_size: Optional[float] = None,
        seg_types: Optional[Iterable[str]] = None,
    ):
        """Get segmentations for a run with optional filtering.

        ``seg_types`` restricts the result to these segmentation types (see ``compat.SEGMENTATION_TYPES``). Since
        instance and panoptic segmentations, name/user/session/voxel size no longer identify a segmentation: a
        binary and an instance segmentation can share all four.
        """
        run = self.get_run(run_name)
        if not run:
            return []

        segs = run.segmentations

        if name:
            segs = [s for s in segs if s.name == name]
        if user_id:
            segs = [s for s in segs if s.user_id == user_id]
        if session_id:
            segs = [s for s in segs if s.session_id == session_id]
        if voxel_size:
            segs = [s for s in segs if _same_voxel_size(s.voxel_size, voxel_size)]
        if seg_types is not None:
            wanted = set(seg_types)
            segs = [s for s in segs if compat.seg_type(s) in wanted]

        return segs

    def get_segmentation(
        self,
        run_name: str,
        name: str,
        user_id: str,
        session_id: str,
        voxel_size: float,
        seg_type: Optional[str] = None,
    ):
        """Get one segmentation, optionally of one type (``None``: binary or multilabel, the legacy lookup)."""
        types = (seg_type,) if seg_type else LEGACY_SEG_TYPES
        segs = self.get_segmentations(run_name, name, user_id, session_id, voxel_size, seg_types=types)
        return segs[0] if segs else None

    def get_segmentation_zarr_store(
        self,
        run_name: str,
        name: str,
        user_id: str,
        session_id: str,
        voxel_size: float,
        seg_type: Optional[str] = None,
    ):
        """Get the zarr store for a segmentation of the given type (``None``: binary or multilabel)."""
        seg = self.get_segmentation(run_name, name, user_id, session_id, voxel_size, seg_type)
        if seg is None:
            return None
        return seg.zarr()

    # --- Instances ---

    def get_instances(
        self,
        run_name: str,
        seg_type: str,
        name: str,
        user_id: str,
        session_id: str,
        voxel_size: float,
        level: int = 1,
    ) -> Optional[dict]:
        """Measure the instances of an instance or panoptic segmentation on one pyramid level.

        Returns ``{"level", "voxel_size", "instances": [{instance_id, label, voxel_count, centroid}]}`` with centroids
        in Angstrom (x, y, z), or None if the segmentation does not exist. Results are cached per segmentation and
        level; the data is read slab by slab so memory stays bounded.
        """
        if seg_type not in ("instance", "panoptic"):
            raise ValueError(f"Instances are only defined for instance and panoptic segmentations, not {seg_type}")
        seg = self.get_segmentation(run_name, name, user_id, session_id, voxel_size, seg_type)
        if seg is None:
            return None
        key = (run_name, seg_type, name, user_id, session_id, round(float(voxel_size), 3), level)
        cached = self._measurements.get(key)
        if cached is not None:
            return cached
        result = measure_instances(seg.zarr(), panoptic=seg_type == "panoptic", level=level)
        self._measurements.put(key, result)
        return result

    # --- Surface points (3D view) ---

    def get_surface_points(
        self,
        run_name: str,
        seg_type: Optional[str],
        name: str,
        user_id: str,
        session_id: str,
        voxel_size: float,
        max_points: int = DEFAULT_SURFACE_POINTS,
    ) -> Optional[dict]:
        """Boundary voxels of a segmentation, for drawing it as a point cloud in the 3D view.

        See :func:`surface_points`. Results are cached with the instance measurements; None if the segmentation
        does not exist.
        """
        seg = self.get_segmentation(run_name, name, user_id, session_id, voxel_size, seg_type)
        if seg is None:
            return None
        kind = seg_type or compat.seg_type(seg)
        key = ("surface", run_name, kind, name, user_id, session_id, round(float(voxel_size), 3), max_points)
        cached = self._measurements.get(key)
        if cached is not None:
            return cached
        result = surface_points(seg.zarr(), panoptic=kind == "panoptic", max_points=max_points)
        self._measurements.put(key, result)
        return result

    # --- Filaments ---

    def get_filaments(
        self,
        run_name: str,
        object_name: Optional[str] = None,
        user_id: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> list:
        """Get the filament sets of a run (empty on a copick without filaments)."""
        if not compat.has_filaments():
            return []
        run = self.get_run(run_name)
        if not run:
            return []
        return run.get_filaments(object_name=object_name, user_id=user_id, session_id=session_id)

    def get_filament_set(self, run_name: str, object_name: str, user_id: str, session_id: str):
        """Get one set of filaments, or None."""
        sets = self.get_filaments(run_name, object_name, user_id, session_id)
        return sets[0] if sets else None

    def save_filaments(
        self,
        run_name: str,
        object_name: str,
        user_id: str,
        session_id: str,
        filaments: list,
        voxel_spacing: Optional[float] = None,
        pick_spacing: Optional[float] = None,
    ) -> tuple:
        """Replace a filament set (created if missing) and optionally the picks sampled along it.

        Args:
            filaments: Dicts with ``instance_id``, ``polarity_known``, ``score``, ``radius``, ``metadata`` and either
                ``curve`` (regenerated by copick) or ``points`` (stored as they are).
            pick_spacing: If given, picks every ``pick_spacing`` Angstrom replace the picks of the same object, user
                and session.

        Returns:
            ``(filament set, number of sampled picks)``.

        Raises:
            ValueError: Unknown run or object, duplicate or invalid IDs, or an invalid curve.
        """
        if not compat.has_filaments():
            raise NotImplementedError("The installed copick does not support filaments")
        from copick.models import CopickFilament

        from .filament_picks import filaments_to_picks

        run = self.get_run(run_name)
        if run is None:
            raise ValueError(f"Run '{run_name}' not found")
        if self.get_pickable_object(object_name) is None:
            raise ValueError(f"Unknown object '{object_name}'")
        ids = [int(f["instance_id"]) for f in filaments]
        if len(set(ids)) != len(ids):
            raise ValueError("Filament IDs must be unique")
        models = []
        for f in filaments:
            fields = {
                "polarity_known": bool(f.get("polarity_known", False)),
                "score": float(f.get("score", 1.0)),
                "radius": f.get("radius"),
                "metadata": f.get("metadata") or {},
            }
            if f.get("curve") is not None:
                models.append(CopickFilament.from_curve(int(f["instance_id"]), f["curve"], **fields))
            elif f.get("points") is not None and len(f["points"]) >= 2:
                models.append(CopickFilament(instance_id=int(f["instance_id"]), points=f["points"], **fields))
            else:
                raise ValueError(f"Filament {f['instance_id']} needs a curve or at least two points")
        target = run.new_filaments(object_name, session_id=session_id, user_id=user_id, exist_ok=True)
        target.filaments = models
        if voxel_spacing is not None and hasattr(target.meta, "voxel_spacing"):
            target.meta.voxel_spacing = float(voxel_spacing)
        target.store()
        n_picks = 0
        if pick_spacing:
            positions, transforms, ids_, scores = filaments_to_picks(models, float(pick_spacing))
            picks = run.new_picks(object_name, session_id=session_id, user_id=user_id, exist_ok=True)
            if compat.has_pick_identity():
                picks.from_numpy(positions, transforms, instance_ids=ids_, scores=scores)
            else:
                picks.from_numpy(positions, transforms)
            n_picks = len(positions)
        return target, n_picks

    def delete_filaments(self, run_name: str, object_name: str, user_id: str, session_id: str) -> bool:
        """Delete a filament set; False if it does not exist."""
        run = self.get_run(run_name)
        if run is None or self.get_filament_set(run_name, object_name, user_id, session_id) is None:
            return False
        run.delete_filaments(object_name=object_name, user_id=user_id, session_id=session_id)
        return True

    # --- Picks mutation methods ---

    # --- Picks mutation methods ---

    def create_picks(
        self,
        run_name: str,
        object_name: str,
        user_id: str,
        session_id: str,
    ):
        """Create a new empty picks collection.

        Args:
            run_name: Name of the run
            object_name: Name of the pickable object
            user_id: User identifier
            session_id: Session identifier

        Returns:
            The created CopickPicks object

        Raises:
            ValueError: If run not found or object doesn't exist
        """
        run = self.get_run(run_name)
        if not run:
            raise ValueError(f"Run '{run_name}' not found")

        # Validate object exists
        obj = self.get_pickable_object(object_name)
        if not obj:
            raise ValueError(f"Pickable object '{object_name}' not found in configuration")

        # Create new picks using copick API
        picks = run.new_picks(
            object_name=object_name,
            session_id=session_id,
            user_id=user_id,
        )
        picks.points = []
        picks.store()
        return picks

    def update_picks(
        self,
        run_name: str,
        object_name: str,
        user_id: str,
        session_id: str,
        points: list[dict],
    ):
        """Update picks with new points.

        Args:
            run_name: Name of the run
            object_name: Name of the pickable object
            user_id: User identifier
            session_id: Session identifier
            points: List of point dicts with x, y, z (the stored location), instance_id, score and an optional
                4x4 transformation. Points without a transformation get the identity.

        Returns:
            The updated CopickPicks object

        Raises:
            ValueError: If picks not found or a transformation is not a valid 4x4 affine matrix
        """
        from copick.models import CopickLocation, CopickPoint

        pick = self.get_pick(run_name, object_name, user_id, session_id)
        if not pick:
            raise ValueError(f"Picks not found for object '{object_name}', user '{user_id}', session '{session_id}'")

        new_points = []
        for pt in points:
            kwargs = {
                "location": CopickLocation(x=pt["x"], y=pt["y"], z=pt["z"]),
                "instance_id": pt.get("instance_id") if pt.get("instance_id") is not None else 0,
                "score": pt.get("score") if pt.get("score") is not None else 1.0,
            }
            transformation = pt.get("transformation")
            if transformation is not None:
                arr = np.asarray(transformation, dtype=float)
                if arr.shape != (4, 4) or not np.allclose(arr[3, :], [0.0, 0.0, 0.0, 1.0]):
                    raise ValueError("A point transformation must be a 4x4 affine matrix with last row [0, 0, 0, 1].")
                kwargs["transformation_"] = arr.tolist()
            new_points.append(CopickPoint(**kwargs))
        pick.points = new_points
        pick.store()
        return pick

    def delete_picks_collection(
        self,
        run_name: str,
        object_name: str,
        user_id: str,
        session_id: str,
    ) -> bool:
        """Delete a picks collection.

        Args:
            run_name: Name of the run
            object_name: Name of the pickable object
            user_id: User identifier
            session_id: Session identifier

        Returns:
            True if deleted successfully

        Raises:
            ValueError: If run or picks not found
        """
        run = self.get_run(run_name)
        if not run:
            raise ValueError(f"Run '{run_name}' not found")

        # Verify picks exist first
        pick = self.get_pick(run_name, object_name, user_id, session_id)
        if not pick:
            raise ValueError(f"Picks not found for object '{object_name}', user '{user_id}', session '{session_id}'")

        run.delete_picks(
            object_name=object_name,
            user_id=user_id,
            session_id=session_id,
        )
        return True


def _open_level(store, level: int):
    """Open one pyramid level of an OME-Zarr store: ``(array, scale_zyx, translation_zyx, level, n_levels)``."""
    import zarr
    from copick.util.ome import get_level_path, get_multiscales

    # Zarr 3 opens both v2 (OME-Zarr 0.4) and v3 (OME-Zarr 0.5) stores; the level's path comes from the OME metadata.
    group = zarr.open_group(store, mode="r")
    datasets = get_multiscales(group)[0]["datasets"]
    level = max(0, min(int(level), len(datasets) - 1))
    dataset = datasets[level]
    scale = [1.0, 1.0, 1.0]
    translation = [0.0, 0.0, 0.0]
    for transform in dataset.get("coordinateTransformations", []):
        if transform.get("type") == "scale":
            scale = [float(v) for v in transform["scale"][-3:]]
        elif transform.get("type") == "translation":
            translation = [float(v) for v in transform["translation"][-3:]]
    return group[get_level_path(group, level)], scale, translation, level, len(datasets)


#: The six face neighbours (dz, dy, dx).
_FACES = ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))


def _boundary_voxels(array, panoptic: bool, slab: int = 32):
    """Voxels whose label differs from a face neighbour (volume edges count as background).

    Returns ``(zyx, values, normals)``: int64 ``(N, 3)`` voxel indices; ``(N,)`` labels, or ``(N, 2)`` (label,
    instance) for panoptic stores; int8 ``(N, 3)`` outward normals (x, y, z), the sum of the exposed faces.
    """
    depth = array.shape[-3]
    out_zyx, out_values, out_normals = [], [], []
    for z0 in range(0, depth, slab):
        z1 = min(depth, z0 + slab)
        lo, hi = max(0, z0 - 1), min(depth, z1 + 1)
        if panoptic:
            block = np.asarray(array[:, lo:hi])
            keys = (block[0].astype(np.int64) << 32) | block[1].astype(np.int64)
        else:
            keys = np.asarray(array[lo:hi]).astype(np.int64)
        # Pad to one voxel of halo on every side; outside the volume is background.
        keys = np.pad(keys, ((int(lo == z0), int(hi == z1)), (1, 1), (1, 1)))
        core = keys[1:-1, 1:-1, 1:-1]
        inside = core != 0
        if not inside.any():
            continue
        normals = np.zeros(core.shape + (3,), dtype=np.int8)
        exposed = np.zeros(core.shape, dtype=bool)
        for dz, dy, dx in _FACES:
            neighbour = keys[
                1 + dz : keys.shape[0] - 1 + dz, 1 + dy : keys.shape[1] - 1 + dy, 1 + dx : keys.shape[2] - 1 + dx
            ]
            face = inside & (neighbour != core)
            exposed |= face
            normals[face] += np.array((dx, dy, dz), dtype=np.int8)
        zz, yy, xx = np.nonzero(exposed)
        values = core[zz, yy, xx]
        if panoptic:
            values = np.stack([values >> 32, values & 0xFFFFFFFF], axis=1)
        out_zyx.append(np.stack([zz + z0, yy, xx], axis=1))
        out_values.append(values)
        out_normals.append(normals[zz, yy, xx])
    if not out_zyx:
        empty_values = np.zeros((0, 2) if panoptic else (0,), dtype=np.int64)
        return np.zeros((0, 3), dtype=np.int64), empty_values, np.zeros((0, 3), dtype=np.int8)
    return np.concatenate(out_zyx), np.concatenate(out_values), np.concatenate(out_normals)


def surface_points(store, panoptic: bool, max_points: int = DEFAULT_SURFACE_POINTS) -> dict:
    """Boundary voxels of a segmentation on the finest pyramid level that fits, as a point cloud.

    Starts at the finest level with at most :data:`SURFACE_MAX_VOXELS` voxels and moves to coarser levels while
    there are more than ``max_points`` boundary voxels; the rest is thinned evenly.

    Returns:
        ``{"level", "voxel_size", "positions", "values", "normals"}``: float32 ``(N, 3)`` voxel centres in Angstrom
        (x, y, z); uint32 ``(N,)`` values, or ``(N, 2)`` (label, instance) for panoptic stores; int8 ``(N, 3)``
        outward normals.
    """
    array, scale, translation, level, n_levels = _open_level(store, 0)
    while level < n_levels - 1 and int(np.prod(array.shape[-3:])) > SURFACE_MAX_VOXELS:
        array, scale, translation, level, n_levels = _open_level(store, level + 1)
    while True:
        zyx, values, normals = _boundary_voxels(array, panoptic)
        if len(zyx) <= max_points or level >= n_levels - 1:
            break
        array, scale, translation, level, n_levels = _open_level(store, level + 1)
    if len(zyx) > max_points:
        keep = np.linspace(0, len(zyx) - 1, max_points).astype(np.int64)
        zyx, values, normals = zyx[keep], values[keep], normals[keep]
    positions = np.empty((len(zyx), 3), dtype=np.float32)
    for out, axis in enumerate((2, 1, 0)):  # (z, y, x) indices -> (x, y, z) Angstrom
        positions[:, out] = zyx[:, axis] * scale[axis] + translation[axis]
    return {
        "level": level,
        "voxel_size": float(scale[2]),
        "positions": positions,
        "values": values.astype(np.uint32),
        "normals": normals,
    }


def encode_surface_points(result: dict) -> bytes:
    """Pack :func:`surface_points` into the little-endian wire format of the ``surface`` endpoint.

    Header (16 bytes): uint32 point count N, uint32 channel count C (1, or 2 for panoptic), float32 voxel size
    (Angstrom), uint32 level. Then float32 positions ``[N*3]`` (x, y, z Angstrom), uint32 values ``[N*C]``, int8
    normals ``[N*3]``.
    """
    values = result["values"]
    channels = 1 if values.ndim == 1 else values.shape[1]
    header = np.array([len(values), channels], dtype="<u4").tobytes()
    header += np.array([result["voxel_size"]], dtype="<f4").tobytes()
    header += np.array([result["level"]], dtype="<u4").tobytes()
    return (
        header
        + np.ascontiguousarray(result["positions"], dtype="<f4").tobytes()
        + np.ascontiguousarray(values, dtype="<u4").tobytes()
        + np.ascontiguousarray(result["normals"], dtype=np.int8).tobytes()
    )


def measure_instances(store, panoptic: bool, level: int = 1, slab: int = 32) -> dict:
    """Count voxels and centroids of every instance (or panoptic segment) on one pyramid level of a store.

    Args:
        store: The segmentation's OME-Zarr store.
        panoptic: Whether the store is a ``(2, Z, Y, X)`` panoptic segmentation (label, instance channels).
        level: The pyramid level, clamped to the available levels.
        slab: Number of Z slices read at a time.

    Returns:
        ``{"level", "voxel_size", "instances"}``; centroids are in Angstrom, ordered (x, y, z).
    """
    array, scale, translation, level, _ = _open_level(store, level)
    depth = array.shape[-3]

    counts: dict[int, float] = {}
    sums: dict[int, np.ndarray] = {}
    for z0 in range(0, depth, slab):
        z1 = min(depth, z0 + slab)
        if panoptic:
            block = np.asarray(array[:, z0:z1])
            labels = block[0].astype(np.int64)
            instances = block[1].astype(np.int64)
            mask = labels > 0
            keys = (labels[mask] << 32) | instances[mask]
        else:
            block = np.asarray(array[z0:z1]).astype(np.int64)
            mask = block > 0
            keys = block[mask]
        if keys.size == 0:
            continue
        zz, yy, xx = np.nonzero(mask)
        ids, inverse = np.unique(keys, return_inverse=True)
        n = np.bincount(inverse, minlength=len(ids))
        sx = np.bincount(inverse, weights=xx, minlength=len(ids))
        sy = np.bincount(inverse, weights=yy, minlength=len(ids))
        sz = np.bincount(inverse, weights=zz + z0, minlength=len(ids))
        for i, key in enumerate(ids.tolist()):
            counts[key] = counts.get(key, 0) + int(n[i])
            acc = sums.setdefault(key, np.zeros(3))
            acc += (sx[i], sy[i], sz[i])

    instances_out = []
    for key in sorted(counts):
        n = counts[key]
        mean = sums[key] / n
        centroid = (
            float(mean[0] * scale[2] + translation[2]),
            float(mean[1] * scale[1] + translation[1]),
            float(mean[2] * scale[0] + translation[0]),
        )
        if panoptic:
            label, instance_id = key >> 32, key & 0xFFFFFFFF
        else:
            label, instance_id = None, key
        instances_out.append(
            {"instance_id": int(instance_id), "label": label, "voxel_count": int(n), "centroid": centroid}
        )
    return {"level": level, "voxel_size": float(scale[2]), "instances": instances_out}


# Global service instance (set in main.py)
copick_service: Optional[CopickService] = None


def get_copick_service() -> CopickService:
    """Get the global copick service instance."""
    if copick_service is None:
        raise RuntimeError("CopickService not initialized")
    return copick_service


def init_copick_service(config_path: str, **cache_options) -> CopickService:
    """Initialize the global copick service (``cache_options``: see ``CopickService``)."""
    global copick_service
    copick_service = CopickService(config_path, **cache_options)
    return copick_service

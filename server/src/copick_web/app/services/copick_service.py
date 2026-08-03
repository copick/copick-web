"""Copick data access service."""

import logging
import threading
from typing import Optional

import copick

logger = logging.getLogger(__name__)


class CopickService:
    """Service for accessing copick data.

    Used by both project sources (local config and registry). The metadata
    methods (``get_runs``, ``get_picks``, ``get_segmentations``, ...) are shared

    The zarr-store accessors below are only hit for **local** projects:
    the ``/zarr/{pid}/...`` proxy route resolves chunks through this
    service. Registry projects publish ``data_url`` and the browser
    fetches chunks directly, so ``_tomo_store_cache`` /
    ``_seg_store_cache`` stay empty in pure-registry deployments. See
    ``services/project_registry.py`` for the source split and
    ``services/zarr_urls.py`` for the URL routing.
    """

    def __init__(self, root):
        """Initialize with a pre-built copick root."""
        self.root = root
        # Zarr-store mappers built from copick objects. The proxy routes hit
        # these on every chunk fetch — caching avoids re-walking the copick
        # tree and re-opening the fsspec mapper for each of the hundreds of
        # chunks that make up a single tomogram view. Local-mode only;
        # registry projects bypass the proxy entirely.
        self._tomo_store_cache: dict[tuple[str, float, str], object] = {}
        self._seg_store_cache: dict[tuple[str, str, str, str, float], object] = {}
        self._store_cache_lock = threading.Lock()

    @classmethod
    def from_config_path(cls, config_path: str) -> "CopickService":
        """Build a service from a local copick config file path."""
        return cls(copick.from_file(config_path))

    @classmethod
    def from_config_string(cls, config_body: str) -> "CopickService":
        """Build a service from a raw config JSON body (e.g., fetched from registry)."""
        return cls(copick.from_string(config_body))

    @property
    def config(self):
        """Get the copick configuration."""
        return self.root.config

    @property
    def pickable_objects(self):
        """Get all pickable objects."""
        return self.root.config.pickable_objects

    def get_pickable_object(self, name: str):
        """Get a pickable object by name."""
        for obj in self.pickable_objects:
            if obj.name == name:
                return obj
        return None

    def get_runs(self) -> list[str]:
        """Get all run names."""
        names = [run.name for run in self.root.runs]
        if not names:
            cfg = self.root.config
            logger.warning(
                "get_runs returned 0 runs. config_type=%s overlay_root=%s overlay_fs_args=%s "
                "static_root=%s static_fs_args=%s explicit_runs=%s",
                getattr(cfg, "config_type", None),
                getattr(cfg, "overlay_root", None),
                getattr(cfg, "overlay_fs_args", None),
                getattr(cfg, "static_root", None),
                getattr(cfg, "static_fs_args", None),
                getattr(cfg, "runs", None),
            )
        else:
            logger.debug("get_runs returned %d runs: %s", len(names), names[:5])
        return names

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
        """Get the zarr store for a tomogram (cached per service instance)."""
        key = (run_name, voxel_size, tomo_type)
        with self._store_cache_lock:
            cached = self._tomo_store_cache.get(key)
        if cached is not None:
            return cached

        tomo = self.get_tomogram(run_name, voxel_size, tomo_type)
        if not tomo:
            return None
        store = tomo.zarr()

        with self._store_cache_lock:
            # Race-safe: if another thread built one in the meantime, prefer theirs
            # (functionally identical, but keeps a single canonical instance).
            existing = self._tomo_store_cache.get(key)
            if existing is not None:
                return existing
            self._tomo_store_cache[key] = store
        return store

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
    ):
        """Get segmentations for a run with optional filtering."""
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
            segs = [s for s in segs if s.voxel_size == voxel_size]

        return segs

    def get_segmentation_zarr_store(self, run_name: str, name: str, user_id: str, session_id: str, voxel_size: float):
        """Get the zarr store for a segmentation (cached per service instance)."""
        key = (run_name, name, user_id, session_id, voxel_size)
        with self._store_cache_lock:
            cached = self._seg_store_cache.get(key)
        if cached is not None:
            return cached

        segs = self.get_segmentations(run_name, name, user_id, session_id, voxel_size)
        if not segs:
            return None
        store = segs[0].zarr()

        with self._store_cache_lock:
            existing = self._seg_store_cache.get(key)
            if existing is not None:
                return existing
            self._seg_store_cache[key] = store
        return store

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
            points: List of point dicts with x, y, z, instance_id, score

        Returns:
            The updated CopickPicks object

        Raises:
            ValueError: If picks not found
        """
        from copick.models import CopickLocation, CopickPoint

        pick = self.get_pick(run_name, object_name, user_id, session_id)
        if not pick:
            raise ValueError(f"Picks not found for object '{object_name}', user '{user_id}', session '{session_id}'")

        # Convert point dicts to CopickPoint objects
        pick.points = [
            CopickPoint(
                location=CopickLocation(x=pt["x"], y=pt["y"], z=pt["z"]),
                instance_id=pt.get("instance_id"),
                score=pt.get("score", 1.0),
            )
            for pt in points
        ]
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

"""Copick data access service."""

from typing import Optional

import copick


class CopickService:
    """Service for accessing copick data."""

    def __init__(self, config_path: str):
        """Initialize with a copick configuration file path."""
        self.root = copick.from_file(config_path)

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
        """Get the zarr store for a segmentation."""
        segs = self.get_segmentations(run_name, name, user_id, session_id, voxel_size)
        if not segs:
            return None
        return segs[0].zarr()

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
            raise ValueError(
                f"Picks not found for object '{object_name}', user '{user_id}', session '{session_id}'"
            )

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
            raise ValueError(
                f"Picks not found for object '{object_name}', user '{user_id}', session '{session_id}'"
            )

        run.delete_picks(
            object_name=object_name,
            user_id=user_id,
            session_id=session_id,
        )
        return True


# Global service instance (set in main.py)
copick_service: Optional[CopickService] = None


def get_copick_service() -> CopickService:
    """Get the global copick service instance."""
    if copick_service is None:
        raise RuntimeError("CopickService not initialized")
    return copick_service


def init_copick_service(config_path: str) -> CopickService:
    """Initialize the global copick service."""
    global copick_service
    copick_service = CopickService(config_path)
    return copick_service

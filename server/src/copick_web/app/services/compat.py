"""Runtime feature detection for the installed copick.

copick-web supports ``copick>=0.8.0``. Newer copick releases add filament objects, the Filaments entity, pick
identity helpers and typed (instance / panoptic) segmentations. Everything here degrades to the old behaviour when
the installed copick predates a feature, so the server works on both.

The ``has_*`` functions are evaluated on every call (they are cheap ``hasattr`` checks) so tests can simulate an
older copick with ``monkeypatch.delattr``. The ``HAS_*`` constants are the values at import time, for display.
"""

from __future__ import annotations

from typing import Any, Optional

import numpy as np
from copick import models as copick_models

#: Channels of a panoptic segmentation, in order (copick.util.segmentation.PANOPTIC_CHANNELS).
PANOPTIC_CHANNELS = ("label", "instance")

#: The segmentation types, in display order.
SEGMENTATION_TYPES = ("binary", "multilabel", "instance", "panoptic")

_IDENTITY = [
    [1.0, 0.0, 0.0, 0.0],
    [0.0, 1.0, 0.0, 0.0],
    [0.0, 0.0, 1.0, 0.0],
    [0.0, 0.0, 0.0, 1.0],
]


def has_filaments() -> bool:
    """Whether copick has the run-level Filaments entity."""
    run_cls = getattr(copick_models, "CopickRun", None)
    return run_cls is not None and hasattr(run_cls, "get_filaments") and hasattr(copick_models, "CopickFilaments")


def has_seg_types() -> bool:
    """Whether copick knows instance and panoptic segmentations."""
    seg_cls = getattr(copick_models, "CopickSegmentation", None)
    return seg_cls is not None and hasattr(seg_cls, "segmentation_type")


def has_pick_identity() -> bool:
    """Whether copick has the pick identity helpers (``instance_ids()``, ``full_positions()``)."""
    picks_cls = getattr(copick_models, "CopickPicks", None)
    return picks_cls is not None and hasattr(picks_cls, "full_positions")


HAS_FILAMENTS = has_filaments()
HAS_SEG_TYPES = has_seg_types()
HAS_PICK_IDENTITY = has_pick_identity()


def features() -> dict[str, bool]:
    """The feature flags exposed to the client."""
    return {
        "filaments": has_filaments(),
        "segmentation_types": has_seg_types(),
        "pick_identity": has_pick_identity(),
    }


# --- Segmentations ---------------------------------------------------------------------------------------------------


def seg_type(seg: Any) -> str:
    """``"binary"``, ``"multilabel"``, ``"instance"`` or ``"panoptic"`` for any copick's segmentation."""
    if has_seg_types():
        value = getattr(seg, "segmentation_type", None)
        if isinstance(value, str) and value in SEGMENTATION_TYPES:
            return value
    if getattr(seg, "is_panoptic", False):
        return "panoptic"
    if getattr(seg, "is_instance", False):
        return "instance"
    return "multilabel" if getattr(seg, "is_multilabel", False) else "binary"


def seg_channels(seg: Any) -> Optional[list[str]]:
    """The channel names of a multi-channel segmentation (panoptic), else None."""
    if seg_type(seg) != "panoptic":
        return None
    try:
        from copick.util.segmentation import PANOPTIC_CHANNELS as core_channels  # type: ignore

        return list(core_channels)
    except ImportError:  # pragma: no cover - only reached on a copick without panoptic support
        return list(PANOPTIC_CHANNELS)


# --- Objects ---------------------------------------------------------------------------------------------------------


def filament_spec(obj: Any) -> Optional[dict]:
    """The filament declaration of a pickable object as a plain dict, or None.

    Uses ``PickableObject.filament`` when copick has it; otherwise reads ``metadata["copick"]["filament"]`` directly,
    so an older copick still reports filament objects declared by a newer one.
    """
    spec = getattr(obj, "filament", None) if hasattr(type(obj), "filament") else None
    if spec is not None:
        if hasattr(spec, "model_dump"):
            return spec.model_dump(exclude_none=True)
        if isinstance(spec, dict):
            return dict(spec)
    metadata = getattr(obj, "metadata", None)
    if isinstance(metadata, dict):
        namespace = metadata.get("copick")
        if isinstance(namespace, dict) and isinstance(namespace.get("filament"), dict):
            return {k: v for k, v in namespace["filament"].items() if v is not None}
    return None


# --- Picks -----------------------------------------------------------------------------------------------------------


def point_transformation(point: Any) -> list[list[float]]:
    """A point's 4x4 transformation as nested lists (identity if the point has none)."""
    value = getattr(point, "transformation_", None)
    if value is None:
        return [row[:] for row in _IDENTITY]
    arr = np.asarray(value, dtype=float)
    if arr.shape != (4, 4):
        return [row[:] for row in _IDENTITY]
    return arr.tolist()


def full_position(point: Any) -> tuple[float, float, float]:
    """A point's particle centre in Angstrom: its location plus the translation of its transformation."""
    t = np.asarray(point_transformation(point), dtype=float)[:3, 3]
    loc = point.location
    return (float(loc.x + t[0]), float(loc.y + t[1]), float(loc.z + t[2]))


def instance_count(points: list[Any]) -> int:
    """The number of distinct non-zero instance IDs among the points."""
    return len({p.instance_id for p in points if p.instance_id})


# --- Filaments -------------------------------------------------------------------------------------------------------


def filament_curve_kind(filament: Any) -> Optional[str]:
    """The kind of a filament's editable curve (``catmull-rom``, ``linear``, ``bspline``), or None."""
    curve = getattr(filament, "curve", None)
    return getattr(curve, "kind", None) if curve is not None else None

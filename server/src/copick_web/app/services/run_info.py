"""Information about a run and its tomograms for the run info dialog: where the data lives (paths, CryoET Data
Portal links and metadata) and what the run holds.

Only paths and identifiers are reported: storage options and credentials of the configuration never leave the server.
"""

import re
from typing import Any, Optional

PORTAL = "https://cryoetdataportal.czscience.com"
#: Portal tomogram fields reported as they are.
PORTAL_TOMOGRAM_FIELDS = (
    "name",
    "reconstruction_method",
    "processing",
    "ctf_corrected",
    "fiducial_alignment_status",
    "tomogram_version",
    "is_portal_standard",
    "deposition_id",
    "alignment_id",
    "https_omezarr_dir",
    "s3_omezarr_dir",
    "https_mrc_file",
)


def _attr(obj: Any, name: str) -> Any:
    try:
        return getattr(obj, name, None)
    except Exception:  # remote filesystems may fail on property access
        return None


def _dataset_id_from_path(path: Optional[str]) -> Optional[int]:
    """The dataset ID in a portal path (``s3://bucket/<dataset>/<run>/...`` or ``https://files.../<dataset>/...``)."""
    m = re.match(r"^(?:s3://[^/]+|https?://[^/]+)/(\d+)/", path or "")
    return int(m.group(1)) if m else None


def _shape(tomogram: Any, open_level) -> Optional[dict]:
    """Shape (z, y, x), dtype and pyramid levels of a tomogram's OME-Zarr, or None if it can't be read."""
    try:
        array, _scale, _translation, _level, n_levels = open_level(tomogram.zarr(), 0)
        return {"shape": [int(s) for s in array.shape[-3:]], "dtype": str(array.dtype), "levels": int(n_levels)}
    except Exception:
        return None


def _tomogram_path(tomogram: Any, portal: Optional[dict]) -> Optional[str]:
    """Where a tomogram is read from: its portal location, else the overlay copy if there is one, else the static."""
    if portal and portal.get("path"):
        return portal["path"]
    overlay = _attr(tomogram, "overlay_path")
    try:
        if overlay and tomogram.fs_overlay.exists(overlay):
            return overlay
    except Exception:
        pass
    return _attr(tomogram, "static_path") or overlay


def _portal_tomogram(meta: Any) -> Optional[dict]:
    tomo_id = _attr(meta, "portal_tomo_id")
    if tomo_id is None:
        return None
    container = _attr(meta, "portal_metadata")
    portal = _attr(container, "portal_metadata")
    data = portal.model_dump() if hasattr(portal, "model_dump") else {}
    info = {k: data.get(k) for k in PORTAL_TOMOGRAM_FIELDS if data.get(k) is not None}
    info["id"] = int(tomo_id)
    if all(data.get(k) is not None for k in ("size_x", "size_y", "size_z")):
        info["size_xyz"] = [int(data["size_x"]), int(data["size_y"]), int(data["size_z"])]
    if info.get("deposition_id") is not None:
        info["deposition_url"] = f"{PORTAL}/depositions/{info['deposition_id']}"
    authors = _attr(container, "portal_authors")
    if authors:
        info["authors"] = list(authors)
    path = _attr(meta, "portal_tomo_path")
    if path:
        info["path"] = path
    return info


def run_info(service: Any, run: Any, open_level) -> dict:
    """Everything the run info dialog shows; see ``RunInfoResponse``."""
    meta = _attr(run, "meta")
    portal_run_id = _attr(meta, "portal_run_id")
    tomograms_paths = []
    voxel_spacings = []
    for vs in _attr(run, "voxel_spacings") or []:
        tomograms = []
        for t in vs.tomograms:
            portal = _portal_tomogram(_attr(t, "meta"))
            if portal is not None:
                portal["url"] = f"{PORTAL}/runs/{portal_run_id}?table-tab=Tomograms"
                tomograms_paths.append(portal.get("s3_omezarr_dir") or portal.get("path"))
            tomograms.append(
                {
                    "tomo_type": t.tomo_type,
                    "path": _tomogram_path(t, portal),
                    "zarr": _shape(t, open_level),
                    "portal": portal,
                }
            )
        voxel_spacings.append(
            {
                "voxel_size": float(vs.voxel_size),
                "static_path": _attr(vs, "static_path"),
                "overlay_path": _attr(vs, "overlay_path"),
                "portal_id": _attr(_attr(vs, "meta"), "portal_vs_id"),
                "tomograms": tomograms,
            }
        )

    portal = None
    if portal_run_id is not None:
        dataset_id = _attr(meta, "portal_dataset_id") or next(
            (d for d in map(_dataset_id_from_path, tomograms_paths) if d is not None), None
        )
        portal = {
            "run_id": int(portal_run_id),
            "run_name": _attr(meta, "portal_run_name"),
            "run_url": f"{PORTAL}/runs/{portal_run_id}",
            "dataset_id": dataset_id,
            "dataset_url": f"{PORTAL}/datasets/{dataset_id}" if dataset_id is not None else None,
        }

    def count(attr: str) -> Optional[int]:
        try:
            return len(getattr(run, attr))
        except Exception:
            return None

    return {
        "name": run.name,
        "backend": type(service.root).__name__,
        "static_path": _attr(run, "static_path"),
        "overlay_path": _attr(run, "overlay_path"),
        "portal": portal,
        "counts": {
            "picks": count("picks"),
            "segmentations": count("segmentations"),
            "meshes": count("meshes"),
            "filaments": count("filaments") if hasattr(type(run), "filaments") else None,
        },
        "voxel_spacings": voxel_spacings,
    }

"""Build the zarr URLs returned to the client.

Two transports:

- **Through this server's zarr proxy** (``zarr/{project_id}/...``), which reads chunks via fsspec and re-serves them.
  Always used for local-config projects. These URLs are relative to the app root (no leading slash): the client
  resolves them against its base, so they work under any URL prefix.
- **Directly from ``data_url``** for registry projects, which publish their overlay root over HTTPS: the browser
  fetches chunks itself. The URL is the store's path under the overlay root, as copick names it (so every
  segmentation type is covered), appended to ``data_url``. A store outside the overlay root falls back to the proxy.
"""

from typing import Any, Optional

from ..models import ProjectSummaryResponse
from . import compat


def _published_url(meta: ProjectSummaryResponse, root: Any, store_path: Optional[str]) -> Optional[str]:
    """``data_url`` + the store's path relative to the overlay root, for registry projects (None: use the proxy)."""
    if meta.source != "registry" or not meta.data_url or not store_path:
        return None
    base = (getattr(root, "root_overlay", None) or "").rstrip("/")
    if not base or not store_path.startswith(base + "/"):
        return None
    return f"{meta.data_url.rstrip('/')}/{store_path[len(base) + 1 :]}"


def tomogram_zarr_url(meta: ProjectSummaryResponse, root: Any, run_name: str, voxel_size: float, tomo: Any) -> str:
    """URL of a tomogram's zarr store."""
    store_path = getattr(tomo, "static_path" if getattr(tomo, "read_only", False) else "overlay_path", None)
    published = _published_url(meta, root, store_path)
    if published:
        return published
    return f"zarr/{meta.id}/tomo/{run_name}/{voxel_size}/{tomo.tomo_type}"


def segmentation_zarr_url(meta: ProjectSummaryResponse, root: Any, run_name: str, seg: Any) -> str:
    """URL of a segmentation's zarr store; through the proxy, the type is part of the path because it is part of the
    identity (a binary and an instance segmentation can share name, user, session and voxel size)."""
    published = _published_url(meta, root, getattr(seg, "path", None))
    if published:
        return published
    return (
        f"zarr/{meta.id}/segmentation/{compat.seg_type(seg)}/{run_name}/{seg.name}/{seg.user_id}/"
        f"{seg.session_id}/{seg.voxel_size}"
    )

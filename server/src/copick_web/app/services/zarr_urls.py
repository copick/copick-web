"""Build zarr URLs returned to the client.

Two transports today:

- **Local-config projects** are read through this server's zarr proxy
  (``/zarr/{project_id}/...``). The proxy reads chunks from local
  filesystems via fsspec and re-serves them.
- **Registry projects** publish their data over HTTPS at ``data_url``,
  so the browser fetches chunks directly. The server's only job is to
  hand the client a fully-formed URL.

The registry case follows the documented copick filesystem layout
(https://copick.github.io/copick/datamodel/)
"""

from ..models import ProjectSummaryResponse


def _tomogram_relpath(run_name: str, voxel_size: float, tomo_type: str) -> str:
    return f"ExperimentRuns/{run_name}/VoxelSpacing{voxel_size:.3f}/{tomo_type}.zarr"


def _segmentation_relpath(
    run_name: str,
    voxel_size: float,
    user_id: str,
    session_id: str,
    name: str,
    is_multilabel: bool,
) -> str:
    suffix = "-multilabel" if is_multilabel else ""
    filename = f"{voxel_size:.3f}_{user_id}_{session_id}_{name}{suffix}.zarr"
    return f"ExperimentRuns/{run_name}/Segmentations/{filename}"


def build_tomogram_zarr_url(
    meta: ProjectSummaryResponse,
    root_path: str,
    run_name: str,
    voxel_size: float,
    tomo_type: str,
) -> str:
    """Tomogram zarr URL: server proxy for local, ``data_url``-direct for registry."""
    if meta.source == "registry" and meta.data_url:
        rel = _tomogram_relpath(run_name, voxel_size, tomo_type)
        return f"{meta.data_url.rstrip('/')}/{rel}"
    return f"{root_path}/zarr/{meta.id}/tomo/{run_name}/{voxel_size}/{tomo_type}"


def build_segmentation_zarr_url(
    meta: ProjectSummaryResponse,
    root_path: str,
    run_name: str,
    seg_name: str,
    user_id: str,
    session_id: str,
    voxel_size: float,
    is_multilabel: bool,
) -> str:
    """Segmentation zarr URL: server proxy for local, ``data_url``-direct for registry."""
    if meta.source == "registry" and meta.data_url:
        rel = _segmentation_relpath(run_name, voxel_size, user_id, session_id, seg_name, is_multilabel)
        return f"{meta.data_url.rstrip('/')}/{rel}"
    return f"{root_path}/zarr/{meta.id}/seg/{run_name}/{seg_name}/{user_id}/{session_id}/{voxel_size}"

"""Zarr proxy routes for serving zarr data from fsspec stores."""

import asyncio
import logging

import anyio
from fastapi import APIRouter, Depends, HTTPException, Response

from ..config import settings
from ..dependencies import get_copick_service, get_registry
from ..services.copick_service import CopickService
from ..services.project_registry import ProjectRegistry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/zarr/{project_id}", tags=["zarr"])


def _get_content_type(path: str) -> str:
    """Determine content type based on file path."""
    if path.endswith((".zarray", ".zattrs", ".zgroup", "zarr.json")):
        return "application/json"
    return "application/octet-stream"


def _read_from_store(store, path: str) -> bytes:
    """Read data from a zarr store. Runs in a worker thread."""
    logger.debug(f"Reading path '{path}' from store {type(store)}")
    try:
        data = store[path]
        logger.debug(f"Got data of type {type(data)}, length {len(data) if hasattr(data, '__len__') else 'N/A'}")
        if isinstance(data, (bytes, bytearray)):
            return bytes(data)
        if hasattr(data, "tobytes"):
            return data.tobytes()
        return bytes(data)
    except KeyError as e:
        logger.warning(f"Path '{path}' not found in store: {e}")
        raise HTTPException(status_code=404, detail=f"Path '{path}' not found in store") from e
    except Exception as e:
        logger.error(f"Error reading '{path}' from store: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error reading from store: {e}") from e


async def _read_with_timeout(
    store,
    path: str,
    project_id: str,
    registry: ProjectRegistry,
    *,
    where: str,
) -> bytes:
    """Run ``_read_from_store`` in a worker thread, bounded by a timeout.

    On timeout the worker thread is *abandoned* (its threadpool slot is
    released even though the thread keeps running) and the cached
    ``CopickService`` is evicted so the next request rebuilds with a fresh
    SSH connection. Without abandon-on-cancel a stuck SFTP read would hold
    its thread forever and starve the pool.
    """
    timeout = settings.zarr_read_timeout_seconds
    semaphore = registry.get_read_semaphore(project_id)
    async with semaphore:
        try:
            return await asyncio.wait_for(
                anyio.to_thread.run_sync(_read_from_store, store, path, abandon_on_cancel=True),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Zarr read timed out after %.1fs (%s); evicting service for project %s.",
                timeout,
                where,
                project_id,
            )
            registry.evict_service(project_id)
            raise HTTPException(
                status_code=504,
                detail=f"Zarr read timed out after {timeout:.1f}s; project cache evicted, please retry",
            ) from None


@router.get("/tomo/{run_name}/{voxel_size}/{tomo_type}/{path:path}")
async def proxy_tomogram_zarr(
    project_id: str,
    run_name: str,
    voxel_size: float,
    tomo_type: str,
    path: str,
    service: CopickService = Depends(get_copick_service),
    registry: ProjectRegistry = Depends(get_registry),
) -> Response:
    """Proxy zarr chunks for tomograms."""
    logger.info(f"Zarr proxy request: run={run_name}, vs={voxel_size}, type={tomo_type}, path={path}")

    store = service.get_tomogram_zarr_store(run_name, voxel_size, tomo_type)
    if store is None:
        logger.warning(f"Tomogram not found: {run_name}/{voxel_size}/{tomo_type}")
        raise HTTPException(
            status_code=404,
            detail=f"Tomogram '{tomo_type}' not found for run '{run_name}' at voxel size {voxel_size}",
        )

    where = f"tomo project={project_id} run={run_name} type={tomo_type} path={path}"
    data = await _read_with_timeout(store, path, project_id, registry, where=where)
    content_type = _get_content_type(path)

    logger.debug(f"Returning {len(data)} bytes with content-type {content_type}")

    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=3600",
        },
    )


@router.get("/seg/{run_name}/{seg_name}/{user_id}/{session_id}/{voxel_size}/{path:path}")
async def proxy_segmentation_zarr(
    project_id: str,
    run_name: str,
    seg_name: str,
    user_id: str,
    session_id: str,
    voxel_size: float,
    path: str,
    service: CopickService = Depends(get_copick_service),
    registry: ProjectRegistry = Depends(get_registry),
) -> Response:
    """Proxy zarr chunks for segmentations."""
    store = service.get_segmentation_zarr_store(run_name, seg_name, user_id, session_id, voxel_size)
    if store is None:
        raise HTTPException(
            status_code=404,
            detail=f"Segmentation '{seg_name}' not found for run '{run_name}'",
        )

    where = f"seg project={project_id} run={run_name} name={seg_name} path={path}"
    data = await _read_with_timeout(store, path, project_id, registry, where=where)
    content_type = _get_content_type(path)

    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=3600",
        },
    )

"""Zarr proxy routes for serving zarr data from fsspec stores."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Response

from ..services.copick_service import CopickService, get_copick_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/zarr", tags=["zarr"])


def _get_content_type(path: str) -> str:
    """Determine content type based on file path."""
    if path.endswith((".zarray", ".zattrs", ".zgroup", "zarr.json")):
        return "application/json"
    return "application/octet-stream"


def _read_from_store(store, path: str) -> bytes:
    """Read data from a zarr store."""
    logger.debug(f"Reading path '{path}' from store {type(store)}")
    try:
        data = store[path]
        logger.debug(f"Got data of type {type(data)}, length {len(data) if hasattr(data, '__len__') else 'N/A'}")
        if isinstance(data, (bytes, bytearray)):
            return bytes(data)
        # Handle memoryview or other buffer types
        if hasattr(data, 'tobytes'):
            return data.tobytes()
        return bytes(data)
    except KeyError as e:
        logger.warning(f"Path '{path}' not found in store: {e}")
        raise HTTPException(status_code=404, detail=f"Path '{path}' not found in store")
    except Exception as e:
        logger.error(f"Error reading '{path}' from store: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error reading from store: {e}")


@router.get("/tomo/{run_name}/{voxel_size}/{tomo_type}/{path:path}")
def proxy_tomogram_zarr(
    run_name: str,
    voxel_size: float,
    tomo_type: str,
    path: str,
    service: CopickService = Depends(get_copick_service),
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

    logger.debug(f"Got store: {store}")
    data = _read_from_store(store, path)
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
def proxy_segmentation_zarr(
    run_name: str,
    seg_name: str,
    user_id: str,
    session_id: str,
    voxel_size: float,
    path: str,
    service: CopickService = Depends(get_copick_service),
) -> Response:
    """Proxy zarr chunks for segmentations."""
    store = service.get_segmentation_zarr_store(run_name, seg_name, user_id, session_id, voxel_size)
    if store is None:
        raise HTTPException(
            status_code=404,
            detail=f"Segmentation '{seg_name}' not found for run '{run_name}'",
        )

    data = _read_from_store(store, path)
    content_type = _get_content_type(path)

    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=3600",
        },
    )

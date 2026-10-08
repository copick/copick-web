"""HTTP proxy for objects exposed by copick-owned Zarr stores."""

import logging
import re
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from zarr.abc.store import OffsetByteRequest, RangeByteRequest, SuffixByteRequest
from zarr.core.buffer import default_buffer_prototype

from ..services.copick_service import CopickService, get_copick_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/zarr", tags=["zarr"])

_RANGE_PATTERN = re.compile(r"^(\d*)-(\d*)$")
_CACHE_CONTROL = "public, max-age=3600"


@dataclass(frozen=True)
class _SelectedRange:
    """A validated HTTP byte range and its equivalent Zarr request."""

    start: int
    end: int
    byte_request: RangeByteRequest | OffsetByteRequest | SuffixByteRequest

    @property
    def length(self) -> int:
        return self.end - self.start + 1


class _RangeNotSatisfiable(ValueError):
    """Raised when a Range header cannot select bytes from an object."""


def _get_content_type(path: str) -> str:
    """Determine content type based on the Zarr object path."""
    if path.endswith((".zarray", ".zattrs", ".zgroup", "zarr.json")):
        return "application/json"
    return "application/octet-stream"


def _response_headers(content_length: int) -> dict[str, str]:
    """Return headers shared by full, partial, and HEAD responses."""
    return {
        "Accept-Ranges": "bytes",
        "Cache-Control": _CACHE_CONTROL,
        "Content-Length": str(content_length),
        "Vary": "Range",
    }


def _missing_path(path: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"Path '{path}' not found in store")


async def _get_store_size(store: Any, path: str) -> int:
    """Return object size without fetching its body when the store supports it."""
    try:
        return await store.getsize(path)
    except FileNotFoundError as error:
        logger.info("Path '%s' not found while obtaining its size", path)
        raise _missing_path(path) from error


def _to_bytes(data: Any) -> bytes:
    """Convert a Zarr buffer (or compatible buffer object) to response bytes."""
    if isinstance(data, bytes):
        return data
    if isinstance(data, (bytearray, memoryview)):
        return bytes(data)
    if hasattr(data, "to_bytes"):
        return data.to_bytes()
    if hasattr(data, "tobytes"):
        return data.tobytes()
    return bytes(data)


async def _read_from_store(
    store: Any,
    path: str,
    byte_range: RangeByteRequest | OffsetByteRequest | SuffixByteRequest | None = None,
) -> bytes:
    """Read an object, preserving the Zarr store's native range operation."""
    logger.debug("Reading path '%s' from %s with range %r", path, type(store), byte_range)
    try:
        data = await store.get(
            path,
            prototype=default_buffer_prototype(),
            byte_range=byte_range,
        )
    except FileNotFoundError as error:
        raise _missing_path(path) from error

    if data is None:
        raise _missing_path(path)
    return _to_bytes(data)


def _parse_range(value: str, size: int) -> _SelectedRange:
    """Parse one RFC 9110 byte range and construct the equivalent Zarr request."""
    unit, separator, range_value = value.partition("=")
    if separator != "=" or unit.strip().lower() != "bytes" or "," in range_value:
        raise _RangeNotSatisfiable

    match = _RANGE_PATTERN.fullmatch(range_value.strip())
    if match is None:
        raise _RangeNotSatisfiable

    start_value, end_value = match.groups()
    if not start_value and not end_value:
        raise _RangeNotSatisfiable
    if size == 0:
        raise _RangeNotSatisfiable

    if not start_value:
        suffix = int(end_value)
        if suffix == 0:
            raise _RangeNotSatisfiable
        start = max(size - suffix, 0)
        return _SelectedRange(start, size - 1, SuffixByteRequest(suffix))

    start = int(start_value)
    if start >= size:
        raise _RangeNotSatisfiable

    if not end_value:
        return _SelectedRange(start, size - 1, OffsetByteRequest(start))

    requested_end = int(end_value)
    if requested_end < start:
        raise _RangeNotSatisfiable
    end = min(requested_end, size - 1)
    return _SelectedRange(start, end, RangeByteRequest(start, end + 1))


async def _serve_zarr_object(request: Request, store: Any, path: str) -> Response:
    """Serve a Zarr object with full, HEAD, and single-range behavior."""
    content_type = _get_content_type(path)

    if request.method == "HEAD":
        size = await _get_store_size(store, path)
        return Response(content=b"", media_type=content_type, headers=_response_headers(size))

    range_header = request.headers.get("range")
    if range_header is None:
        data = await _read_from_store(store, path)
        return Response(content=data, media_type=content_type, headers=_response_headers(len(data)))

    size = await _get_store_size(store, path)
    try:
        selected = _parse_range(range_header, size)
    except _RangeNotSatisfiable:
        headers = _response_headers(0)
        headers["Content-Range"] = f"bytes */{size}"
        return Response(status_code=416, content=b"", headers=headers)

    data = await _read_from_store(store, path, selected.byte_request)
    if len(data) != selected.length:
        raise RuntimeError(
            f"Store returned {len(data)} bytes for range {selected.start}-{selected.end}; "
            f"expected {selected.length}"
        )

    headers = _response_headers(len(data))
    headers["Content-Range"] = f"bytes {selected.start}-{selected.end}/{size}"
    return Response(content=data, status_code=206, media_type=content_type, headers=headers)


@router.api_route("/tomo/{run_name}/{voxel_size}/{tomo_type}/{path:path}", methods=["GET", "HEAD"])
async def proxy_tomogram_zarr(
    request: Request,
    run_name: str,
    voxel_size: float,
    tomo_type: str,
    path: str,
    service: Annotated[CopickService, Depends(get_copick_service)],
) -> Response:
    """Proxy Zarr objects for a tomogram."""
    store = service.get_tomogram_zarr_store(run_name, voxel_size, tomo_type)
    if store is None:
        raise HTTPException(
            status_code=404,
            detail=f"Tomogram '{tomo_type}' not found for run '{run_name}' at voxel size {voxel_size}",
        )
    return await _serve_zarr_object(request, store, path)


@router.api_route("/seg/{run_name}/{seg_name}/{user_id}/{session_id}/{voxel_size}/{path:path}", methods=["GET", "HEAD"])
async def proxy_segmentation_zarr(
    request: Request,
    run_name: str,
    seg_name: str,
    user_id: str,
    session_id: str,
    voxel_size: float,
    path: str,
    service: Annotated[CopickService, Depends(get_copick_service)],
) -> Response:
    """Proxy Zarr objects for a segmentation."""
    store = service.get_segmentation_zarr_store(run_name, seg_name, user_id, session_id, voxel_size)
    if store is None:
        raise HTTPException(
            status_code=404,
            detail=f"Segmentation '{seg_name}' not found for run '{run_name}'",
        )
    return await _serve_zarr_object(request, store, path)

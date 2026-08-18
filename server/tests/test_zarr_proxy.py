"""Behavioral tests for the public Zarr HTTP proxy contract."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from copick.util.ome import write_ome_zarr_3d
from fastapi import FastAPI
from fastapi.testclient import TestClient
from zarr.abc.store import OffsetByteRequest, RangeByteRequest, SuffixByteRequest
from zarr.storage import LocalStore

from copick_web.app.main import app as production_app
from copick_web.app.routes.zarr_proxy import router
from copick_web.app.services.copick_service import get_copick_service


@dataclass
class RecordingStore:
    objects: dict[str, bytes]
    reads: list[tuple[str, Any]] = field(default_factory=list)
    size_reads: list[str] = field(default_factory=list)

    async def getsize(self, key: str) -> int:
        self.size_reads.append(key)
        try:
            return len(self.objects[key])
        except KeyError as error:
            raise FileNotFoundError(key) from error

    async def get(self, key: str, prototype: Any, byte_range: Any = None):
        self.reads.append((key, byte_range))
        value = self.objects.get(key)
        if value is None:
            return None
        if isinstance(byte_range, RangeByteRequest):
            value = value[byte_range.start : byte_range.end]
        elif isinstance(byte_range, OffsetByteRequest):
            value = value[byte_range.offset :]
        elif isinstance(byte_range, SuffixByteRequest):
            value = value[-byte_range.suffix :]
        return prototype.buffer.from_bytes(value)


@dataclass
class FakeService:
    store: Any

    def get_tomogram_zarr_store(self, *args: Any) -> Any:
        return self.store

    def get_segmentation_zarr_store(self, *args: Any) -> Any:
        return self.store


@pytest.fixture
def app_and_store() -> tuple[FastAPI, RecordingStore]:
    store = RecordingStore(
        {
            "zarr.json": b'{"zarr_format":3}',
            ".zarray": b'{"zarr_format":2}',
            "0/0/0": b"0123456789",
            "empty": b"",
        }
    )
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_copick_service] = lambda: FakeService(store)
    return app, store


def _client(app: FastAPI) -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


@pytest.mark.parametrize("path", ["zarr.json", ".zarray", "0/0/0"])
def test_full_get_preserves_object_bytes(app_and_store: tuple[FastAPI, RecordingStore], path: str) -> None:
    app, store = app_and_store

    response = _client(app).get(f"/zarr/tomo/run/10.0/denoised/{path}")

    assert response.status_code == 200
    assert response.content == store.objects[path]
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["content-length"] == str(len(store.objects[path]))
    assert response.headers["vary"] == "Range"
    assert store.reads == [(path, None)]
    assert store.size_reads == []


def test_head_reports_size_without_fetching_the_body(app_and_store: tuple[FastAPI, RecordingStore]) -> None:
    app, store = app_and_store

    response = _client(app).head("/zarr/tomo/run/10.0/denoised/0/0/0")

    assert response.status_code == 200
    assert response.content == b""
    assert response.headers["content-length"] == "10"
    assert response.headers["accept-ranges"] == "bytes"
    assert store.size_reads == ["0/0/0"]
    assert store.reads == []


@pytest.mark.parametrize(
    ("range_header", "body", "content_range", "expected_request"),
    [
        ("bytes=0-0", b"0", "bytes 0-0/10", RangeByteRequest(0, 1)),
        ("bytes=9-9", b"9", "bytes 9-9/10", RangeByteRequest(9, 10)),
        ("bytes=2-5", b"2345", "bytes 2-5/10", RangeByteRequest(2, 6)),
        ("bytes=2-", b"23456789", "bytes 2-9/10", OffsetByteRequest(2)),
        ("bytes=-3", b"789", "bytes 7-9/10", SuffixByteRequest(3)),
        ("bytes=0-99", b"0123456789", "bytes 0-9/10", RangeByteRequest(0, 10)),
        ("bytes=-99", b"0123456789", "bytes 0-9/10", SuffixByteRequest(99)),
    ],
)
def test_single_ranges_are_served_with_bounded_store_reads(
    app_and_store: tuple[FastAPI, RecordingStore],
    range_header: str,
    body: bytes,
    content_range: str,
    expected_request: Any,
) -> None:
    app, store = app_and_store

    response = _client(app).get(
        "/zarr/tomo/run/10.0/denoised/0/0/0",
        headers={"Range": range_header},
    )

    assert response.status_code == 206
    assert response.content == body
    assert response.headers["content-range"] == content_range
    assert response.headers["content-length"] == str(len(body))
    assert store.size_reads == ["0/0/0"]
    assert store.reads == [("0/0/0", expected_request)]
    assert store.reads[0][1] is not None


@pytest.mark.parametrize(
    "range_header",
    [
        "items=0-1",
        "bytes=",
        "bytes=-0",
        "bytes=4-2",
        "bytes=10-",
        "bytes=0-1,3-4",
        "bytes=abc-def",
    ],
)
def test_invalid_and_unsatisfiable_ranges_do_not_read_the_object(
    app_and_store: tuple[FastAPI, RecordingStore], range_header: str
) -> None:
    app, store = app_and_store

    response = _client(app).get(
        "/zarr/tomo/run/10.0/denoised/0/0/0",
        headers={"Range": range_header},
    )

    assert response.status_code == 416
    assert response.content == b""
    assert response.headers["content-range"] == "bytes */10"
    assert response.headers["content-length"] == "0"
    assert store.size_reads == ["0/0/0"]
    assert store.reads == []


def test_zero_length_object_supports_get_and_head_but_not_range(
    app_and_store: tuple[FastAPI, RecordingStore],
) -> None:
    app, store = app_and_store
    client = _client(app)

    full = client.get("/zarr/tomo/run/10.0/denoised/empty")
    head = client.head("/zarr/tomo/run/10.0/denoised/empty")
    partial = client.get("/zarr/tomo/run/10.0/denoised/empty", headers={"Range": "bytes=0-"})

    assert (full.status_code, full.content, full.headers["content-length"]) == (200, b"", "0")
    assert (head.status_code, head.content, head.headers["content-length"]) == (200, b"", "0")
    assert partial.status_code == 416
    assert partial.headers["content-range"] == "bytes */0"
    assert store.reads == [("empty", None)]


@pytest.mark.parametrize("method", ["get", "head"])
@pytest.mark.parametrize(
    "url",
    [
        "/zarr/tomo/run/10.0/denoised/missing",
        "/zarr/seg/run/membrane/user/session/10.0/missing",
    ],
)
def test_missing_objects_are_404(app_and_store: tuple[FastAPI, RecordingStore], method: str, url: str) -> None:
    app, _ = app_and_store

    response = getattr(_client(app), method)(url)

    assert response.status_code == 404


@pytest.mark.parametrize(
    "url",
    [
        "/zarr/tomo/run/10.0/denoised/0/0/0",
        "/zarr/seg/run/membrane/user/session/10.0/0/0/0",
    ],
)
def test_tomogram_and_segmentation_routes_have_range_parity(
    app_and_store: tuple[FastAPI, RecordingStore], url: str
) -> None:
    app, _ = app_and_store

    response = _client(app).get(url, headers={"Range": "bytes=3-6"})

    assert response.status_code == 206
    assert response.content == b"3456"
    assert response.headers["content-range"] == "bytes 3-6/10"


def test_missing_resources_are_404() -> None:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_copick_service] = lambda: FakeService(None)
    client = _client(app)

    assert client.get("/zarr/tomo/run/10.0/denoised/zarr.json").status_code == 404
    assert client.get("/zarr/seg/run/membrane/user/session/10.0/zarr.json").status_code == 404


def test_backend_failures_are_not_reclassified_as_missing() -> None:
    class FailingStore(RecordingStore):
        async def get(self, key: str, prototype: Any, byte_range: Any = None):
            raise PermissionError("backend credentials were rejected")

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_copick_service] = lambda: FakeService(FailingStore({"zarr.json": b"{}"}))

    response = _client(app).get("/zarr/tomo/run/10.0/denoised/zarr.json")

    assert response.status_code == 500


def test_canonical_copick_shard_is_served_from_a_real_zarr_store(tmp_path: Path) -> None:
    """Exercise the public proxy against output written by copick 2.0."""
    zarr_path = tmp_path / "canonical.zarr"
    values = np.arange(4 * 5 * 6, dtype=np.uint16).reshape(4, 5, 6)
    write_ome_zarr_3d(str(zarr_path), {10.0: values}, chunk_size=(2, 3, 4))
    store = LocalStore(zarr_path, read_only=True)

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_copick_service] = lambda: FakeService(store)
    client = _client(app)

    root_metadata = client.get("/zarr/tomo/run/10.0/denoised/zarr.json")
    array_metadata = client.get("/zarr/tomo/run/10.0/denoised/0/zarr.json")
    shard_head = client.head("/zarr/tomo/run/10.0/denoised/0/0/0/0")
    shard_tail = client.get(
        "/zarr/tomo/run/10.0/denoised/0/0/0/0",
        headers={"Range": "bytes=-64"},
    )

    assert root_metadata.status_code == 200
    assert root_metadata.json()["attributes"]["ome"]["version"] == "0.5"
    assert array_metadata.status_code == 200
    assert array_metadata.json()["codecs"][0]["name"] == "sharding_indexed"
    assert shard_head.status_code == 200
    assert int(shard_head.headers["content-length"]) > 64
    assert shard_tail.status_code == 206
    assert len(shard_tail.content) == 64
    assert shard_tail.content == (zarr_path / "0/0/0/0").read_bytes()[-64:]


def test_browser_cors_exposes_range_response_headers() -> None:
    store = RecordingStore({"0/0/0": b"0123456789"})
    production_app.dependency_overrides[get_copick_service] = lambda: FakeService(store)
    try:
        response = _client(production_app).get(
            "/zarr/tomo/run/10.0/denoised/0/0/0",
            headers={
                "Origin": "http://localhost:5173",
                "Range": "bytes=2-5",
            },
        )
    finally:
        production_app.dependency_overrides.pop(get_copick_service, None)

    assert response.status_code == 206
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    exposed = {header.strip().lower() for header in response.headers["access-control-expose-headers"].split(",")}
    assert {"accept-ranges", "content-length", "content-range"} <= exposed

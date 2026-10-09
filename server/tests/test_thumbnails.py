"""Run gallery thumbnails."""

from __future__ import annotations

import struct
import zlib
from types import SimpleNamespace

import numpy as np

from copick_web.app.services.thumbnails import best_tomogram, encode_png

from .fixtures.make_demo_project import RUN


def _png_size_and_pixels(data: bytes):
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos, idat, size = 8, b"", None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kind = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            size = struct.unpack(">II", body[:8])
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    w, h = size
    raw = zlib.decompress(idat)
    rows = [raw[y * (w + 1) + 1 : (y + 1) * (w + 1)] for y in range(h)]
    return (w, h), np.frombuffer(b"".join(rows), dtype=np.uint8).reshape(h, w)


def test_png_encoder_round_trip():
    gray = (np.arange(12 * 7) % 256).astype(np.uint8).reshape(7, 12)
    (w, h), pixels = _png_size_and_pixels(encode_png(gray))
    assert (w, h) == (12, 7) and np.array_equal(pixels, gray)


def test_best_tomogram_follows_the_desktop_rule():
    def tomo(kind, size):
        return SimpleNamespace(tomo_type=kind, voxel_spacing=SimpleNamespace(voxel_size=size))

    fine = [tomo("wbp", 10.0), tomo("denoised", 10.0)]
    coarse = [tomo("raw", 20.0), tomo("wbp-raw", 20.0)]
    run = SimpleNamespace(
        voxel_spacings=[SimpleNamespace(tomograms=fine), SimpleNamespace(tomograms=coarse)],
    )
    assert best_tomogram(run) is coarse[1]  # coarsest spacing; wbp beats an unpreferred type
    assert best_tomogram(run, 10.0, "denoised") is fine[1]  # an explicit request wins
    assert best_tomogram(run, 10.0, "missing") is coarse[1]
    assert best_tomogram(SimpleNamespace(voxel_spacings=[])) is None


def test_thumbnail_endpoint(client):
    response = client.get(f"/api/projects/demo/runs/{RUN}/thumbnail", params={"size": 64})
    assert response.status_code == 200 and response.headers["content-type"] == "image/png"
    assert response.headers["x-copick-tomo-type"] and response.headers["x-copick-voxel-size"]
    (w, h), pixels = _png_size_and_pixels(response.content)
    assert max(w, h) <= 64 and pixels.max() > pixels.min()  # contrast-stretched, not blank
    again = client.get(f"/api/projects/demo/runs/{RUN}/thumbnail", params={"size": 64})
    assert again.content == response.content  # cached
    assert client.get("/api/projects/demo/runs/nope/thumbnail").status_code == 404

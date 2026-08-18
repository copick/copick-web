"""Generate the small behavioral OME-Zarr fixtures used by the client tests."""

import shutil
from pathlib import Path

import numpy as np
import zarr

from copick.util.ome import write_ome_zarr_3d

ROOT = Path(__file__).parent
SHAPE = (4, 5, 6)
CHUNKS = (2, 3, 4)


def _reset(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)


def _axes() -> list[dict[str, str]]:
    return [
        {"name": "z", "type": "space", "unit": "angstrom"},
        {"name": "y", "type": "space", "unit": "angstrom"},
        {"name": "x", "type": "space", "unit": "angstrom"},
    ]


def _datasets(level_path: str) -> list[dict[str, object]]:
    return [
        {
            "path": level_path,
            "coordinateTransformations": [
                {"type": "scale", "scale": [10.0, 10.0, 10.0]}
            ],
        }
    ]


def _write_v2(name: str, level_path: str) -> None:
    path = ROOT / name
    _reset(path)
    values = np.arange(np.prod(SHAPE), dtype=np.uint16).reshape(SHAPE)
    group = zarr.open_group(path, mode="w", zarr_format=2)
    group.create_array(level_path, data=values, chunks=CHUNKS, compressors=None)
    group.attrs["multiscales"] = [
        {
            "version": "0.4",
            "axes": _axes(),
            "datasets": _datasets(level_path),
        }
    ]


def _write_unsharded_v3() -> None:
    path = ROOT / "v3-unsharded.zarr"
    _reset(path)
    values = np.arange(np.prod(SHAPE), dtype=np.uint16).reshape(SHAPE)
    group = zarr.open_group(path, mode="w", zarr_format=3)
    group.create_array("0", data=values, chunks=CHUNKS)
    group.attrs["ome"] = {
        "version": "0.5",
        "multiscales": [{"axes": _axes(), "datasets": _datasets("0")}],
    }


def _write_v3(name: str, values: np.ndarray) -> None:
    path = ROOT / name
    _reset(path)
    write_ome_zarr_3d(str(path), {10.0: values}, chunk_size=CHUNKS)


def _normalize_metadata_newlines() -> None:
    metadata_names = {".zarray", ".zattrs", ".zgroup", "zarr.json"}
    for path in ROOT.rglob("*"):
        if path.name in metadata_names:
            path.write_text(path.read_text(encoding="utf-8").rstrip() + "\n", encoding="utf-8")


if __name__ == "__main__":
    indices = np.indices(SHAPE, sparse=True)
    _reset(ROOT / "v2-legacy.zarr")
    _write_v2("v2-numeric.zarr", "0")
    _write_v2("v2-nonnumeric.zarr", "scale0")
    _write_unsharded_v3()
    _write_v3(
        "v3-integer.zarr", np.arange(np.prod(SHAPE), dtype=np.uint16).reshape(SHAPE)
    )
    _write_v3(
        "v3-floating.zarr",
        (0.5 * indices[0] - 0.25 * indices[1] + 0.125 * indices[2]).astype(np.float32),
    )
    _normalize_metadata_newlines()

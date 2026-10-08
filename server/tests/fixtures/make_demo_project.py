"""Build a tiny copick project for the server tests.

The project has one run (``TS_001``) at 10 Å with:

- a 32³ tomogram (``wbp``);
- ``ribosome`` picks by ``alice``/``1`` whose points carry instance IDs and transforms with shifts;
- a ``microtubule`` filament object (``metadata["copick"]["filament"]``);
- ``microtubule`` filaments by ``alice``/``1`` (only on a copick with filaments);
- a binary and an instance ``ribosome`` segmentation by ``alice``/``1`` (the same key, two types);
- a panoptic ``cell`` segmentation by ``alice``/``1`` (only on a copick with typed segmentations).

Steps that need a newer copick are skipped when the API is missing. Run as a script to build a project to look at:
``python make_demo_project.py /tmp/demo``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

RUN = "TS_001"
VOXEL_SIZE = 10.0
SHAPE = (32, 32, 32)

OBJECTS = [
    {"name": "ribosome", "is_particle": True, "label": 1, "color": [255, 0, 0, 255], "radius": 60.0},
    {"name": "membrane", "is_particle": False, "label": 2, "color": [0, 0, 255, 255], "radius": 10.0},
    {
        "name": "microtubule",
        "is_particle": True,
        "label": 3,
        "color": [0, 255, 0, 255],
        "radius": 125.0,
        "metadata": {"copick": {"filament": {"polar": True, "helical_rise_a": 9.4}}},
    },
]

#: Points of the ribosome picks: (location, shift, instance_id, score).
PICKS = [
    ((50.0, 60.0, 70.0), (5.0, -3.0, 2.0), 1, 0.9),
    ((150.0, 160.0, 170.0), (0.0, 0.0, 0.0), 2, 0.5),
    ((250.0, 100.0, 120.0), (-1.5, 2.5, 0.5), 3, 1.0),
]

FILAMENTS = [
    np.array([[20.0, 20.0, 20.0], [100.0, 100.0, 100.0], [200.0, 150.0, 120.0]]),
    np.array([[300.0, 20.0, 160.0], [300.0, 300.0, 160.0]]),
]


def instance_volume() -> np.ndarray:
    """Three cubic instances with IDs 1-3."""
    vol = np.zeros(SHAPE, dtype=np.uint16)
    vol[2:6, 2:6, 2:6] = 1
    vol[10:14, 10:14, 10:14] = 2
    vol[20:24, 20:28, 4:8] = 3
    return vol


def write_config(root: Path) -> Path:
    config = {
        "name": "demo",
        "description": "copick-web test project",
        "version": "1.0.0",
        "config_type": "filesystem",
        "overlay_root": f"local://{root / 'overlay'}",
        "overlay_fs_args": {"auto_mkdir": True},
        "pickable_objects": OBJECTS,
        "user_id": "tester",
    }
    path = root / "copick_config.json"
    path.write_text(json.dumps(config, indent=2))
    return path


def build(root: Path) -> Path:
    """Build the project under ``root`` and return the config path."""
    import copick
    from copick.models import CopickLocation, CopickPoint

    root.mkdir(parents=True, exist_ok=True)
    config_path = write_config(root)
    project = copick.from_file(str(config_path))

    run = project.new_run(RUN)
    vs = run.new_voxel_spacing(VOXEL_SIZE)
    rng = np.random.default_rng(0)
    tomo = vs.new_tomogram("wbp")
    tomo.from_numpy(rng.normal(size=SHAPE).astype(np.float32), levels=2)

    picks = run.new_picks(object_name="ribosome", session_id="1", user_id="alice")
    points = []
    for (x, y, z), (sx, sy, sz), instance_id, score in PICKS:
        transform = np.eye(4)
        transform[:3, 3] = (sx, sy, sz)
        points.append(
            CopickPoint(
                location=CopickLocation(x=x, y=y, z=z),
                transformation_=transform.tolist(),
                instance_id=instance_id,
                score=score,
            )
        )
    picks.points = points
    picks.store()

    if hasattr(run, "new_filaments"):
        filaments = run.new_filaments(object_name="microtubule", session_id="1", user_id="alice")
        filaments.from_numpy(FILAMENTS, instance_ids=[1, 2], radii=[125.0, None], voxel_spacing=VOXEL_SIZE)

    binary = run.new_segmentation(VOXEL_SIZE, "ribosome", "1", is_multilabel=False, user_id="alice")
    binary.from_numpy((instance_volume() > 0).astype(np.uint8), levels=1)

    try:
        instance = run.new_segmentation(VOXEL_SIZE, "ribosome", "1", user_id="alice", is_instance=True)
    except TypeError:
        return config_path  # copick without typed segmentations
    instance.from_numpy(instance_volume(), levels=2)

    labels = np.zeros(SHAPE, dtype=np.uint16)
    labels[:, :, 28:] = 2  # membrane (stuff)
    inst = instance_volume()
    labels[inst > 0] = 1  # ribosomes (things)
    panoptic = run.new_segmentation(VOXEL_SIZE, "cell", "1", user_id="alice", is_panoptic=True)
    panoptic.from_numpy(np.stack([labels, inst]), levels=2)
    return config_path


if __name__ == "__main__":
    print(build(Path(sys.argv[1] if len(sys.argv) > 1 else "demo-project")))

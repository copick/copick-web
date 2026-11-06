"""Local CellCanvas preview and roundtrip check with a real core service in its own environment.

Builds the 32³ demo copick project with a two-region tomogram, saves fixture features (intensity and a smoothed
intensity; *synthetic, not a model*) with a manifest, registers them in a CellCanvas core service
(``cellcanvas_service``, Zarr 3) started from ``--core-python``, and serves copick-web with a binding file.

    python scripts/cellcanvas_preview.py WORKDIR --core-python /path/to/cellcanvas/.venv/bin/python [--check] [--serve]

``--check`` paints, trains, predicts and publishes over HTTP and verifies the published copick segmentation
(read through a freshly opened copick root, as napari-copick reads it) against the core's prediction store.
``--serve`` keeps both servers running for a browser. Pass ``--features`` and ``--manifest`` to use saved
public-model features instead of the synthetic fixture, and ``--copick-config``/``--run``/``--voxel-size``/
``--tomo-type`` to bind an existing reconstruction instead of the demo project.
"""

import argparse
import json
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path

import httpx
import numpy as np
import zarr

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from tests.fixtures.make_demo_project import RUN, SHAPE, VOXEL_SIZE, build  # noqa: E402

CLASSES = [
    {"id": 1, "name": "background", "color": [80, 160, 255]},
    {"id": 2, "name": "dense", "color": [255, 160, 40]},
]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait(url, process, seconds=60):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"{url} exited with {process.returncode}")
        try:
            if httpx.get(url, timeout=1).status_code == 200:
                return
        except httpx.HTTPError:
            time.sleep(0.2)
    raise RuntimeError(f"{url} did not start")


def make_project(work: Path):
    import copick

    config = build(work / "project")
    root = copick.from_file(str(config))
    tomo = root.get_run(RUN).get_voxel_spacing(VOXEL_SIZE).get_tomograms("wbp")[0]
    rng = np.random.default_rng(0)
    volume = rng.normal(scale=0.3, size=SHAPE).astype(np.float32)
    volume[:, :, SHAPE[2] // 2 :] += 2.0  # dense right half (x >= 16)
    tomo.from_numpy(volume, levels=1)
    return config, Path(tomo.zarr().path if hasattr(tomo.zarr(), "path") else tomo.zarr().root), volume


def synthetic_features(work: Path, volume, tomogram_path):
    from scipy.ndimage import gaussian_filter

    features = np.stack([volume, gaussian_filter(volume, 1.5)]).astype(np.float32)
    path = work / "features.zarr"
    zarr.save_array(str(path), features)
    manifest = {
        "model": "synthetic-fixture: raw and Gaussian-smoothed intensity",
        "license": "CC0-1.0",
        "public": True,
        "source": str(tomogram_path),
        "grid": {"shape": list(SHAPE), "resampling": None},
        "note": "Plumbing fixture only; not public-model features.",
    }
    (work / "features.manifest.json").write_text(json.dumps(manifest, indent=2))
    return path, work / "features.manifest.json", manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("work", type=Path)
    parser.add_argument("--core-python", required=True)
    parser.add_argument("--features")
    parser.add_argument("--manifest")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--copick-config", help="Use this existing project instead of the demo (needs --features)")
    parser.add_argument("--run", default=RUN)
    parser.add_argument("--voxel-size", type=float, default=VOXEL_SIZE)
    parser.add_argument("--tomo-type", default="wbp")
    args = parser.parse_args()
    work = args.work.resolve()
    work.mkdir(parents=True, exist_ok=False)
    if args.copick_config:
        import copick

        if not args.features:
            parser.error("--copick-config needs --features and --manifest")
        config = Path(args.copick_config).resolve()
        voxel_spacing = copick.from_file(str(config)).get_run(args.run).get_voxel_spacing(args.voxel_size)
        store = voxel_spacing.get_tomograms(args.tomo_type)[0].zarr()
        tomogram_path, volume = Path(getattr(store, "root", None) or store.path), None
    else:
        config, tomogram_path, volume = make_project(work)
        args.run, args.voxel_size, args.tomo_type = RUN, VOXEL_SIZE, "wbp"
    if args.features:
        features, manifest_path = Path(args.features), Path(args.manifest)
        manifest = json.loads(manifest_path.read_text())
    else:
        features, manifest_path, manifest = synthetic_features(work, volume, tomogram_path)
    subprocess.run(
        [
            args.core_python,
            "-m",
            "cellcanvas_service.prepare",
            str(tomogram_path),
            str(features),
            str(manifest_path),
            str(work / "core"),
            "--name",
            "ts1",
        ],
        check=True,
    )
    core_port, web_port = free_port(), args.port or free_port()
    core = subprocess.Popen(
        [args.core_python, "-m", "cellcanvas_service", str(work / "core" / "service.json"), "--port", str(core_port)]
    )
    bindings = work / "bindings.json"
    bindings.write_text(
        json.dumps(
            {
                "bindings": [
                    {
                        "id": "ts1",
                        "config": str(config),
                        "run": args.run,
                        "voxel_size": args.voxel_size,
                        "tomo_type": args.tomo_type,
                        "service_url": f"http://127.0.0.1:{core_port}",
                        "dataset": "ts1",
                        "classes": CLASSES,
                        "painting": {"name": "cellcanvas-painting", "user_id": "cellcanvas", "session_id": "1"},
                        "prediction": {"name": "cellcanvas-prediction", "user_id": "cellcanvas", "session_id": "1"},
                        "features": {k: manifest[k] for k in ("model", "license", "public")},
                    }
                ]
            },
            indent=2,
        )
    )
    env = {
        "COPICK_CONFIG_PATHS": json.dumps([str(config)]),
        "CELLCANVAS_BINDINGS": str(bindings),
        "PATH": "/usr/bin:/bin",
    }
    web = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "copick_web.app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(web_port),
            "--log-level",
            "warning",
        ],
        env=env,
        cwd=work,
    )
    try:
        wait(f"http://127.0.0.1:{core_port}/health", core)
        wait(f"http://127.0.0.1:{web_port}/health", web)
        base = f"http://127.0.0.1:{web_port}"
        pid = httpx.get(f"{base}/api/projects").json()[0]["id"]
        print(
            json.dumps(
                {"preview": f"{base}/projects/{pid}/", "core": f"http://127.0.0.1:{core_port}", "work": str(work)}
            ),
            flush=True,
        )
        if args.check:
            result = roundtrip(base, pid, config, work, args.core_python, args.run, demo=not args.copick_config)
            (work / "roundtrip.json").write_text(json.dumps(result, indent=2))
            print(json.dumps(result, indent=2))
        if args.serve:
            web.wait()
    finally:
        for process in (web, core):
            process.terminate()
            process.wait(timeout=30)


def core_arrays(core_python, work):
    """The core's Zarr 3 painting and prediction, read in the core environment."""
    code = (
        "import sys, numpy as np, zarr; w = sys.argv[1]; np.savez(w + '/core-arrays.npz', "
        "painting=zarr.open_array(w + '/core/painting.zarr', mode='r')[:], "
        "prediction=zarr.open_array(w + '/core/prediction.zarr', mode='r')[:])"
    )
    subprocess.run([core_python, "-c", code, str(work)], check=True)
    arrays = np.load(work / "core-arrays.npz")
    return arrays["painting"], arrays["prediction"]


def roundtrip(base, pid, config, work, core_python, run_name=RUN, demo=True):
    """Paint, train, predict and publish over HTTP. On a real volume the strokes only test placement and
    storage (left and right of centre on the middle slice); they are not annotations."""
    import copick

    api = f"{base}/api/projects/{pid}/cellcanvas/bindings/ts1"
    with httpx.Client(timeout=600) as client:
        status = client.get(api).json()
        assert status["check"]["ok"], status["check"]["problems"]
        z, y, x = status["check"]["copick"]["shape"]
        strokes = [
            {
                "label": 1,
                "radius": 3,
                "plane": "XY",
                "points": [[x * 5 // 32, y // 2, z // 2], [x // 4, y * 5 // 16, z // 2]],
            },
            {
                "label": 2,
                "radius": 3,
                "plane": "XY",
                "points": [[x * 13 // 16, y // 2, z // 2], [x * 3 // 4, y * 11 // 16, z // 2]],
            },
        ]
        base = status["painting"]["revision"]  # an existing painting is extended, not replaced
        saved = client.post(f"{api}/painting", json={"base_revision": base, "strokes": strokes})
        assert saved.status_code == 200, saved.text
        saved = saved.json()
        trained = client.post(f"{api}/train", json={"operation_id": str(uuid.uuid4())}).json()
        trained = poll(client, api, trained)
        assert trained["last"]["state"] == "succeeded", trained
        predicted = poll(client, api, client.post(f"{api}/predict", json={"operation_id": str(uuid.uuid4())}).json())
        assert predicted["last"]["state"] == "succeeded", predicted
        publication = predicted["last"]["publication"]
    # Read back through a fresh copick root, as napari-copick does.
    run = copick.from_file(str(config)).get_run(run_name)
    painting = run.get_segmentations(name="cellcanvas-painting", user_id="cellcanvas", session_id="1")[0].numpy()
    published = run.get_segmentations(name="cellcanvas-prediction", user_id="cellcanvas", session_id="1")[0]
    published_array = published.numpy()
    core_painting, core_prediction = core_arrays(core_python, work)
    right = np.zeros(painting.shape, bool)
    right[:, :, painting.shape[2] // 2 :] = True
    return {
        "evidence": "synthetic fixture" if demo else "real reconstruction; placement-only strokes, no accuracy claim",
        "painting_revision": saved["revision"],
        "painted_voxels": {str(k): int((painting == k).sum()) for k in (1, 2)},
        "unannotated_voxels": int((painting == 0).sum()),
        "core_painting_equal": bool(np.array_equal(core_painting, painting)),
        "trained_on_revision": trained["last"]["painting_revision"],
        "publication": publication,
        "published_equals_core_prediction": bool(np.array_equal(published_array, core_prediction)),
        "published_classes": sorted(int(v) for v in np.unique(published_array)),
        "fixture_region_agreement": float(((published_array == 2) == right).mean()) if demo else None,
    }


def poll(client, api, state, seconds=120):
    deadline = time.monotonic() + seconds
    while state.get("pending") and time.monotonic() < deadline:
        time.sleep(0.25)
        state = client.get(f"{api}/operation").json()
    return state


if __name__ == "__main__":
    main()

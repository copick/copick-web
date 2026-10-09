"""Registry projects: their configuration file on the cluster, store URLs from ``data_url``, reload and cache sweeps."""

from __future__ import annotations

import json
import os

import copick
import fsspec
import pytest

from copick_web.app.models import ProjectSummaryResponse
from copick_web.app.services import project_registry as pr
from copick_web.app.services import zarr_urls
from copick_web.app.services.config_file import RemoteConfigFile
from copick_web.app.services.copick_service import CopickService
from copick_web.app.services.registry_client import ProjectEntry
from copick_web.app.services.thumbnails import Thumbnail

from .fixtures.make_demo_project import RUN, VOXEL_SIZE

WEB = "https://onsite.example.org/group.czii/krios1.processing/copick/25aug19a/run001/"
HPC = "/hpc/projects/group.czii/krios1.processing/copick/25aug19a/run001"
DATA_URL = "https://data.example.org/run001/"


def _entry(**fields) -> ProjectEntry:
    values = {
        "session_name": "25aug19a",
        "run_name": "run001",
        "cluster_id": "bruno",
        "root_url": WEB,
        "config_url": WEB + "config.json",
        "data_url": WEB,
    }
    values.update(fields)
    return ProjectEntry(**values)


@pytest.fixture(autouse=True)
def no_service_account(monkeypatch):
    """Ignore a service account configured in the environment (.env): tests never connect to a cluster."""
    monkeypatch.setattr(pr.settings, "slurm_user", None)
    monkeypatch.setattr(pr.settings, "slurm_keyfile", None)


@pytest.fixture
def service_account(monkeypatch):
    monkeypatch.setattr(pr.settings, "slurm_user", "svc")
    monkeypatch.setattr(pr.settings, "slurm_keyfile", "/run/secrets/slurm_key")


# --- Where the configuration file is ---


def test_config_file_is_under_the_overlay_root(service_account):
    body = json.dumps({"config_type": "filesystem", "overlay_root": f"local://{HPC}"})
    config_file = pr.registry_config_file(_entry(), body)
    assert config_file.path == f"{HPC}/config.json"
    assert str(config_file) == f"svc@192.168.98.229:{HPC}/config.json"


@pytest.mark.parametrize(
    "entry, overlay_root",
    [
        (_entry(config_url="https://elsewhere.example.org/config.json"), f"local://{HPC}"),
        (_entry(root_url=None), f"local://{HPC}"),
        (_entry(), "s3://bucket/run001"),
    ],
    ids=["config not under root_url", "no root_url", "overlay not local://"],
)
def test_config_file_read_only_when_the_layout_does_not_match(service_account, entry, overlay_root):
    body = json.dumps({"config_type": "filesystem", "overlay_root": overlay_root})
    assert pr.registry_config_file(entry, body) is None


def test_config_file_read_only_without_a_service_account(monkeypatch):
    monkeypatch.setattr(pr.settings, "slurm_user", None)
    body = json.dumps({"config_type": "filesystem", "overlay_root": f"local://{HPC}"})
    assert pr.registry_config_file(_entry(), body) is None


# --- Editing object types in a remote configuration file ---


def _remote(path) -> RemoteConfigFile:
    return RemoteConfigFile(lambda: fsspec.filesystem("file"), str(path))


def test_object_types_are_saved_to_the_remote_file_as_published(demo_config, tmp_path):
    """The root opened by the server has rewritten roots; the saved file keeps the published ones."""
    published = json.loads(demo_config.read_text())
    published["overlay_root"] = f"local://{HPC}"
    raw = tmp_path / "published" / "config.json"
    raw.parent.mkdir()
    raw.write_text(json.dumps(published))
    inode = os.stat(raw).st_ino

    service = CopickService(lambda: copick.from_file(str(demo_config)), _remote(raw))
    editor = service.object_types
    assert editor.editable
    fields = {"name": "proteasome", "is_particle": True, "label": 9, "color": (10, 20, 30, 255), "radius": 75.0}
    editor.create(editor.version, fields, None)

    saved = json.loads(raw.read_text())
    assert saved["overlay_root"] == f"local://{HPC}"
    assert any(o["name"] == "proteasome" for o in saved["pickable_objects"])
    assert os.stat(raw).st_ino == inode  # overwritten in place: owner, group and mode are kept
    assert service.root.get_object("proteasome") is not None


def test_remote_edits_are_picked_up(demo_config, tmp_path):
    raw = tmp_path / "config.json"
    raw.write_text(demo_config.read_text())
    service = CopickService(lambda: copick.from_file(str(demo_config)), _remote(raw))
    data = json.loads(raw.read_text())
    data["pickable_objects"] = [o for o in data["pickable_objects"] if o["name"] != "membrane"]
    raw.write_text(json.dumps(data))
    os.utime(raw, (0, 0))  # a different mtime, even within the filesystem's timestamp resolution
    assert "membrane" not in {o.name for o in service.object_types.objects}


def test_remote_file_not_editable_when_missing(demo_config, tmp_path):
    service = CopickService(lambda: copick.from_file(str(demo_config)), _remote(tmp_path / "missing.json"))
    assert not service.object_types.editable


# --- Store URLs ---


def _meta(source: str) -> ProjectSummaryResponse:
    return ProjectSummaryResponse(id="p1", source=source, data_url=DATA_URL if source == "registry" else None)


def test_registry_store_urls_point_at_data_url(service):
    run = service.get_run(RUN)
    tomo = service.get_tomogram(RUN, VOXEL_SIZE, "wbp")
    url = zarr_urls.tomogram_zarr_url(_meta("registry"), service.root, RUN, VOXEL_SIZE, tomo)
    assert url == f"{DATA_URL}ExperimentRuns/{RUN}/VoxelSpacing10.000/wbp.zarr"
    urls = {zarr_urls.segmentation_zarr_url(_meta("registry"), service.root, RUN, seg) for seg in run.segmentations}
    # every type, where copick stores it (instance segmentations have their own directory)
    assert f"{DATA_URL}ExperimentRuns/{RUN}/Segmentations/10.000_alice_1_ribosome.zarr" in urls
    assert f"{DATA_URL}ExperimentRuns/{RUN}/InstanceSegmentations/10.000_alice_1_ribosome.zarr" in urls


def test_local_store_urls_go_through_the_proxy(service):
    tomo = service.get_tomogram(RUN, VOXEL_SIZE, "wbp")
    assert zarr_urls.tomogram_zarr_url(_meta("local"), service.root, RUN, VOXEL_SIZE, tomo) == (
        f"zarr/p1/tomo/{RUN}/{VOXEL_SIZE}/wbp"
    )
    seg = service.get_run(RUN).segmentations[0]
    assert zarr_urls.segmentation_zarr_url(_meta("local"), service.root, RUN, seg).startswith("zarr/p1/segmentation/")


# --- Reload and cache sweeps across projects ---


class _FakeClient:
    def __init__(self, body: str):
        self.body = body
        self.fetches = 0

    def fetch_config_json(self, url: str) -> str:
        self.fetches += 1
        return self.body


def test_registry_reload_fetches_the_config_again(demo_config):
    # No service account: the demo's local:// overlay is not rewritten to ssh:// (no connection is attempted).
    client = _FakeClient(demo_config.read_text())
    registry = pr.ProjectRegistry(registry_client=client)
    service = registry._registry_service(_entry())
    assert client.fetches == 1  # the first open reuses the body fetched to find the config file
    assert service.config_file is None  # without a service account the object types are read-only
    service.reload()
    assert client.fetches == 2


def test_sweep_covers_every_open_project(demo_config):
    registry = pr.ProjectRegistry()
    services = []
    for pid in ("a", "b"):
        service = CopickService.from_config_path(str(demo_config), cache_max_age=0)
        service.thumbnails.put(("x",), Thumbnail(b"png", "wbp", VOXEL_SIZE))
        registry._cache_put(pid, service)
        services.append(service)
    assert registry.sweep_caches() == 2
    assert all(len(s.thumbnails) == 0 for s in services)

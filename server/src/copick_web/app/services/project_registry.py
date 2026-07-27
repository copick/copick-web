"""In-process project registry: merges local configs with a registry API.

- **Registry**: discovered by polling an external HTTP registry
  (``RegistryClient.list_projects``) which returns ``ProjectEntry`` rows
  containing ``config_url``, ``data_url``, ``cluster_id``, etc.
  Materialization steps, on first ``get_service(pid)`` call:

    1. GET ``entry.config_url`` -> raw copick JSON (via
       ``RegistryClient.fetch_config_json``).
    2. ``_rewrite_overlay_root`` rewrites ``local://`` overlay/static
       roots to ``ssh://`` and injects a service-account SSH config
       (``SLURM_USER`` / ``SLURM_KEYFILE``, host from ``cluster_id``).
       This lets the server write to HPC-local overlays it can't see
       directly. Only registry projects hit this path.
    3. ``CopickService.from_config_string`` builds the copick root.

  Zarr chunk reads for registry projects do **not** go through this
  server. The client gets a URL pointing at ``entry.data_url`` and
  fetches chunks directly. See ``services/zarr_urls.py`` for the URL
  construction.

Materialized services are cached LRU per ``ProjectRegistry`` instance.
The registry list itself is refreshed on a background timer; refresh
failures keep the previous snapshot rather than emptying the cache.
"""

import json
import logging
import threading
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import anyio

from ..config import settings
from ..models import ProjectSummaryResponse
from .copick_service import CopickService
from .registry_client import ProjectEntry, RegistryClient, RegistryError

logger = logging.getLogger(__name__)


@dataclass
class _LocalProject:
    """Metadata for a project loaded from a local config file."""

    id: str
    config_path: str

    def to_summary(self) -> ProjectSummaryResponse:
        return ProjectSummaryResponse(id=self.id, source="local")


def _registry_id(entry: ProjectEntry) -> str:
    return f"{entry.cluster_id}-{entry.session_name}-{entry.run_name}"


_LOCAL_SCHEME = "local://"
_SSH_SCHEME = "ssh://"


def _swap_local_to_ssh(value: Optional[str]) -> Optional[str]:
    if isinstance(value, str) and value.startswith(_LOCAL_SCHEME):
        return _SSH_SCHEME + value[len(_LOCAL_SCHEME) :]
    return None


def _rewrite_overlay_root(config_body: str, entry: ProjectEntry) -> str:
    """Rewrite registry configs so HPC-local roots are reached over SSH.

    Registry-published configs embed `local://` paths that the server
    container can't see. When `SLURM_USER` and `SLURM_KEYFILE` are
    configured, we swap the `local://` scheme on overlay_root (and
    static_root) for `ssh://` and inject service-account SSH params into
    the matching fs_args. The SSH host is taken from ``entry.cluster_id``.
    Only registry projects hit this path; local projects materialize via
    ``from_config_path`` and are never rewritten.
    """
    user = settings.slurm_user
    keyfile = settings.slurm_keyfile
    if not user or not keyfile:
        logger.debug(
            "SLURM_USER/SLURM_KEYFILE unset; leaving registry config for %s untouched",
            _registry_id(entry),
        )
        return config_body

    try:
        cfg = json.loads(config_body)
    except json.JSONDecodeError as e:
        logger.warning("Could not parse registry config JSON for rewrite: %s", e)
        return config_body

    if not isinstance(cfg, dict) or cfg.get("config_type") != "filesystem":
        return config_body

    host = settings.cluster_hosts.get(entry.cluster_id, entry.cluster_id)
    ssh_args = {
        "username": user,
        "host": host,
        "port": settings.slurm_ssh_port,
        "client_keys": [keyfile],
        "known_hosts": None,
        # Bound how long a dead connection looks alive by asyncssh
        "keepalive_interval": 30,
        "keepalive_count_max": 3,
    }
    rewrote_any = False

    for root_key, args_key in (("overlay_root", "overlay_fs_args"), ("static_root", "static_fs_args")):
        original = cfg.get(root_key)
        new_value = _swap_local_to_ssh(original)
        if new_value is None:
            continue
        cfg[root_key] = new_value
        cfg[args_key] = dict(ssh_args)
        logger.info(
            "Rewrote %s for %s: %s -> %s (ssh as %s@%s)",
            root_key,
            _registry_id(entry),
            original,
            new_value,
            user,
            host,
        )
        rewrote_any = True

    return json.dumps(cfg) if rewrote_any else config_body


def _registry_summary(entry: ProjectEntry) -> ProjectSummaryResponse:
    return ProjectSummaryResponse(
        id=_registry_id(entry),
        source="registry",
        session_name=entry.session_name,
        run_name=entry.run_name,
        cluster_id=entry.cluster_id,
        scope=entry.scope,
        status=entry.status,
        created_at=entry.created_at,
        proc_run_id=entry.proc_run_id,
        config_url=entry.config_url,
        data_url=entry.data_url,
        root_url=entry.root_url,
    )


class ProjectRegistry:
    """Single source of truth for project metadata + lazy ``CopickService`` cache."""

    def __init__(
        self,
        registry_client: Optional[RegistryClient] = None,
        service_cache_size: int = 32,
    ):
        self._client = registry_client
        self._cache_size = service_cache_size

        self._local_projects: dict[str, _LocalProject] = {}
        self._registry_entries: dict[str, ProjectEntry] = {}  # id -> entry
        self._registry_cache: list[ProjectSummaryResponse] = []

        # LRU of materialized services.
        self._services: OrderedDict[str, CopickService] = OrderedDict()
        self._services_lock = threading.Lock()

        # Per-project locks to avoid duplicate cold-start fetches.
        self._project_locks: dict[str, threading.Lock] = {}
        self._project_locks_guard = threading.Lock()

        # Per-project semaphores bounding concurrent zarr chunk reads. Outlive
        # service evictions on purpose — in-flight readers must keep holding
        # a stable object.
        self._read_semaphores: dict[str, anyio.Semaphore] = {}
        self._read_semaphores_guard = threading.Lock()

    # --- Local registration ---

    def register_local(self, path: str) -> str:
        """Register a local config file. Returns the assigned project id."""
        resolved = Path(path).resolve()
        if not resolved.exists():
            raise FileNotFoundError(f"Local config not found: {resolved}")
        pid = resolved.stem
        if pid in self._local_projects:
            logger.warning("Local project id %s already registered; replacing.", pid)
        self._local_projects[pid] = _LocalProject(id=pid, config_path=str(resolved))
        return pid

    # --- Registry refresh ---

    async def refresh_registry(self) -> None:
        """Refresh the cached registry list. Keeps prior snapshot on failure."""
        if self._client is None:
            return

        try:
            entries = await self._client.list_projects()
        except RegistryError as e:
            logger.warning("Registry refresh failed; keeping previous snapshot. Error: %s", e)
            return

        new_entries: dict[str, ProjectEntry] = {}
        new_summaries: list[ProjectSummaryResponse] = []
        for entry in entries:
            pid = _registry_id(entry)
            if pid in new_entries:
                logger.warning("Duplicate registry id %s; using last entry.", pid)
            new_entries[pid] = entry
            new_summaries.append(_registry_summary(entry))

        # Atomic-ish swap (Python attribute assignment is atomic enough for this use).
        self._registry_entries = new_entries
        self._registry_cache = new_summaries
        logger.info("Registry refresh complete: %d projects.", len(new_summaries))

    # --- Listing ---

    def list_projects(self) -> list[ProjectSummaryResponse]:
        """Merge cached registry list with locals (locals win on collision)."""
        out: list[ProjectSummaryResponse] = []
        seen_ids: set[str] = set()

        for local in self._local_projects.values():
            out.append(local.to_summary())
            seen_ids.add(local.id)

        for summary in self._registry_cache:
            if summary.id in seen_ids:
                local_path = self._local_projects[summary.id].config_path
                logger.warning(
                    "project id %s: local config %s shadows registry entry %s",
                    summary.id,
                    local_path,
                    summary.config_url,
                )
                continue
            out.append(summary)
            seen_ids.add(summary.id)

        return out

    def get_metadata(self, pid: str) -> ProjectSummaryResponse:
        """Return the merged-view summary for a project id."""
        if pid in self._local_projects:
            return self._local_projects[pid].to_summary()
        if pid in self._registry_entries:
            return _registry_summary(self._registry_entries[pid])
        raise KeyError(pid)

    # --- Service materialization ---

    def _get_project_lock(self, pid: str) -> threading.Lock:
        with self._project_locks_guard:
            lock = self._project_locks.get(pid)
            if lock is None:
                lock = threading.Lock()
                self._project_locks[pid] = lock
            return lock

    def get_read_semaphore(self, pid: str) -> anyio.Semaphore:
        """Lazily create and return the per-project read semaphore."""
        with self._read_semaphores_guard:
            sem = self._read_semaphores.get(pid)
            if sem is None:
                sem = anyio.Semaphore(settings.zarr_concurrency_per_project)
                self._read_semaphores[pid] = sem
            return sem

    def evict_service(self, pid: str) -> bool:
        """Drop the cached ``CopickService`` for ``pid``. Returns True if one was removed.

        The next call to ``get_service(pid)`` will re-materialize from scratch —
        re-reading the local file or re-fetching the registry config and
        re-establishing any SSH connections.
        """
        with self._services_lock:
            removed = self._services.pop(pid, None) is not None
        if removed:
            logger.info("Evicted CopickService for project %s (manual reload).", pid)
        return removed

    def _cache_get(self, pid: str) -> Optional[CopickService]:
        with self._services_lock:
            service = self._services.get(pid)
            if service is not None:
                self._services.move_to_end(pid)
            return service

    def _cache_put(self, pid: str, service: CopickService) -> None:
        with self._services_lock:
            self._services[pid] = service
            self._services.move_to_end(pid)
            while len(self._services) > self._cache_size:
                evicted_pid, _ = self._services.popitem(last=False)
                logger.info("Evicted CopickService for project %s (LRU full).", evicted_pid)

    def get_service(self, pid: str) -> CopickService:
        """Return a cached or freshly-materialized ``CopickService`` for ``pid``."""
        cached = self._cache_get(pid)
        if cached is not None:
            return cached

        # Validate id exists before paying for a lock.
        if pid not in self._local_projects and pid not in self._registry_entries:
            raise KeyError(pid)

        lock = self._get_project_lock(pid)
        with lock:
            cached = self._cache_get(pid)
            if cached is not None:
                return cached

            if pid in self._local_projects:
                local = self._local_projects[pid]
                logger.info("Materializing CopickService for local project %s (%s).", pid, local.config_path)
                service = CopickService.from_config_path(local.config_path)
            else:
                entry = self._registry_entries[pid]
                if not entry.config_url:
                    raise RegistryError(f"Registry entry for {pid} has no config_url")
                assert self._client is not None  # registry entries only exist if client is set
                logger.info("Materializing CopickService for registry project %s (%s).", pid, entry.config_url)
                body = self._client.fetch_config_json(entry.config_url)
                body = _rewrite_overlay_root(body, entry)
                service = CopickService.from_config_string(body)

            self._cache_put(pid, service)
            return service


# Module-level singleton, populated by main.py lifespan.
project_registry: Optional[ProjectRegistry] = None


def set_project_registry(reg: ProjectRegistry) -> None:
    global project_registry
    project_registry = reg


def get_project_registry() -> ProjectRegistry:
    if project_registry is None:
        raise RuntimeError("ProjectRegistry not initialized")
    return project_registry

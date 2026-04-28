"""HTTP client for the external project registry API."""

from dataclasses import dataclass
from typing import Optional

import httpx


class RegistryError(Exception):
    """Raised when the registry API returns an error or invalid response."""


@dataclass
class ProjectEntry:
    """A single project as returned by the registry API."""

    session_name: str
    run_name: str
    cluster_id: str
    scope: Optional[str] = None
    root_url: Optional[str] = None
    config_url: Optional[str] = None
    data_url: Optional[str] = None
    status: Optional[str] = None
    created_at: Optional[str] = None
    proc_run_id: Optional[int] = None

    @classmethod
    def from_json(cls, data: dict) -> "ProjectEntry":
        return cls(
            session_name=data["session_name"],
            run_name=data["run_name"],
            cluster_id=data["cluster_id"],
            scope=data.get("scope"),
            root_url=data.get("root_url"),
            config_url=data.get("config_url"),
            data_url=data.get("data_url"),
            status=data.get("status"),
            created_at=data.get("created_at"),
            proc_run_id=data.get("proc_run_id"),
        )


class RegistryClient:
    """Thin httpx-based client for the registry API.

    `base_url` is the registry root (e.g. ``http://localhost:8000/copick/v1``).
    The client appends ``/projects/`` and ``/projects/{session}/{run_name}/`` itself.
    """

    def __init__(self, base_url: str, timeout: float = 10.0):
        # Normalize: strip trailing slash so we can append cleanly.
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def list_projects(self) -> list[ProjectEntry]:
        """Fetch the current project list from the registry."""
        url = f"{self.base_url}/projects/"
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(url)
                response.raise_for_status()
                payload = response.json()
        except httpx.HTTPError as e:
            raise RegistryError(f"Failed to GET {url}: {e}") from e
        except ValueError as e:
            raise RegistryError(f"Invalid JSON from {url}: {e}") from e

        if not payload.get("success"):
            raise RegistryError(f"Registry response had success=false: {payload!r}")

        projects = payload.get("projects")
        if not isinstance(projects, list):
            raise RegistryError(f"Registry response missing 'projects' list: {payload!r}")

        try:
            return [ProjectEntry.from_json(p) for p in projects]
        except KeyError as e:
            raise RegistryError(f"Project entry missing required field: {e}") from e

    def fetch_config_json(self, url: str) -> str:
        """GET the raw config body as text (for ``copick.from_string``).

        Synchronous so it can be called from sync route handlers via
        ``ProjectRegistry.get_service``.
        """
        try:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.get(url)
                response.raise_for_status()
                return response.text
        except httpx.HTTPError as e:
            raise RegistryError(f"Failed to fetch config at {url}: {e}") from e

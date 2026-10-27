"""FastAPI application: ``create_app`` builds one, and ``app`` is the one built from the settings.

Embedding copick-web in another FastAPI application (same origin, under a prefix of the host's choosing)::

    copick_app = create_app(read_only=True, allow_empty=True)
    host.mount("/copick-web", copick_app)
    pid = copick_app.state.registry.register_local("/abs/path/copick_config.json")

    # Starlette does not run a mounted app's lifespan: run it from the host's own.
    async with copick_app.router.lifespan_context(copick_app):
        ...

The UI is then at ``/copick-web/`` and a project at ``/copick-web/projects/<pid>/``.
"""

import asyncio
import logging
from collections.abc import Iterable
from contextlib import asynccontextmanager
from os import PathLike
from pathlib import Path
from typing import Optional, Union

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .routes import config, filaments, meshes, projects, runs, zarr_proxy
from .services.project_registry import ProjectRegistry, set_project_registry
from .services.registry_client import RegistryClient

logger = logging.getLogger(__name__)

#: The built client (``npm run build:server`` in client/), served by every app created while it is there.
static_dir = Path(__file__).parent.parent / "static"


async def _refresh_loop(registry: ProjectRegistry, interval: int):
    """Background loop that refreshes the registry list at a fixed cadence."""
    while True:
        try:
            await asyncio.sleep(interval)
            await registry.refresh_registry()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.exception("Registry refresh loop error: %s", e)


async def _sweep_caches(registry: ProjectRegistry, every: float) -> None:
    """Drop expired cache entries of every open project regularly, so memory is released even when nothing is
    requested."""
    while True:
        await asyncio.sleep(max(every, 1))
        try:
            dropped = registry.sweep_caches()
            if dropped:
                logger.info(f"Dropped {dropped} expired cache entries")
        except Exception as e:  # never let the sweeper die
            logger.warning(f"Cache sweep failed: {e}")


def _register_configs(registry: ProjectRegistry, configs: Iterable[str]) -> None:
    for path in configs:
        try:
            pid = registry.register_local(path)
            logger.info(
                "Registered local project '%s' (%s) from %s",
                pid,
                registry.get_metadata(pid).name or "unnamed",
                path,
            )
        except FileNotFoundError as e:
            logger.error("Local config not found, skipping: %s (%s)", path, e)


def _normalize_base_path(base_path: str) -> str:
    """``/a/b`` for ``a/b``, ``/a/b/`` or ``/a/b``; empty for no prefix."""
    stripped = base_path.strip("/")
    return f"/{stripped}" if stripped else ""


async def redirect_root_relatively(request: Request, call_next):
    """Add the trailing slash to the app root under a forwarded prefix (``/node/<host>/<port>``) with a relative
    redirect: Starlette's own is absolute and names the Host it was sent, which may be the backend behind the proxy."""
    root = request.scope.get("root_path", "")
    if root and request.url.path == root:
        query = f"?{request.url.query}" if request.url.query else ""
        return RedirectResponse(f"{root.rsplit('/', 1)[-1]}/{query}", status_code=307)
    return await call_next(request)


async def health_check():
    """Liveness check. Async so a saturated threadpool can't make the server look dead."""
    return {"status": "healthy"}


def _serve_client(app: FastAPI) -> None:
    """Serve the built client, if there is one: ``index.html`` for the client routes under ``/projects`` and the files
    at ``/``.

    Order matters: the SPA catch-all must come BEFORE the StaticFiles mount at "/" so it can intercept deep-link
    refreshes (e.g. /projects/abc) and return index.html instead of 404.
    """
    if not static_dir.exists():
        return
    if not any(f.name != ".gitkeep" for f in static_dir.iterdir()):
        logger.warning(
            f"Static directory exists but is empty: {static_dir}. "
            "Run 'npm run build:server' in the client directory to build the client."
        )
        return

    index_file = static_dir / "index.html"

    @app.get("/projects/{full_path:path}", include_in_schema=False)
    def spa_projects(full_path: str):
        """Serve the SPA index.html for client-side routes under /projects."""
        if not index_file.exists():
            raise HTTPException(status_code=404, detail="SPA index.html missing")
        return FileResponse(index_file)

    logger.info(f"Serving static files from: {static_dir}")
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")


def create_app(
    configs: Iterable[Union[str, PathLike]] = (),
    base_path: str = "",
    read_only: bool = False,
    registry_url: Optional[str] = None,
    allow_empty: bool = False,
) -> FastAPI:
    """Build a copick-web application. Every call builds a new, independent app.

    Args:
        configs: Local copick config files, registered when the app starts (in its lifespan).
        base_path: URL prefix of a reverse proxy that forwards it to the server (``/node/<host>/<port>``); requests
            with or without it are served alike. Leave it empty when mounting the app into another application: the
            mount supplies its own prefix.
        read_only: Refuse every change to project data (picks, filaments, object types) with 403; reloading a
            project stays allowed. The client learns it from the project config (``read_only``) and hides its
            editing tools.
        registry_url: Base URL of a project registry API (e.g. ``http://localhost:8000/copick/v1``).
        allow_empty: Start without any project source (no ``configs``, no ``registry_url``), for an application that
            registers projects later. Otherwise starting such an app fails.

    The ``ProjectRegistry`` is created here and kept on ``app.state.registry``: ``register_local`` works before and
    after the app has started, and the routes work even if the lifespan never runs. The lifespan registers
    ``configs``, lists the registry and runs the background cache sweep and registry refresh. Starlette does not run
    a mounted app's lifespan, so an application that mounts this one runs ``app.router.lifespan_context(app)`` from
    its own.

    Other settings (cache sizes, CORS origins, SSH access of registry projects, ...) come from the environment and
    ``.env``, as ``Settings``.
    """
    configs = tuple(str(c) for c in configs)
    client = RegistryClient(registry_url) if registry_url else None
    registry = ProjectRegistry(registry_client=client, service_cache_size=settings.service_cache_size)
    # The routes read the registry from their app's state; the module-level one is only their fallback.
    set_project_registry(registry)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        """Register the local configs, list the registry, and run the background tasks while the app is up."""
        if not configs and client is None and not allow_empty:
            raise RuntimeError(
                "No project source configured. Provide local config paths via the CLI / "
                "COPICK_CONFIG_PATHS, or set REGISTRY_URL."
            )
        _register_configs(registry, configs)

        if client is not None:
            try:
                await registry.refresh_registry()
            except Exception as e:
                logger.warning("Initial registry refresh failed; continuing without registry projects: %s", e)

        tasks = [asyncio.create_task(_sweep_caches(registry, settings.cache_sweep_seconds))]
        if client is not None:
            tasks.append(asyncio.create_task(_refresh_loop(registry, settings.registry_refresh_seconds)))

        logger.info(
            "copick-web ready: %d project(s) listed%s.",
            len(registry.list_projects()),
            ", read-only" if read_only else "",
        )

        try:
            yield
        finally:
            for task in tasks:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            logger.info("Shutting down copick-web server")

    app = FastAPI(
        title="Copick Web Server",
        description="API server for copick web visualization",
        version="0.1.0",
        lifespan=lifespan,
        # A prefix the proxy forwards (e.g. /node/<host>/<port>); requests with or without it are routed alike.
        root_path=_normalize_base_path(base_path),
    )
    app.state.registry = registry
    app.state.read_only = read_only

    app.middleware("http")(redirect_root_relatively)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    for module in (projects, config, runs, filaments, meshes, zarr_proxy):
        app.include_router(module.router)
    app.get("/health")(health_check)

    _serve_client(app)
    return app


# The app ``uvicorn copick_web.app.main:app`` serves, from the settings (environment and ``.env``).
app = create_app(
    configs=settings.copick_config_paths,
    base_path=settings.base_path,
    read_only=settings.read_only,
    registry_url=settings.registry_url,
)


if __name__ == "__main__":
    import uvicorn

    logging.basicConfig(level=logging.DEBUG)
    uvicorn.run(
        "copick_web.app.main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
    )

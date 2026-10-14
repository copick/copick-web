"""FastAPI application entry point."""

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .routes import config, filaments, projects, runs, zarr_proxy
from .services.project_registry import ProjectRegistry, set_project_registry
from .services.registry_client import RegistryClient

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)


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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Build registry
    if not settings.copick_config_paths and not settings.registry_url:
        raise RuntimeError(
            "No project source configured. Provide local config paths via the CLI / "
            "COPICK_CONFIG_PATHS, or set REGISTRY_URL."
        )

    client = RegistryClient(settings.registry_url) if settings.registry_url else None
    registry = ProjectRegistry(registry_client=client, service_cache_size=settings.service_cache_size)

    for path in settings.copick_config_paths:
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

    if client is not None:
        try:
            await registry.refresh_registry()
        except Exception as e:
            logger.warning("Initial registry refresh failed; continuing without registry projects: %s", e)

    set_project_registry(registry)

    tasks = [asyncio.create_task(_sweep_caches(registry, settings.cache_sweep_seconds))]
    if client is not None:
        tasks.append(asyncio.create_task(_refresh_loop(registry, settings.registry_refresh_seconds)))

    logger.info("copick-web ready: %d project(s) listed.", len(registry.list_projects()))

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


app = FastAPI(
    title="Copick Web Server",
    description="API server for copick web visualization",
    version="0.1.0",
    lifespan=lifespan,
    # A prefix the proxy forwards (e.g. /node/<host>/<port>); requests with or without it are routed alike.
    root_path=settings.base_path.rstrip("/"),
)


@app.middleware("http")
async def redirect_root_relatively(request: Request, call_next):
    """Add the trailing slash to the app root under a forwarded prefix (``/node/<host>/<port>``) with a relative
    redirect: Starlette's own is absolute and names the Host it was sent, which may be the backend behind the proxy."""
    root = request.scope.get("root_path", "")
    if root and request.url.path == root:
        query = f"?{request.url.query}" if request.url.query else ""
        return RedirectResponse(f"{root.rsplit('/', 1)[-1]}/{query}", status_code=307)
    return await call_next(request)


# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(config.router)
app.include_router(runs.router)
app.include_router(filaments.router)
app.include_router(zarr_proxy.router)


@app.get("/health")
async def health_check():
    """Liveness check. Async so a saturated threadpool can't make the server look dead."""
    return {"status": "healthy"}


# Serve the built SPA. Order matters: SPA catch-all must come BEFORE the
# StaticFiles mount at "/" so it can intercept deep-link refreshes
# (e.g. /projects/abc) and return index.html instead of 404.
static_dir = Path(__file__).parent.parent / "static"


def _has_static_files() -> bool:
    if not static_dir.exists():
        return False
    return any(f.name != ".gitkeep" for f in static_dir.iterdir())


if _has_static_files():
    index_file = static_dir / "index.html"

    @app.get("/projects/{full_path:path}", include_in_schema=False)
    def spa_projects(full_path: str, request: Request):
        """Serve the SPA index.html for client-side routes under /projects."""
        if not index_file.exists():
            raise HTTPException(status_code=404, detail="SPA index.html missing")
        return FileResponse(index_file)

    logger.info(f"Serving static files from: {static_dir}")
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
elif static_dir.exists():
    logger.warning(
        f"Static directory exists but is empty: {static_dir}. "
        "Run 'npm run build:server' in the client directory to build the client."
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "copick_web.app.main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
    )

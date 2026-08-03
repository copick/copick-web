"""FastAPI application entry point."""

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .routes import config, projects, runs, zarr_proxy
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

    refresh_task: asyncio.Task | None = None
    if client is not None:
        refresh_task = asyncio.create_task(_refresh_loop(registry, settings.registry_refresh_seconds))

    logger.info("copick-web ready: %d project(s) listed.", len(registry.list_projects()))

    try:
        yield
    finally:
        if refresh_task is not None:
            refresh_task.cancel()
            try:
                await refresh_task
            except asyncio.CancelledError:
                pass
        logger.info("Shutting down copick-web server")


app = FastAPI(
    title="Copick Web Server",
    description="API server for copick web visualization",
    version="0.1.0",
    lifespan=lifespan,
    root_path=settings.base_path,
)

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

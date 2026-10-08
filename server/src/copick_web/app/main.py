"""FastAPI application entry point."""

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .routes import config, filaments, runs, zarr_proxy
from .services.copick_service import get_copick_service, init_copick_service

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    logger.info(f"Loading copick config from: {settings.copick_config_path}")
    try:
        init_copick_service(
            settings.copick_config_path,
            thumbnail_cache_bytes=settings.thumbnail_cache_mb * 1024 * 1024,
            measurement_cache_bytes=settings.measurement_cache_mb * 1024 * 1024,
            cache_max_age=settings.cache_max_age_seconds or None,
        )
        logger.info("Copick service initialized successfully")
    except FileNotFoundError:
        logger.error(f"Config file not found: {settings.copick_config_path}")
        raise
    except OSError as e:
        # Connection errors (SSH, S3, etc.)
        logger.error(f"Failed to connect to storage backend: {e}")
        logger.error("If using SSH storage, ensure the SSH tunnel is running")
        logger.error("If using S3, check your credentials and network connection")
        raise RuntimeError(
            f"Storage connection failed. Check that any required services (SSH tunnel, etc.) are running. "
            f"Error: {e}"
        ) from e
    except Exception as e:
        logger.error(f"Failed to initialize copick service: {e}")
        raise

    sweeper = asyncio.create_task(_sweep_caches(settings.cache_sweep_seconds))

    yield

    # Shutdown
    sweeper.cancel()
    logger.info("Shutting down copick-web server")


async def _sweep_caches(every: float) -> None:
    """Drop expired cache entries regularly, so memory is released even when nothing is requested."""
    while True:
        await asyncio.sleep(max(every, 1))
        try:
            dropped = get_copick_service().sweep_caches()
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
    expose_headers=["Accept-Ranges", "Content-Length", "Content-Range"],
)

# Include API routers
app.include_router(config.router)
app.include_router(runs.router)
app.include_router(filaments.router)
app.include_router(zarr_proxy.router)


@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


# Mount static files for built client (must be AFTER API routes so they take precedence)
# The static directory is at src/copick_web/static/ relative to this file
static_dir = Path(__file__).parent.parent / "static"
if static_dir.exists():
    # Check if there are any files (not just .gitkeep)
    has_files = any(f.name != ".gitkeep" for f in static_dir.iterdir())
    if has_files:
        logger.info(f"Serving static files from: {static_dir}")
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
    else:
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

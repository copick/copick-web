"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .routes import config, runs, zarr_proxy
from .services.copick_service import init_copick_service

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    logger.info(f"Loading copick config from: {settings.copick_config_path}")
    try:
        init_copick_service(settings.copick_config_path)
        logger.info("Copick service initialized successfully")
    except FileNotFoundError as e:
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
        )
    except Exception as e:
        logger.error(f"Failed to initialize copick service: {e}")
        raise

    yield

    # Shutdown
    logger.info("Shutting down copick-web server")


app = FastAPI(
    title="Copick Web Server",
    description="API server for copick web visualization",
    version="0.1.0",
    lifespan=lifespan,
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(config.router)
app.include_router(runs.router)
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

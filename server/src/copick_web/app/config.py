"""Server configuration using pydantic-settings."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    copick_config_paths: list[str] = []
    registry_url: str | None = None
    registry_refresh_seconds: int = 60
    service_cache_size: int = 6
    # Hard ceiling on a single zarr-chunk read. If exceeded, the request
    # returns 504 and the underlying CopickService is evicted so the next
    # request rebuilds with a fresh SSH connection.
    zarr_read_timeout_seconds: float = 60.0
    # Max concurrent zarr chunk reads per project. Bounds peak memory
    # (≈ value × max_chunk_size) and avoids saturating a single asyncssh
    # SFTP channel — past ~16 in flight, parallel reads stop helping.
    zarr_concurrency_per_project: int = 8
    slurm_user: str | None = None
    slurm_keyfile: str | None = None
    slurm_ssh_port: int = 22
    # cluster_id -> SSH hostname/IP. Defaults mirror the umbrella seed
    # (umbrella/stores/migrations/0010_seed_clusters.py). Override via env:
    #   CLUSTER_HOSTS='{"bruno":"…","czii":"…"}'
    cluster_hosts: dict[str, str] = {
        "bruno": "192.168.98.229",
        "czii": "10.50.120.90",
    }
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]
    host: str = "0.0.0.0"
    port: int = 8000
    base_path: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()

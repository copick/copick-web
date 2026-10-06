"""Server configuration using pydantic-settings."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    copick_config_path: str = "copick_config.json"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]
    host: str = "0.0.0.0"
    port: int = 8000
    base_path: str = ""
    # In-memory caches of derived data (env: THUMBNAIL_CACHE_MB, MEASUREMENT_CACHE_MB, CACHE_MAX_AGE_SECONDS,
    # CACHE_SWEEP_SECONDS). Entries older than the max age are dropped by a sweep every CACHE_SWEEP_SECONDS.
    thumbnail_cache_mb: int = 64
    measurement_cache_mb: int = 512
    cache_max_age_seconds: int = 3600
    cache_sweep_seconds: int = 300

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()

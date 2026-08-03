"""CLI entry point for copick-web."""

import json
import threading
import webbrowser
from pathlib import Path

import click
import uvicorn


@click.command()
@click.argument("configs", nargs=-1, type=click.Path(exists=True))
@click.option(
    "--config-dir",
    type=click.Path(exists=True, file_okay=False),
    default=None,
    help="Directory of copick config JSON files to register as local projects.",
)
@click.option(
    "--registry-url",
    type=str,
    default=None,
    help="Base URL of the project registry API (e.g. http://localhost:8000/copick/v1).",
)
@click.option("--host", default="127.0.0.1", help="Host to bind to")
@click.option("--port", default=8000, type=int, help="Port to bind to")
@click.option("--no-browser", is_flag=True, help="Don't open browser automatically")
def main(
    configs: tuple[str, ...],
    config_dir: str | None,
    registry_url: str | None,
    host: str,
    port: int,
    no_browser: bool,
):
    """Start Copick Web server.

    CONFIGS are zero-or-more paths to copick configuration JSON files. Combine with
    --config-dir to load every JSON file in a directory, and/or --registry-url to
    pull projects from a registry API.

    Examples:

        copick-web /path/to/copick_config.json
        copick-web a.json b.json --port 9000
        copick-web --config-dir ./configs --registry-url http://localhost:8000/copick/v1
        copick-web --registry-url http://localhost:8000/copick/v1
    """
    # Collect local config paths.
    local_paths: list[str] = [str(Path(c).resolve()) for c in configs]
    if config_dir:
        for path in sorted(Path(config_dir).glob("*.json")):
            local_paths.append(str(path.resolve()))

    if not local_paths and not registry_url:
        raise click.UsageError(
            "No project source configured. Provide at least one CONFIG, --config-dir, or --registry-url."
        )

    # pydantic-settings reads list-typed env vars as JSON, so encode the list.
    import os

    os.environ["COPICK_CONFIG_PATHS"] = json.dumps(local_paths)
    if registry_url:
        os.environ["REGISTRY_URL"] = registry_url

    url = f"http://{host}:{port}"
    click.echo(f"Starting Copick Web at {url}")
    if local_paths:
        click.echo(f"Local configs: {', '.join(local_paths)}")
    if registry_url:
        click.echo(f"Registry URL: {registry_url}")

    if not no_browser:

        def open_browser():
            webbrowser.open(url)

        threading.Timer(1.5, open_browser).start()

    # Import app here so the env vars set above are picked up by Settings().
    from copick_web.app.main import app

    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()

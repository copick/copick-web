"""CLI entry point for copick-web."""

import json
import logging
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
@click.option(
    "--base-path",
    envvar="BASE_PATH",
    default="",
    help="URL prefix of a reverse proxy that forwards the full path, e.g. Open OnDemand's /node/<host>/<port>. "
    "Not needed when the proxy strips the prefix (/rnode/<host>/<port>): the client works under any prefix.",
)
@click.option(
    "--read-only",
    is_flag=True,
    envvar="READ_ONLY",
    help="Refuse every change to project data (picks, filaments, object types); the UI hides its editing tools.",
)
def main(
    configs: tuple[str, ...],
    config_dir: str | None,
    registry_url: str | None,
    host: str,
    port: int,
    no_browser: bool,
    base_path: str,
    read_only: bool,
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
        copick-web config.json --port 9000 --base-path /node/$(hostname)/9000
        copick-web config.json --read-only
    """
    logging.basicConfig(level=logging.DEBUG)

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
    base_path = "/" + base_path.strip("/") if base_path.strip("/") else ""
    os.environ["BASE_PATH"] = base_path

    url = f"http://{host}:{port}{base_path}/"
    click.echo(f"Starting Copick Web at {url}")
    if local_paths:
        click.echo(f"Local configs: {', '.join(local_paths)}")
    if registry_url:
        click.echo(f"Registry URL: {registry_url}")
    if read_only:
        click.echo("Read-only: projects can be viewed but not changed")

    if not no_browser:

        def open_browser():
            webbrowser.open(url)

        threading.Timer(1.5, open_browser).start()

    # Imported here so the env vars set above are picked up by Settings() (cache sizes, CORS, ...).
    from copick_web.app.main import create_app

    app = create_app(configs=local_paths, base_path=base_path, read_only=read_only, registry_url=registry_url)
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()

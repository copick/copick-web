"""CLI entry point for copick-web."""

import os
import threading
import webbrowser
from pathlib import Path

import click
import uvicorn


@click.command()
@click.argument("config", type=click.Path(exists=True))
@click.option("--host", default="127.0.0.1", help="Host to bind to")
@click.option("--port", default=8000, type=int, help="Port to bind to")
@click.option("--no-browser", is_flag=True, help="Don't open browser automatically")
def main(config: str, host: str, port: int, no_browser: bool):
    """Start Copick Web server with the given CONFIG file.

    CONFIG is the path to a copick configuration JSON file.

    Example:
        copick-web /path/to/copick_config.json
        copick-web config.json --port 9000
        copick-web config.json --no-browser
    """
    # Set config path as environment variable before importing app
    os.environ["COPICK_CONFIG_PATH"] = str(Path(config).resolve())

    url = f"http://{host}:{port}"
    click.echo(f"Starting Copick Web at {url}")
    click.echo(f"Using config: {config}")

    if not no_browser:
        # Open browser after short delay to allow server to start
        def open_browser():
            webbrowser.open(url)

        threading.Timer(1.5, open_browser).start()

    # Import app here to pick up the environment variable
    from copick_web.app.main import app

    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()

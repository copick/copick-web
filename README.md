# copick-web

Web-based visualization tool for cryoET data using the copick data model.

<img width="3008" height="1532" alt="image" src="https://github.com/user-attachments/assets/386284d5-7548-4a30-ace4-83d893a7add2" />

## Overview

copick-web consists of two components:

- **Server**: Python FastAPI server that provides a REST API for copick metadata and proxies zarr data
- **Client**: React/TypeScript application using idetik-react for OME-Zarr visualization

## Features

- Browse copick runs, voxel spacings, and tomograms
- View tomogram slices with channel controls and scale bar
- Display particle picks as point overlays
- View segmentation overlays with multilabel support

## Prerequisites

- Python 3.9+
- Node.js 20.19.0+
- A copick configuration file pointing to your data

## Quick Start

### Installation

```bash
# Install the server package
cd server
pip install -e .

# Build the client
cd ../client
npm install
npm run build:server
```

### Running

```bash
# Start copick-web with your config file
copick-web /path/to/your/copick_config.json
```

This will start the server and open your browser to http://localhost:8000

### CLI Options

```bash
copick-web CONFIG [OPTIONS]

Options:
  --host TEXT     Host to bind to (default: 127.0.0.1)
  --port INTEGER  Port to bind to (default: 8000)
  --no-browser    Don't open browser automatically
  --help          Show this message and exit.

Examples:
  copick-web config.json                    # Start with defaults
  copick-web config.json --port 9000        # Custom port
  copick-web config.json --no-browser       # Don't auto-open browser
```

## Development

We offer dev containers for ease of use or manual dev setups.

### Docker/Podman Compose
Pre-requisites: Podman (recommended) or Docker installed with Compose extension. Check if installed with `docker-compose version` or `podman compose version`
- create .env file using .env.example as template. 
- obtain or use a copick project. Modify config.json's `overlay_root` parameter to `local:/data/copick_data/`
```
# Example .env
# Host ports exposed by the containers
SERVER_HOST_PORT=8880
CLIENT_HOST_PORT=5180

# Please modify below with path to copick project, pointing to the copick config json.
# NOTE: In the config.json, please change "overlay_root": "local:/data/copick_data/"
# The config gets mounted read-only into the container at /data/copick_config.json.
COPICK_CONFIG_PATH=.scratch/NPC1_DEMO/configNPC1.json

# Path to your copick data directory on the host machine.
# This gets mounted into the container at /data/copick_data.
# Make sure paths inside your copick config reference /data/copick_data.
COPICK_DATA_DIR=.scratch/NPC1_DEMO/NPC1_DEMO/project
```

Starting the servers
```bash
# start frontend and backend
podman compose -f compose-dev.yml up
# when done developing, shutdown with ctrl+c or
podman compose -f compose-dev.yml down
```
Runs both server and client with hot reload, refreshing on code updates. Access on http://localhost:8880 or specified SERVER_HOST_PORT

Access backend API (FastAPI) with http://localhost:8880/docs

To build & check production images
```bash
# uses compose.yml
podman compose up --build -d
# when done developing, shutdown
podman compose down
```

### Manual
If you do not wish to run on Docker, these are the manual steps. Please see prerequisites section.

#### Server Development

```bash
cd server
pip install -e ".[dev]"

# Run with uvicorn for hot-reload
export COPICK_CONFIG_PATH=/path/to/config.json
uvicorn copick_web.app.main:app --reload --port 8000
```

#### Client Development

```bash
cd client
npm install
npm run dev  # Starts Vite dev server at localhost:5173
```

When developing the client, run the server separately and the Vite dev server will proxy API requests.

### Code Quality

```bash
# Server
cd server
black src/
ruff check src/

# Client
cd client
npm run lint
npm run format
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COPICK_CONFIG_PATH` | `copick_config.json` | Path to copick configuration file |
| `CORS_ORIGINS` | `["http://localhost:5173", "http://localhost:8000"]` | Allowed CORS origins |
| `HOST` | `0.0.0.0` | Server host |
| `PORT` | `8000` | Server port |

Create a `.env` file in the `server/` directory to set these values.

## API Endpoints

### Metadata

- `GET /api/config` - Project configuration
- `GET /api/objects` - Pickable objects
- `GET /api/runs` - List of runs
- `GET /api/runs/{run}` - Run details with voxel spacings
- `GET /api/runs/{run}/picks` - List of picks for a run
- `GET /api/runs/{run}/picks/{obj}/{user}/{session}` - Pick points
- `GET /api/runs/{run}/segmentations` - List of segmentations

### Zarr Proxy

- `GET /zarr/tomo/{run}/{vs}/{type}/{path}` - Tomogram zarr chunks
- `GET /zarr/seg/{run}/{name}/{user}/{session}/{vs}/{path}` - Segmentation zarr chunks

## Architecture

```
copick-web/
├── server/                     # FastAPI server package
│   ├── pyproject.toml          # Package config with CLI entry point
│   └── src/copick_web/
│       ├── cli.py              # CLI entry point
│       ├── static/             # Built client files
│       └── app/
│           ├── main.py         # FastAPI application
│           ├── config.py       # Settings
│           ├── models.py       # Pydantic response models
│           ├── routes/         # API route handlers
│           └── services/       # Business logic (CopickService)
└── client/                     # React application
    └── src/
        ├── api/                # API client and hooks
        ├── components/         # React components
        │   ├── layout/         # App layout
        │   ├── navigation/     # Run tree
        │   ├── entities/       # Picks/segmentations tables
        │   ├── viewer/         # Tomogram viewer
        │   └── overlays/       # Picks/segmentation overlays
        └── contexts/           # React context providers
```

## License

MIT

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
- Linked XY / XZ / YZ orthoslices with crosshairs and a 3D volume view (or a single plane), panes toggleable
- Display particle picks as point overlays (dots or physical radius shells), coloured per instance ID for filament objects
- Filaments (ordered centrelines) drawn as dense points, coloured per filament ID
- Segmentation overlays: binary, multilabel, instance (shared instance palette, click to identify, instance browser) and panoptic (objects / instances / both)
- Newer copick features (filaments, instance and panoptic segmentations) are detected at runtime; older copick versions keep working
- Multi-tenant: host many copick projects from one server, sourced from local
  config files and/or an external project registry API. Lazy `CopickService`
  loading with a per-project LRU cache.

## Prerequisites

- Python 3.9+
- Node.js 24+
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
# Start copick-web with one or more local config files
copick-web /path/to/your/copick_config.json

# Or with several configs / a directory of configs
copick-web a.json b.json --config-dir /path/to/configs

# Or pulling projects from a registry API
copick-web --registry-url http://localhost:8000/copick/v1

# Mix and match (locals win on id collision)
copick-web a.json --registry-url http://localhost:8000/copick/v1
```

This will start the server and open your browser to http://localhost:8000.
With one project the UI auto-redirects to it; with multiple, you land on a
project list page.

### CLI Options

```bash
copick-web [CONFIGS...] [OPTIONS]

Arguments:
  CONFIGS                 Zero or more local copick config JSON files.

Options:
  --config-dir PATH       Directory of copick config JSONs to register.
  --registry-url URL      Base URL of the project registry API
                          (e.g. http://localhost:8000/copick/v1).
                          The server appends /projects/ itself.
  --host TEXT             Host to bind to (default: 127.0.0.1)
  --port INTEGER          Port to bind to (default: 8000)
  --no-browser            Don't open browser automatically
  --base-path TEXT        URL prefix of a proxy that forwards the full path (env: BASE_PATH)
  --help                  Show this message and exit.

At least one of CONFIGS, --config-dir, or --registry-url is required.
```

### Behind a proxy (e.g. Open OnDemand)

The client finds its URL prefix at runtime from the page it was loaded from (without the `projects/<id>/` route),
so the same install works under any prefix — for example a different `/rnode/<host>/<port>/` for every node and port
an HPC job lands on, or the sub-path a reverse proxy in front of the compose stack serves it under.

- **The proxy strips the prefix** (Open OnDemand's `/rnode/<host>/<port>/`): nothing to set.

  ```bash
  copick-web config.json --host 0.0.0.0 --port "$port" --no-browser
  # open https://ondemand.example.org/rnode/$(hostname)/$port/
  ```

- **The proxy forwards the full path** (Open OnDemand's `/node/<host>/<port>/`): pass the prefix with
  `--base-path` (or `BASE_PATH`). Requests with or without it are served alike.

  ```bash
  copick-web config.json --host 0.0.0.0 --port "$port" --no-browser --base-path "/node/$(hostname)/$port"
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
DEV_SERVER_HOST_PORT=8880
DEV_CLIENT_HOST_PORT=5180

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
Runs both server and client with hot reload, refreshing on code updates. Access the app on http://localhost:5180 (or specified `DEV_CLIENT_HOST_PORT`); the API is published separately on http://localhost:8880 (or `DEV_SERVER_HOST_PORT`) for direct Swagger / curl access.

To also pull projects from a registry API, add `REGISTRY_URL` to `.env`. From
inside the container, the host registry is reachable via
`http://host.containers.internal:<port>/copick/v1` (Podman) or
`http://host.docker.internal:<port>/copick/v1` (Docker Desktop).

For a registry-only deployment (no local config), comment out the
`COPICK_CONFIG_PATH` volume mount in your compose file and set
`COPICK_CONFIG_PATHS=[]` on the `server` service.

Access backend API (FastAPI) with http://localhost:8880/docs

To build & check production images
```bash
# uses compose.yml
podman compose up --build -d
# when done developing, shutdown
podman compose down
```

#### Joining Embrella's external network (optional)

By default the stack is self-contained on its own `copick-net` bridge. If you
run another compose stack (e.g. `embrella`) that needs to reach this one by
hostname, layer on `compose-embrella.yml`:

```bash
podman compose -f compose-dev.yml -f compose-embrella.yml up
```

On hosts that always want it, set `COMPOSE_FILE` in `.env` instead of passing `-f` each time:

```
COMPOSE_FILE=compose-prod.yml:compose-embrella.yml
```

### Manual
If you do not wish to run on Docker, these are the manual steps. Please see prerequisites section.

#### Server Development

```bash
cd server
pip install -e ".[dev]"

# Run with uvicorn for hot-reload. Settings are read from .env or env vars.
export COPICK_CONFIG_PATHS='["/path/to/config.json"]'
# Optional: also pull projects from a registry
# export REGISTRY_URL=http://localhost:8000/copick/v1
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

All settings are read by `pydantic-settings` from a `.env` file or process
environment. List-typed values use JSON-array syntax.

| Variable | Default | Description |
|----------|---------|-------------|
| `COPICK_CONFIG_PATHS` | `[]` | JSON array of local copick config file paths to register at startup. |
| `REGISTRY_URL` | _(unset)_ | Base URL of the project registry API (e.g. `http://localhost:8000/copick/v1`). The server appends `/projects/` itself. |
| `REGISTRY_REFRESH_SECONDS` | `60` | Background refresh interval for the registry list. |
| `SERVICE_CACHE_SIZE` | `8` | Max materialized `CopickService` instances kept in memory (LRU). Each has its own derived-data caches (`THUMBNAIL_CACHE_MB` + `MEASUREMENT_CACHE_MB`). |
| `CORS_ORIGINS` | localhost:5173/8000 | Allowed CORS origins. |
| `HOST` | `0.0.0.0` | Server host. |
| `PORT` | `8000` | Server port. |
| `BASE_PATH` | `""` | URL prefix of a reverse proxy that forwards it to the server (not needed when the proxy strips it). |
| `THUMBNAIL_CACHE_MB` | `64` | Run gallery thumbnail cache, per open project. |
| `MEASUREMENT_CACHE_MB` | `512` | Instance measurement and segmentation surface cache, per open project. |
| `CACHE_MAX_AGE_SECONDS` | `3600` | Cached entries older than this are dropped. |
| `CACHE_SWEEP_SECONDS` | `300` | How often expired entries of every open project are dropped. |

At least one of `COPICK_CONFIG_PATHS` or `REGISTRY_URL` must be set; otherwise
startup fails. The CLI sets `COPICK_CONFIG_PATHS` and `REGISTRY_URL` from its
flags before importing the app, so settings.json/.env are only consulted when
running uvicorn directly (or in containers).

## API Endpoints

All metadata and zarr-proxy routes are scoped under a `project_id`.

### Project listing

- `GET /api/projects` - All projects from registry + local configs (locals win on id collision).

### Metadata (per project)

- `GET /api/projects/{project_id}/config` - Project configuration
- `POST /api/projects/{project_id}/reload` - Re-open the project, so runs and annotations added since show up
- `GET /api/projects/{project_id}/objects` - Pickable objects
- `GET|POST /api/projects/{project_id}/object-types`, `PUT|DELETE .../object-types/{name}` - Edit the object types in the project's configuration file
- `GET /api/projects/{project_id}/runs` - List of runs
- `GET /api/projects/{project_id}/runs/{run}` - Run details with voxel spacings
- `GET /api/projects/{project_id}/runs/{run}/info` - Paths, portal links and contents of a run
- `GET /api/projects/{project_id}/runs/{run}/thumbnail` - Gallery thumbnail (PNG)
- `GET /api/projects/{project_id}/runs/{run}/picks` - List of picks for a run
- `GET /api/projects/{project_id}/runs/{run}/picks/{obj}/{user}/{session}` - Pick points
- `POST /api/projects/{project_id}/runs/{run}/picks` - Create picks
- `PUT /api/projects/{project_id}/runs/{run}/picks/{obj}/{user}/{session}` - Update picks
- `DELETE /api/projects/{project_id}/runs/{run}/picks/{obj}/{user}/{session}` - Delete picks
- `GET /api/projects/{project_id}/runs/{run}/segmentations` - List of segmentations (with `segmentation_type`; filter with `?segmentation_type=`)
- `GET /api/projects/{project_id}/runs/{run}/segmentations/{type}/{name}/{user}/{session}/{vs}/instances?level=1` - Instance voxel counts and centroids (instance / panoptic)
- `GET /api/projects/{project_id}/runs/{run}/segmentations/{type}/{name}/{user}/{session}/{vs}/surface` - Boundary voxels for the 3D view
- `GET /api/projects/{project_id}/runs/{run}/filaments` - Filament sets (empty on a copick without filaments)
- `GET|PUT|DELETE /api/projects/{project_id}/runs/{run}/filaments/{obj}/{user}/{session}` - Filament centrelines (501 on a copick without filaments)

Object types of a registry project are saved to the `config.json` in its overlay root on the cluster, over SSH with the
service account (`SLURM_USER` / `SLURM_KEYFILE`); without them they are read-only.

### Zarr Proxy

Local projects' stores are read through the server; registry projects' `zarr_url`s point at their `data_url` directly.

- `GET /zarr/{project_id}/tomo/{run}/{vs}/{type}/{path}` - Tomogram zarr chunks
- `GET /zarr/{project_id}/segmentation/{type}/{run}/{name}/{user}/{session}/{vs}/{path}` - Segmentation zarr chunks (`type`: binary, multilabel, instance, panoptic)
- `GET /zarr/{project_id}/seg/{run}/{name}/{user}/{session}/{vs}/{path}` - Legacy alias (binary and multilabel only)

## Architecture

```
copick-web/
├── server/                          # FastAPI server package
│   ├── pyproject.toml               # Package config with CLI entry point
│   └── src/copick_web/
│       ├── cli.py                   # CLI entry point
│       ├── static/                  # Built client files
│       └── app/
│           ├── main.py              # FastAPI application + lifespan
│           ├── config.py            # Settings
│           ├── models.py            # Pydantic response models
│           ├── dependencies.py      # FastAPI deps (project-scoped)
│           ├── routes/              # API route handlers (per-project)
│           └── services/
│               ├── copick_service.py    # Per-project copick wrapper
│               ├── registry_client.py   # httpx client for registry API
│               └── project_registry.py  # Multi-project metadata + LRU cache
└── client/                          # React application
    └── src/
        ├── api/                     # API client and hooks (project-scoped)
        ├── pages/                   # ProjectListPage, ProjectPage (router)
        ├── components/              # React components
        │   ├── layout/              # App layout
        │   ├── navigation/          # Run tree
        │   ├── entities/            # Picks/segmentations tables
        │   ├── viewer/              # Tomogram viewer
        │   └── overlays/            # Picks/segmentation overlays
        └── contexts/                # React context providers
```

## License

MIT

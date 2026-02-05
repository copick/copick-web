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

### Server Development

```bash
cd server
pip install -e ".[dev]"

# Run with uvicorn for hot-reload
export COPICK_CONFIG_PATH=/path/to/config.json
uvicorn copick_web.app.main:app --reload --port 8000
```

### Client Development

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

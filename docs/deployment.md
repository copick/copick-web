# Deploying copick-web on a VM

This guide covers deploying copick-web using pre-built container images from GitHub Container Registry (GHCR).

## Prerequisites

- A Linux VM (Ubuntu 22.04+ recommended)
- Podman with Compose
- Your copick config JSON and data directory accessible on the VM

## Quick start

### 1. Create a project directory

```bash
mkdir -p ~/copick-web && cd ~/copick-web
```

### 2. Download the compose file and env template

```bash
curl -LO https://raw.githubusercontent.com/copick/copick-web/main/compose-prod.yml
curl -L https://raw.githubusercontent.com/copick/copick-web/main/.env.example -o .env
```

### 3. Configure the environment

Edit `.env` to point to your copick config and data:

```bash
# .env
PUBLIC_HOST_PORT=8880
COPICK_CONFIG_PATH=/path/to/your/copick_config.json
COPICK_DATA_DIR=/path/to/your/copick/data
BASE_PATH=
```

> **Important:** Paths inside your `copick_config.json` must reference `/data/copick_data`
> since that is where `COPICK_DATA_DIR` is mounted inside the container.

### 4. Start the service

```bash
podman compose -f compose-prod.yml up -d
```

The app is now available at `http://<your-vm-ip>:8880` (or whichever port you set for `PUBLIC_HOST_PORT`).

### 5. Check status

```bash
podman compose -f compose-prod.yml ps
podman compose -f compose-prod.yml logs -f
```

## Updating

Pull the latest images and restart:

```bash
podman compose -f compose-prod.yml pull
podman compose -f compose-prod.yml up -d
```

## Running behind a reverse proxy

Set `BASE_PATH` in `.env` to match your reverse proxy sub-path. The client container
injects this at startup — no rebuild needed.

```bash
# .env
BASE_PATH=/viewer/copick-web
```

The reverse proxy should strip the prefix when forwarding to copick-web.

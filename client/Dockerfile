FROM node:22-slim AS build
# idetik requires newer npm version
RUN npm install -g npm@11
WORKDIR /app
COPY client/package*.json ./
# --ignore-scripts avoids ETXTBSY error with esbuild on Podman overlay fs
RUN npm ci --ignore-scripts && node node_modules/esbuild/install.js
COPY client/ .
# Local builds: read BASE_PATH from .env if present.
# CI builds (no .env): fall back to placeholder for runtime replacement.
COPY .env* .
RUN if grep -q '^BASE_PATH=' .env 2>/dev/null; then \
      export $(grep '^BASE_PATH=' .env | head -1 | xargs); \
    else \
      export BASE_PATH="/__COPICK_BASE_PATH__"; \
    fi && \
    npm run build

FROM docker.io/library/nginx:alpine
# Run workers as root (safe in rootless Podman — maps to host user)
RUN sed -i 's/user  nginx;/user  root;/' /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
RUN chmod -R a+rX /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
# Entrypoint script replaces BASE_PATH placeholder at container startup
COPY client/docker-entrypoint.sh /docker-entrypoint.d/40-base-path.sh
RUN chmod +x /docker-entrypoint.d/40-base-path.sh
EXPOSE 80

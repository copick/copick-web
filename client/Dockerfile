FROM node:22-slim AS build
# idetik requires newer npm version
RUN npm install -g npm@11
WORKDIR /app
COPY client/package*.json ./
# --ignore-scripts avoids ETXTBSY error with esbuild on Podman overlay fs
RUN npm ci --ignore-scripts && node node_modules/esbuild/install.js
COPY client/ .
# Read BASE_PATH from .env if present
COPY .env* .
RUN export $(grep -v '^#' .env 2>/dev/null | grep BASE_PATH= | xargs) && \
    npm run build

FROM docker.io/library/nginx:alpine
# Run workers as root (safe in rootless Podman — maps to host user)
RUN sed -i 's/user  nginx;/user  root;/' /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
RUN chmod -R a+rX /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

FROM node:24-slim AS build
WORKDIR /app
COPY client/package*.json ./
# No dependency needs an install script (Vite 8 bundles with Rolldown, not esbuild, and native
# binaries come as optional packages). --ignore-scripts once avoided an ETXTBSY error with esbuild's.
RUN npm ci --ignore-scripts
COPY client/ .
# No URL prefix is built in: the client finds it at runtime (see client/index.html).
RUN npm run build

FROM docker.io/library/nginx:alpine
# Run workers as root (safe in rootless Podman — maps to host user)
RUN sed -i 's/user  nginx;/user  root;/' /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
RUN chmod -R a+rX /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

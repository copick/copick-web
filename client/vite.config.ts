import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { workerLicenses } from "./workerLicenses";

const apiProxyTarget = process.env.API_PROXY_TARGET || "http://localhost:8000";
const hmrClientPort = process.env.VITE_HMR_CLIENT_PORT
  ? Number(process.env.VITE_HMR_CLIENT_PORT)
  : undefined;
// Inotify events don't propagate from a macOS host bind-mount into the
// Podman/Docker Linux VM, so Vite never sees file changes. Fall back to
// polling whenever VITE_HMR_CLIENT_PORT is set (i.e., we're running inside
// the dev container). Polling is too expensive to enable for native runs.
const usePolling = hmrClientPort !== undefined;

// Licences of the bundled packages, shipped with the build (the wheel's static/ folder, the nginx image).
const LICENSES = "THIRD_PARTY_LICENSES.md";
const licenses = workerLicenses(LICENSES);

export default defineConfig({
  // Relative: index.html finds the app root from the page URL at runtime, so one build runs under any URL prefix
  // (e.g. Open OnDemand's /rnode/<host>/<port>/ or a reverse proxy's /viewer/copick-web/).
  base: "./",
  plugins: [react(), licenses.append],
  worker: { plugins: () => [licenses.collect()] },
  build: { license: { fileName: LICENSES } },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  optimizeDeps: {
    exclude: ["@idetik/core"],
  },
  server: {
    port: 5173,
    hmr: hmrClientPort ? { clientPort: hmrClientPort } : undefined,
    watch: usePolling ? { usePolling: true, interval: 200 } : undefined,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/zarr": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});

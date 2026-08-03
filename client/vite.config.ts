import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const apiProxyTarget = process.env.API_PROXY_TARGET || "http://localhost:8000";
const hmrClientPort = process.env.VITE_HMR_CLIENT_PORT
  ? Number(process.env.VITE_HMR_CLIENT_PORT)
  : undefined;
// Inotify events don't propagate from a macOS host bind-mount into the
// Podman/Docker Linux VM, so Vite never sees file changes. Fall back to
// polling whenever VITE_HMR_CLIENT_PORT is set (i.e., we're running inside
// the dev container). Polling is too expensive to enable for native runs.
const usePolling = hmrClientPort !== undefined;

export default defineConfig({
  base: process.env.BASE_PATH ? `${process.env.BASE_PATH}/` : "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
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

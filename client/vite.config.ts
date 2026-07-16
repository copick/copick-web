import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const apiProxyTarget =
  process.env.API_PROXY_TARGET || "http://localhost:8000";
const hmrClientPort = process.env.VITE_HMR_CLIENT_PORT
  ? Number(process.env.VITE_HMR_CLIENT_PORT)
  : undefined;

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

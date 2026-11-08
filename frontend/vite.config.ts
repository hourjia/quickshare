import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";


export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backend = (env.VITE_DEV_BACKEND || "http://127.0.0.1:8000").replace(/\/+$/, "");
  const backendWs = backend.replace(/^http/i, "ws");

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        "/api": backend,
        "/ws": {
          target: backendWs,
          ws: true,
        },
      },
    },
  };
});

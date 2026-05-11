import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    // Proxy api + websocket to the native `cargo run -p zerovpn-api`
    // process. The frontend hits `/api/v1/...` (same-origin) so we forward
    // those requests to the api on its host port. WS upgrades over the same
    // path work because `ws: true` lets Vite proxy the upgrade frame.
    //
    // Override the target with VITE_API_PROXY for non-default ports.
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY ?? "http://localhost:8080",
        changeOrigin: true,
        ws: true,
      },
      "/health": process.env.VITE_API_PROXY ?? "http://localhost:8080",
      "/ready": process.env.VITE_API_PROXY ?? "http://localhost:8080",
      "/metrics": process.env.VITE_API_PROXY ?? "http://localhost:8080",
      "/openapi.json": process.env.VITE_API_PROXY ?? "http://localhost:8080",
    },
  },
})

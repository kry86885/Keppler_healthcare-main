import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // The Symptom AI page calls these four endpoints directly against the
      // standalone symptom_backend microservice (unauthenticated, no session
      // needed) -- they must be routed there specifically, ahead of the
      // general /api rule below, or they'd silently fall through to the main
      // backend's own same-path routes, which DO require a session + CSRF
      // token that these plain fetch() calls never send, producing a 403.
      "/api/symptom-ai/meta": {
        target: process.env.SYMPTOM_BACKEND_PROXY_TARGET || "http://127.0.0.1:5002",
        changeOrigin: true,
        secure: false,
      },
      "/api/symptom-ai/detect-region": {
        target: process.env.SYMPTOM_BACKEND_PROXY_TARGET || "http://127.0.0.1:5002",
        changeOrigin: true,
        secure: false,
      },
      "/api/symptom-ai/analyze": {
        target: process.env.SYMPTOM_BACKEND_PROXY_TARGET || "http://127.0.0.1:5002",
        changeOrigin: true,
        secure: false,
      },
      "/api/symptom-ai/export/pdf": {
        target: process.env.SYMPTOM_BACKEND_PROXY_TARGET || "http://127.0.0.1:5002",
        changeOrigin: true,
        secure: false,
      },
      // All other /api/* requests are forwarded to the main Flask backend.
      // This runs same-origin from the browser's perspective,
      // so session cookies are always sent correctly.
      "/api": {
        target: process.env.BACKEND_PROXY_TARGET || "http://127.0.0.1:5001",
        changeOrigin: true,
        secure: false,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.js",
    include: ["src/**/*.test.{js,jsx,ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    server: {
      deps: {
        inline: ["@exodus/bytes", "html-encoding-sniffer"]
      }
    }
  },
});

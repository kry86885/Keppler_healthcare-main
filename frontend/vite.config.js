import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // All /api/* requests are forwarded to the Flask backend.
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

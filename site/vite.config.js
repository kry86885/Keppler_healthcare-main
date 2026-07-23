import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        home: resolve(__dirname, "index.html"),
        iterations: resolve(__dirname, "iterations.html"),
        v1: resolve(__dirname, "index-v1.html"),
        v2: resolve(__dirname, "index-v2.html"),
        v3: resolve(__dirname, "index-v3.html"),
        v4: resolve(__dirname, "index-v4.html"),
        v5: resolve(__dirname, "index-v5.html"),
        login: resolve(__dirname, "login.html"),
        register: resolve(__dirname, "register.html"),
        contact: resolve(__dirname, "contact.html"),
        about: resolve(__dirname, "about.html"),
        terms: resolve(__dirname, "terms.html"),
        privacy: resolve(__dirname, "privacy.html")
      }
    }
  }
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@tauri-apps/api/core": path.resolve(__dirname, "./src/services/tauri-shim.ts"),
      "@tauri-apps/api/event": path.resolve(__dirname, "./src/services/tauri-shim.ts"),
    },
  },
  server: {
    port: 3000,
  },
  build: {
    outDir: "dist",
  }
});

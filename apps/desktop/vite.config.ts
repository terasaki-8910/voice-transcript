import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri-recommended Vite config (https://v2.tauri.app/start/frontend/vite):
// fixed port matching tauri.conf.json's devUrl, ignore src-tauri in watch
// (it's Rust, not frontend), don't let Vite's overlay obscure Rust errors.
// Port 5173 is Vite's own default, so it collides with any other Vite
// project's dev server running on this machine at the same time -- picked
// 5183 (off the beaten path) instead of the default.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5183,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5184,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});

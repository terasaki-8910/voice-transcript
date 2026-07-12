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
    // "safari13" (the original Tauri-template default) falls inside a
    // known esbuild 0.28+ bug range (Safari < 14.1) that errors on
    // destructuring transforms instead of downleveling them --
    // https://github.com/evanw/esbuild/issues/4436. Tauri's actual macOS
    // webview (WKWebView) tracks a far newer WebKit than Safari 13 on any
    // supported macOS version anyway, so "safari15" is both the working
    // fix and the more accurate target.
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari15",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.tsx", "tests/**/*.test.ts"],
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 20_000,
  },
});

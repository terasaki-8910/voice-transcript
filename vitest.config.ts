import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests are fast and always run. Integration tests (tests/e2e/**) hit the
// real Groq API and self-skip unless GROQ_API_KEY is set (see the E-suite).
export default defineConfig({
  resolve: {
    alias: {
      // tests/e2e/integration.test.ts imports packages/cli/src/cli.ts, which
      // in turn imports the bare specifier "@voice-transcript/core". Node's
      // own resolution would walk up from packages/cli/src/ and find it via
      // packages/cli/node_modules (a local `file:../core` dependency -- pnpm
      // workspace linking isn't set up yet). Vite/Vitest does NOT replicate
      // that per-file upward walk; it resolves bare specifiers relative to
      // this config's own root. This alias is a temporary bridge -- once a
      // real `pnpm install` hoists workspace packages into the root
      // node_modules, this becomes redundant (safe to remove then, not
      // required to remove).
      "@voice-transcript/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Per-test overrides are used for the long-running integration cases.
    testTimeout: 20_000,
  },
});

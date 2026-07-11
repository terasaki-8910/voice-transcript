import { defineConfig } from "vitest/config";

// Unit tests are fast and always run. Integration tests (tests/e2e/**) hit the
// real Groq API and self-skip unless GROQ_API_KEY is set (see the E-suite).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Per-test overrides are used for the long-running integration cases.
    testTimeout: 20_000,
  },
});

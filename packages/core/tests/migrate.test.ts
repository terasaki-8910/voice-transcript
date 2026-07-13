// Pins defaultMigrationsFolder()'s path resolution (packages/core/src/db/
// migrate.ts) -- the fallback used by the CLI and tests, and the thing the
// GUI sidecar's MIGRATIONS_DIR env var override exists specifically to
// replace once bundled (see that file's doc comment). ensureSchema() itself
// needs a real Postgres connection to test meaningfully, so it's left to
// the DATABASE_URL-gated integration suite (tests/e2e), not covered here.
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defaultMigrationsFolder } from "../src/db/migrate.js";

describe("defaultMigrationsFolder", () => {
  it("resolves to a real directory containing the migration SQL and its journal", () => {
    const dir = defaultMigrationsFolder();
    expect(existsSync(dir)).toBe(true);

    const entries = readdirSync(dir);
    expect(entries.some((e) => e.endsWith(".sql"))).toBe(true);
    expect(existsSync(join(dir, "meta", "_journal.json"))).toBe(true);
  });
});

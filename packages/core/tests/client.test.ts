// H6: createDb()'s pool must let the process exit once idle instead of
// waiting on pg-pool's default 10s idle timer (see client.ts's own comment
// for why). Pool construction doesn't connect eagerly, so this needs no
// real DATABASE_URL -- a stubbed one is enough to inspect the constructed
// pool's options.
import { describe, it, expect, afterEach, vi } from "vitest";
import { createDb } from "../src/db/client.js";

describe("createDb", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns undefined when DATABASE_URL is unset", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(createDb()).toBeUndefined();
  });

  it("builds a pool that allows the process to exit once idle", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@localhost:5432/unused");
    const db = createDb();
    expect(db).toBeDefined();
    expect(db?.$client.options.allowExitOnIdle).toBe(true);
    expect(db?.$client.options.connectionString).toBe("postgres://user:pass@localhost:5432/unused");
    await db?.$client.end();
  });
});

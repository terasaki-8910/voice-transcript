// ACCEPTANCE H3, H4: static guard over the core data-access layer
// (packages/core/src/db/**).
// H3 -- DATABASE_URL is read only from the environment; no DB host,
//   credential, or connection string is hardcoded (same pattern as F4).
// H4 -- no raw vendor-specific SQL strings outside migration files; all
//   queries go through the ORM/query-builder, so a later Postgres -> MySQL
//   move is a config change, not a rewrite.
//
// Note: unlike the behavioural tests, H3/H4 are invariants. Both fail now
// because packages/core/src/db/ does not yet exist, and each stays green
// once the data-access layer is implemented per SPEC.md's portability
// requirement.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DB_SRC = new URL("../packages/core/src/db/", import.meta.url).pathname;
const MIGRATIONS_PREFIX = "migrations" + (process.platform === "win32" ? "\\" : "/");

function readDbFiles(includeMigrations: boolean): { path: string; text: string }[] {
  let entries: string[];
  try {
    entries = readdirSync(DB_SRC, { recursive: true }) as string[];
  } catch {
    return []; // packages/core/src/db absent -> empty; assertions below fail (red).
  }
  return entries
    .filter((e) => e.endsWith(".ts"))
    .filter((e) => includeMigrations || !e.startsWith(MIGRATIONS_PREFIX))
    .map((e) => ({ path: e, text: readFileSync(join(DB_SRC, e), "utf8") }));
}

describe("H3 - DATABASE_URL handling", () => {
  const files = readDbFiles(true);

  it("has db-layer source files to inspect", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("reads DATABASE_URL from process.env", () => {
    const readsEnv = files.some((f) => f.text.includes("process.env.DATABASE_URL"));
    expect(readsEnv).toBe(true);
  });

  it("contains no hardcoded DB connection string", () => {
    const CONN_STRING = /(?:postgres(?:ql)?|mysql):\/\/\S/;
    const offenders = files.filter((f) => CONN_STRING.test(f.text));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });
});

describe("H4 - no raw vendor SQL outside migrations", () => {
  const files = readDbFiles(false);

  it("has non-migration db-layer source files to inspect", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("uses no raw sql`...` template or raw query call", () => {
    // Matches a `sql` tagged template, or `.query(`/`.execute(`/`.raw(`/
    // `.unsafe(` called with a literal string -- the shapes a raw,
    // vendor-specific SQL string would take outside the ORM's query builder.
    const RAW_SQL = /(?:^|[^A-Za-z0-9_])sql`|\.\s*(?:query|execute|raw|unsafe)\s*\(\s*[`'"]/;
    const offenders = files.filter((f) => RAW_SQL.test(f.text));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });
});

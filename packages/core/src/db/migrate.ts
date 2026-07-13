import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Db } from "./client.js";

// H4: this file only ever calls drizzle-orm's own migrate() -- no raw SQL
// or tagged-template query lives anywhere in packages/core/src/db/**
// outside migrations/ itself. migrate() tracks applied migrations in its
// own drizzle.__drizzle_migrations table, so calling it before every query
// is idempotent and cheap once already up to date -- this is how a fresh
// DATABASE_URL (Preferences or environment) gets its tables created
// automatically instead of requiring someone to run the migration SQL by
// hand first (see ACCEPTANCE H3-H5's "never blocking" spirit: an empty/
// missing DB should become usable, not just fail cleanly).
//
// Never throws: a DB migrated by hand before this existed (per this
// project's own earlier setup docs) has no
// __drizzle_migrations bookkeeping row even though its tables are already
// correct, so migrate() tries to redo them and fails on "already exists" --
// a real error, but not one that should block the query that follows,
// since that query is the actual source of truth for whether the DB is
// usable (it fails on its own, correctly, if the schema is genuinely
// wrong). Logged, not silent -- same non-blocking-but-loud pattern as
// recordHistorySafe. migrationsFolder is optional for the same reason --
// sidecar.ts's own fallback to defaultMigrationsFolder() can itself fail
// inside the pkg-bundled sidecar (see that function's doc comment); rather
// than have every caller special-case that, ensureSchema treats "no folder
// available" the same as "migration failed": skip it, let the query that
// follows be the real signal.
export async function ensureSchema(db: Db, migrationsFolder: string | undefined): Promise<void> {
  if (!migrationsFolder) {
    console.error("[db] schema migration skipped (non-blocking): no migrations folder available");
    return;
  }
  try {
    await migrate(db, { migrationsFolder });
  } catch (err) {
    console.error("[db] schema migration skipped (non-blocking):", err);
  }
}

// Resolves migrations/ as a real on-disk sibling of this file -- correct
// for the CLI (runs from source, per CLAUDE.md) and for tests, both of
// which execute this package's actual .ts files as real ESM, not a bundle.
// The GUI's sidecar is different: it's compiled by esbuild into a single
// CJS file for @yao-pkg/pkg (see packages/core/scripts/build-sidecar.mjs),
// and import.meta.url is empty in CJS output (esbuild warns on this at
// build time) -- migrations/ isn't a real sibling on disk at that point
// either way. The sidecar is instead told the migrations folder explicitly
// via the MIGRATIONS_DIR environment variable (apps/desktop/src-tauri/src/
// commands.rs sets it from Tauri's bundled resource directory), read in
// sidecar.ts -- this function is only the fallback default for every other
// caller, and throws a clear error (instead of a cryptic one from
// fileURLToPath(undefined)) in the one context where that fallback itself
// can't work.
export function defaultMigrationsFolder(): string {
  if (!import.meta.url) {
    throw new Error(
      "defaultMigrationsFolder() needs import.meta.url, which is empty here (a CJS bundle, " +
        "e.g. the packaged sidecar) -- pass MIGRATIONS_DIR explicitly instead of relying on this fallback.",
    );
  }
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "migrations");
}

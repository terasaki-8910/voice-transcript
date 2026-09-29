import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

// ACCEPTANCE H3: DATABASE_URL is read only from the environment, never
// hardcoded. Returns undefined (not a throw) when unset -- callers use
// recordHistorySafe/listHistorySafe (history.ts) so a missing/unreachable
// DB never blocks or crashes a transcription (H5).
// H6: every sidecar invocation is a fresh, short-lived process, and Rust
// (commands.rs's call_sidecar) resolves the webview's call only once that
// process has actually EXITED -- not once it's written its JSON line (Tauri
// shell's Command::output() reads the child's event stream until it
// terminates). pg-pool's default idleTimeoutMillis (10s) only unrefs its
// idle-client timer/socket -- letting Node exit on its own once truly
// idle -- when allowExitOnIdle is set; left at its default false, that
// timer keeps the event loop alive for a full 10s after the last query,
// so every DB-touching command (history, dictionary, notes, a
// transcription's history write) paid real-work-time plus a ~10s dead
// tail. allowExitOnIdle fixes this at the source for all of them.
//
// Deliberately not "fixed" with a manual process.exit() after the
// response is written instead: Node doesn't guarantee pending stdout I/O
// survives process.exit() (writes to a pipe can be async, e.g. on
// macOS) -- a large list-history payload could be truncated.
// allowExitOnIdle only lets the process exit once genuinely idle, which
// waits for the write to flush first. Keep this property if the driver
// ever changes.
export function createDb(): Db | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  return drizzle({ connection: { connectionString: url, allowExitOnIdle: true }, schema });
}

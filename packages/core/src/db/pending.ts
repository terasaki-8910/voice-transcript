// Durable outbox for history records that could not be written because the
// database was unreachable (ACCEPTANCE H5 keeps the write non-blocking; this
// makes it non-lossy). A record is parked as one JSON file in a per-user
// directory shared by the CLI and the desktop sidecar, and flushed into the
// database the next time either of them reaches it.
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { Db } from "./client.js";
import { ensureSchema } from "./migrate.js";
import { recordHistory } from "./history.js";
import type { HistoryRecordInput } from "./history.js";
import { listDictionary } from "./dictionary.js";
import { applyDictionary } from "../dictionary.js";
import type { DictionaryEntry } from "../dictionary.js";

const PENDING_VERSION = 1;
const LOCK_NAME = ".lock";
const LOCK_STALE_MS = 5 * 60 * 1000;
// Flushes only run once ensureSchema() has reached the database, so a record
// whose insert keeps failing is the problem itself (it would otherwise block
// every record behind it forever); a dropped connection mid-flush is a rare,
// one-off failure that a handful of attempts absorbs.
const MAX_FLUSH_ATTEMPTS = 5;

export interface PendingHistoryFile {
  version: 1;
  startedAt: string;
  dictionaryApplied: boolean;
  input: Omit<HistoryRecordInput, "startedAt">;
  attempts?: number; // failed flushes so far
}

export function pendingHistoryDir(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (env.VOICE_TRANSCRIPT_PENDING_DIR) return env.VOICE_TRANSCRIPT_PENDING_DIR;
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "voice-transcript", "pending-history");
  }
  if (platform === "win32") {
    return join(env.APPDATA || join(home, "AppData", "Roaming"), "voice-transcript", "pending-history");
  }
  return join(env.XDG_DATA_HOME || join(home, ".local", "share"), "voice-transcript", "pending-history");
}

export async function savePendingHistory(
  dir: string,
  record: { startedAt: Date; dictionaryApplied: boolean; input: HistoryRecordInput },
): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const { startedAt: _ignored, ...input } = record.input;
  const file: PendingHistoryFile = {
    version: PENDING_VERSION,
    startedAt: record.startedAt.toISOString(),
    dictionaryApplied: record.dictionaryApplied,
    input,
  };
  const base = `${file.startedAt.replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}`;
  await writeFileAtomic(join(dir, `${base}.json`), file);
}

// Owner-only (transcripts are private), and never visible half-written:
// listPendingFiles() only picks up *.json, and rename() is atomic.
async function writeFileAtomic(path: string, file: PendingHistoryFile): Promise<void> {
  const tmp = path.replace(/\.json$/, ".tmp");
  await writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
  await rename(tmp, path);
}

async function listPendingFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

// Returns a release function, or undefined when another flusher holds the lock.
async function acquireLock(dir: string): Promise<(() => Promise<void>) | undefined> {
  const lockPath = join(dir, LOCK_NAME);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.close();
      return async () => {
        await unlink(lockPath).catch(() => {});
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") return undefined;
      try {
        const { mtimeMs } = await stat(lockPath);
        if (Date.now() - mtimeMs <= LOCK_STALE_MS) return undefined;
        await unlink(lockPath);
      } catch {
        // Lock vanished or could not be removed; the retry decides.
      }
    }
  }
  return undefined;
}

// Caller must have run ensureSchema() successfully. Never throws for a
// record-level failure: it logs, stops, and keeps the remaining files.
export async function flushPendingHistory(
  db: Db,
  dir: string,
  opts: { loadDictionary?: () => Promise<DictionaryEntry[]> } = {},
): Promise<{ saved: number; remaining: number }> {
  if ((await listPendingFiles(dir)).length === 0) return { saved: 0, remaining: 0 };
  const release = await acquireLock(dir);
  if (!release) return { saved: 0, remaining: (await listPendingFiles(dir)).length };
  let saved = 0;
  try {
    let dictionary: DictionaryEntry[] | undefined;
    for (const name of await listPendingFiles(dir)) {
      const path = join(dir, name);
      let file: PendingHistoryFile;
      try {
        const parsed = JSON.parse(await readFile(path, "utf8")) as PendingHistoryFile;
        if (parsed?.version !== PENDING_VERSION || !parsed.input || Number.isNaN(Date.parse(parsed.startedAt))) {
          throw new Error("unsupported pending history file");
        }
        file = parsed;
      } catch (err) {
        console.error(`[history] pending record ${name} is unreadable; kept as ${name}.bad:`, err);
        await rename(path, `${path}.bad`).catch(() => {});
        continue;
      }
      try {
        const input: HistoryRecordInput = { ...file.input, startedAt: new Date(file.startedAt) };
        if (!file.dictionaryApplied && opts.loadDictionary && input.result) {
          dictionary ??= await opts.loadDictionary();
          input.result = applyDictionary(input.result, dictionary);
        }
        await recordHistory(db, input);
        await unlink(path);
        saved++;
      } catch (err) {
        const attempts = (file.attempts ?? 0) + 1;
        if (attempts >= MAX_FLUSH_ATTEMPTS) {
          console.error(`[history] pending record ${name} failed ${String(attempts)} times; kept as ${name}.bad:`, err);
          await rename(path, `${path}.bad`).catch(() => {});
          continue;
        }
        console.error(`[history] failed to flush pending record ${name}; will retry later:`, err);
        await writeFileAtomic(path, { ...file, attempts }).catch(() => {});
        break;
      }
    }
  } finally {
    await release();
  }
  return { saved, remaining: (await listPendingFiles(dir)).length };
}

export interface RecordOrDeferOptions {
  migrationsFolder?: string;
  pendingDir: string;
  dictionaryApplied: boolean;
}

// ACCEPTANCE H5 + H6: the history write never throws and never blocks the
// transcription. A failed write is parked in the outbox instead of lost.
export async function recordHistoryOrDefer(
  db: Db | undefined,
  input: HistoryRecordInput,
  opts: RecordOrDeferOptions,
): Promise<{ id?: number; pending: boolean }> {
  if (!db) {
    console.error("[history] DATABASE_URL not set; history not recorded");
    return { pending: false };
  }
  const startedAt = input.startedAt ?? new Date();
  let id: number;
  try {
    await ensureSchema(db, opts.migrationsFolder);
    id = await recordHistory(db, input);
  } catch (err) {
    console.error("[history] failed to record history (non-blocking):", err);
    try {
      await savePendingHistory(opts.pendingDir, { startedAt, dictionaryApplied: opts.dictionaryApplied, input });
      return { pending: true };
    } catch (saveErr) {
      console.error(`[history] could not save to ${opts.pendingDir}; this record is lost:`, saveErr);
      return { pending: false };
    }
  }
  try {
    await flushPendingHistory(db, opts.pendingDir, { loadDictionary: () => listDictionary(db) });
  } catch (err) {
    console.error("[history] flushing pending records failed (non-blocking):", err);
  }
  return { id, pending: false };
}

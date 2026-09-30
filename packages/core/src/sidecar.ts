#!/usr/bin/env node
// Node sidecar entry point, spawned by the Rust shell
// (apps/desktop/src-tauri/src/commands.rs) via tauri-plugin-shell. Runs
// this package's pipeline + history layer on the desktop app's behalf --
// the webview never gets fs/network/DB access directly (SPEC.md >
// Architecture; .claude/agents/tauri-capability-reviewer.md).
//
// Protocol: argv[2] = command name, argv[3] = JSON-encoded args. Writes
// exactly ONE JSON line to stdout: { ok: true, data } on success,
// { ok: false, error } on a domain failure. Never lets an error escape
// main() uncaught -- a non-JSON stdout line or a nonzero exit is a
// transport-level failure (the process itself broke), not a domain error;
// keeping those distinct gives the Rust side a single, reliable parse path.
import { createFfmpegBackend } from "./audio.js";
import type { AudioBackend } from "./audio.js";
import { GroqClient } from "./groq.js";
import type { Transcriber } from "./types.js";
import { runPipeline } from "./pipeline.js";
import { render } from "./formats.js";
import { createDb } from "./db/client.js";
import {
  recordHistorySafe,
  listHistory,
  getHistoryById,
  deleteHistoryEntry,
  searchHistory,
  updateTranscriptionTitle,
} from "./db/history.js";
import {
  listDictionary,
  addDictionaryEntry,
  updateDictionaryEntry,
  deleteDictionaryEntry,
  importDictionaryEntries,
} from "./db/dictionary.js";
import type { DictionaryRecord, ImportResult } from "./db/dictionary.js";
import { applyDictionary } from "./dictionary.js";
import type { DictionaryEntry } from "./dictionary.js";
import { listNotes, addNote, updateNote, deleteNote } from "./db/notes.js";
import type { TranscriptNoteRecord, NewTranscriptNote } from "./db/notes.js";
import { ensureSchema, defaultMigrationsFolder } from "./db/migrate.js";
import type { HistoryRecordInput, HistoryRecord, HistorySearchResult } from "./db/history.js";
import type { OutputFormat } from "./types.js";

// Amical's vocabulary export shape (source_device/count wrapper, snake_case
// fields, is_replacement as 0|1) -- the ONLY other shape import-dictionary
// accepts besides the plain { word, replacement }[] this app's own DB uses.
// Entries with is_replacement falsy are skipped: Amical also stores plain
// vocabulary hints (no replacement) under the same export, which this app
// has no use for (see SPEC.md > Custom dictionary).
interface AmicalDictionaryExport {
  entries: Array<{ word: string; replacement_word: string; is_replacement?: number }>;
}

function isAmicalExport(value: unknown): value is AmicalDictionaryExport {
  return typeof value === "object" && value !== null && Array.isArray((value as { entries?: unknown }).entries);
}

export function parseDictionaryImport(json: string): { entries: DictionaryEntry[]; skipped: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // Deliberately a clean, fixed message -- Node's own SyntaxError embeds a
    // snippet of the invalid input (e.g. `Unexpected token 'g', "gsk_123"...
    // is not valid JSON`), which this app's Rust side surfaces verbatim to
    // the webview on failure. Now unreachable via an attacker-chosen file
    // (import_dictionary_file only ever reads a path the user just picked
    // through a native dialog -- see commands.rs), but this is the second,
    // defense-in-depth layer flagged by tauri-capability-reviewer: never let
    // a raw parse error carry file content into a UI-visible string.
    throw new Error("Not a valid dictionary JSON file.");
  }

  if (isAmicalExport(parsed)) {
    let skipped = 0;
    const entries: DictionaryEntry[] = [];
    for (const raw of parsed.entries) {
      if (!raw.is_replacement) {
        skipped++;
        continue;
      }
      entries.push({ word: raw.word, replacement: raw.replacement_word });
    }
    return { entries, skipped };
  }

  if (Array.isArray(parsed)) {
    const entries = parsed as Array<{ word: string; replacement: string }>;
    return { entries: entries.map((e) => ({ word: e.word, replacement: e.replacement })), skipped: 0 };
  }

  throw new Error("Unrecognized dictionary import format.");
}

// MIGRATIONS_DIR is set by the Rust shell (apps/desktop/src-tauri/src/
// commands.rs) from Tauri's bundled resource directory when this file runs
// as the pkg-compiled sidecar binary -- see db/migrate.ts's comment on why
// that binary can't resolve migrations/ as a real on-disk sibling of
// itself the way the CLI (running from source) or a test can. The
// defaultMigrationsFolder() fallback below is therefore only reachable here
// if Rust's own resource_dir() resolution failed (see commands.rs's
// migrations_dir_env) -- itself needs its own try/catch, since it throws
// (deliberately, with a clear message) in exactly this bundled context;
// ensureSchema() already treats "no folder available" as non-fatal.
function migrationsFolder(env: Record<string, string | undefined>): string | undefined {
  if (env.MIGRATIONS_DIR) return env.MIGRATIONS_DIR;
  try {
    return defaultMigrationsFolder();
  } catch {
    return undefined;
  }
}

export interface TranscribeArgs {
  filePath: string;
  model: string;
  language?: string;
  format: OutputFormat;
}

export interface TranscribeResponse {
  text: string;
  rendered: string;
  language?: string;
  duration?: number;
  // The new transcriptions.id, so the GUI can attach notes to a just-
  // finished transcription without waiting for it to show up in a
  // listHistory() call. Absent whenever recordHistory didn't write a row --
  // no DATABASE_URL configured, or the DB write itself failed (both
  // non-fatal to the transcription per ACCEPTANCE H5) -- the GUI treats a
  // missing id as "notes aren't available here," not an error.
  id?: number;
}

// Same injection shape as packages/cli/src/cli.ts's CliDeps -- lets tests
// exercise handleTranscribe without real ffmpeg, network, or a DB.
export interface SidecarDeps {
  env?: Record<string, string | undefined>;
  audio?: AudioBackend;
  makeTranscriber?: (apiKey: string) => Transcriber;
  recordHistory?: (input: HistoryRecordInput) => Promise<number | undefined>;
  listHistory?: () => Promise<HistoryRecord[]>;
  getHistory?: (id: number) => Promise<HistoryRecord | undefined>;
  deleteHistoryEntry?: (id: number) => Promise<void>;
  updateHistoryTitle?: (id: number, title: string | null) => Promise<{ id: number; title: string | null } | undefined>;
  searchHistory?: (terms: string[]) => Promise<HistorySearchResult[]>;
  listDictionary?: () => Promise<DictionaryRecord[]>;
  addDictionaryEntry?: (entry: DictionaryEntry) => Promise<DictionaryRecord>;
  updateDictionaryEntry?: (id: number, entry: DictionaryEntry) => Promise<DictionaryRecord | undefined>;
  deleteDictionaryEntry?: (id: number) => Promise<void>;
  importDictionary?: (entries: DictionaryEntry[]) => Promise<ImportResult>;
  listNotes?: (transcriptionId: number) => Promise<TranscriptNoteRecord[]>;
  addNote?: (input: NewTranscriptNote) => Promise<TranscriptNoteRecord>;
  updateNote?: (id: number, note: string) => Promise<TranscriptNoteRecord | undefined>;
  deleteNote?: (id: number) => Promise<void>;
  testConnection?: () => Promise<{ connected: boolean; error?: string }>;
}

// Used by handleTranscribe: a dictionary fetch failure is caught and logged,
// never fatal -- same non-blocking rule recordHistorySafe applies to H5.
async function fetchDictionarySafe(
  env: Record<string, string | undefined>,
  deps: SidecarDeps,
): Promise<DictionaryEntry[]> {
  if (deps.listDictionary) return deps.listDictionary();
  try {
    const db = createDb();
    if (!db) return [];
    await ensureSchema(db, migrationsFolder(env));
    return await listDictionary(db);
  } catch (err) {
    console.error("[dictionary] failed to load dictionary (non-blocking):", err);
    return [];
  }
}

export async function handlePing(): Promise<string> {
  return "pong";
}

// Settings > Connection's "Test connection" button (2026-09-30,
// user-requested: a real connectivity failure -- Tailscale up, Postgres
// port open, still couldn't connect -- had no way to self-diagnose from
// inside the app). Deliberately a raw connectivity check, not a full
// ensureSchema() + query: the point is "can I reach and authenticate to
// this Postgres," a strictly smaller and faster question than "is the
// schema also set up," which every other DB command already handles
// gracefully on its own (auto-provisions on first real use). Never
// throws -- a connection failure is an ordinary, expected RESULT here
// (connected: false + the real driver error message, e.g. "connect
// ETIMEDOUT", "password authentication failed for user ...", "getaddrinfo
// ENOTFOUND ..."), not an exceptional one; the webview never sees
// DATABASE_URL itself, only this result.
export async function handleTestConnection(
  deps: SidecarDeps = {},
): Promise<{ connected: boolean; error?: string }> {
  if (deps.testConnection) return deps.testConnection();
  const db = createDb();
  if (!db) return { connected: false, error: "DATABASE_URL is not set." };
  try {
    await db.$client.query("SELECT 1");
    return { connected: true };
  } catch (err) {
    return { connected: false, error: errorMessage(err) };
  }
}

export async function handleTranscribe(
  args: TranscribeArgs,
  deps: SidecarDeps = {},
): Promise<TranscribeResponse> {
  const env = deps.env ?? process.env;
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY environment variable is not set.");
  }

  const audio = deps.audio ?? createFfmpegBackend();
  const makeTranscriber = deps.makeTranscriber ?? ((key: string) => new GroqClient({ apiKey: key }));
  const recordHistory =
    deps.recordHistory ??
    ((input: HistoryRecordInput) => recordHistorySafe(createDb(), input, migrationsFolder(env)));

  await audio.assertAvailable();

  const historyBase = {
    sourceFileName: args.filePath,
    model: args.model,
    language: args.language,
    formats: [args.format],
  };

  try {
    const transcriber = makeTranscriber(apiKey);
    const rawResult = await runPipeline(args.filePath, {
      audio,
      transcriber,
      model: args.model,
      language: args.language,
      onProgress: (msg) => process.stderr.write(`${msg}\n`),
    });
    // Custom dictionary (word replacement) applied here -- after
    // runPipeline, before render()/recordHistory() -- so the stored history
    // text, the rendered/exported output, and this response's text are all
    // the corrected text. runPipeline() itself stays DB-free and pure.
    const dictionaryEntries = await fetchDictionarySafe(env, deps);
    const result = applyDictionary(rawResult, dictionaryEntries);
    const rendered = render(result, args.format);
    const id = await recordHistory({ ...historyBase, status: "success", result });
    return { text: result.text, rendered, language: result.language, duration: result.duration, id };
  } catch (err) {
    await recordHistory({ ...historyBase, status: "failed" });
    throw err;
  }
}

// ACCEPTANCE H2: list past runs for the GUI's history view. Returns []
// (not an error) when DATABASE_URL is unset -- an empty history list is a
// valid, displayable state, not a failure (mirrors H5's "never blocking"
// spirit for reads too).
export async function handleListHistory(deps: SidecarDeps = {}): Promise<HistoryRecord[]> {
  if (deps.listHistory) return deps.listHistory();
  const db = createDb();
  if (!db) return [];
  await ensureSchema(db, migrationsFolder(process.env));
  return listHistory(db);
}

// Search (SPEC.md > Search). Splits on whitespace here -- the one place
// that owns tokenization, rather than duplicating it on the webview side
// too. Returns [] (not an error) with no DB, same "a read never blocks"
// rule as handleListHistory.
export async function handleSearchHistory(
  args: { query: string },
  deps: SidecarDeps = {},
): Promise<HistorySearchResult[]> {
  const terms = args.query.split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return [];
  if (deps.searchHistory) return deps.searchHistory(terms);
  const db = createDb();
  if (!db) return [];
  await ensureSchema(db, migrationsFolder(process.env));
  return searchHistory(db, terms);
}

// ACCEPTANCE H2: open one past run and read its stored transcript. Throws
// (surfaced as a domain error) if the id doesn't exist -- this only happens
// via a stale id (e.g. deleted in another window between list and open),
// not the normal path, so an error is the right signal here.
export async function handleGetHistory(
  args: { id: number },
  deps: SidecarDeps = {},
): Promise<HistoryRecord> {
  const record = deps.getHistory
    ? await deps.getHistory(args.id)
    : await (async () => {
        const db = createDb();
        if (!db) throw new Error("DATABASE_URL not set; no history to read.");
        await ensureSchema(db, migrationsFolder(process.env));
        return getHistoryById(db, args.id);
      })();
  if (!record) throw new Error(`History entry ${args.id} not found.`);
  return record;
}

// ACCEPTANCE G9: delete a history record and hand back its sourceFileName
// so the Rust side can also move the still-existing source audio to the OS
// trash. Looks the record up first (for its path) since a plain SQL DELETE
// doesn't return the deleted row's data.
export async function handleDeleteHistoryEntry(
  args: { id: number },
  deps: SidecarDeps = {},
): Promise<{ sourceFileName: string }> {
  if (deps.deleteHistoryEntry) {
    const record = deps.getHistory ? await deps.getHistory(args.id) : undefined;
    if (!record) throw new Error(`History entry ${args.id} not found.`);
    await deps.deleteHistoryEntry(args.id);
    return { sourceFileName: record.sourceFileName };
  }
  const db = createDb();
  if (!db) throw new Error("DATABASE_URL not set; no history to delete.");
  await ensureSchema(db, migrationsFolder(process.env));
  const record = await getHistoryById(db, args.id);
  if (!record) throw new Error(`History entry ${args.id} not found.`);
  await deleteHistoryEntry(db, args.id);
  return { sourceFileName: record.sourceFileName };
}

// Renaming (2026-09-30, user-requested): sets a custom display title,
// separate from sourceFileName (see schema.ts's comment on why -- that
// column is also the real path trash_audio/delete_history_entry use).
// args.title of "" is normalized to null here (not left for the DB layer
// to special-case) -- an intentionally-cleared title and a never-set one
// should be indistinguishable, both falling back to the filename in the
// GUI.
export async function handleUpdateHistoryTitle(
  args: { id: number; title: string },
  deps: SidecarDeps = {},
): Promise<{ id: number; title: string | null }> {
  const title = args.title.trim().length > 0 ? args.title.trim() : null;
  const record = deps.updateHistoryTitle
    ? await deps.updateHistoryTitle(args.id, title)
    : await (async () => {
        const db = createDb();
        if (!db) throw new Error("DATABASE_URL not set; cannot rename a history entry.");
        await ensureSchema(db, migrationsFolder(process.env));
        return updateTranscriptionTitle(db, args.id, title);
      })();
  if (!record) throw new Error(`History entry ${args.id} not found.`);
  return record;
}

// Custom dictionary CRUD + import -- same inject-first-else-createDb()
// pattern as the history handlers above. Reads return [] with no DB (never
// throw); writes throw a clear error when there's no DB to write to.
export async function handleListDictionary(deps: SidecarDeps = {}): Promise<DictionaryRecord[]> {
  if (deps.listDictionary) return deps.listDictionary();
  const db = createDb();
  if (!db) return [];
  await ensureSchema(db, migrationsFolder(process.env));
  return listDictionary(db);
}

export async function handleAddDictionaryEntry(
  args: DictionaryEntry,
  deps: SidecarDeps = {},
): Promise<DictionaryRecord> {
  if (deps.addDictionaryEntry) return deps.addDictionaryEntry(args);
  const db = createDb();
  if (!db) throw new Error("DATABASE_URL not set; cannot add a dictionary entry.");
  await ensureSchema(db, migrationsFolder(process.env));
  return addDictionaryEntry(db, args);
}

export async function handleUpdateDictionaryEntry(
  args: { id: number } & DictionaryEntry,
  deps: SidecarDeps = {},
): Promise<DictionaryRecord> {
  const { id, ...entry } = args;
  const record = deps.updateDictionaryEntry
    ? await deps.updateDictionaryEntry(id, entry)
    : await (async () => {
        const db = createDb();
        if (!db) throw new Error("DATABASE_URL not set; cannot update a dictionary entry.");
        await ensureSchema(db, migrationsFolder(process.env));
        return updateDictionaryEntry(db, id, entry);
      })();
  if (!record) throw new Error(`Dictionary entry ${id} not found.`);
  return record;
}

export async function handleDeleteDictionaryEntry(
  args: { id: number },
  deps: SidecarDeps = {},
): Promise<{ id: number }> {
  if (deps.deleteDictionaryEntry) {
    await deps.deleteDictionaryEntry(args.id);
    return { id: args.id };
  }
  const db = createDb();
  if (!db) throw new Error("DATABASE_URL not set; cannot delete a dictionary entry.");
  await ensureSchema(db, migrationsFolder(process.env));
  await deleteDictionaryEntry(db, args.id);
  return { id: args.id };
}

// Transcript notes (annotations) -- same inject-first-else-createDb()
// pattern as the dictionary CRUD above. Reads return [] with no DB (never
// throw, mirroring handleListDictionary); writes throw a clear error when
// there's no DB to write to, same as the dictionary writes.
export async function handleListNotes(
  args: { transcriptionId: number },
  deps: SidecarDeps = {},
): Promise<TranscriptNoteRecord[]> {
  if (deps.listNotes) return deps.listNotes(args.transcriptionId);
  const db = createDb();
  if (!db) return [];
  await ensureSchema(db, migrationsFolder(process.env));
  return listNotes(db, args.transcriptionId);
}

export async function handleAddNote(
  args: NewTranscriptNote,
  deps: SidecarDeps = {},
): Promise<TranscriptNoteRecord> {
  if (args.startOffset < 0 || args.endOffset <= args.startOffset) {
    throw new Error(`Invalid note range [${args.startOffset}, ${args.endOffset}).`);
  }
  if (deps.addNote) return deps.addNote(args);
  const db = createDb();
  if (!db) throw new Error("DATABASE_URL not set; cannot add a note.");
  await ensureSchema(db, migrationsFolder(process.env));
  return addNote(db, args);
}

export async function handleUpdateNote(
  args: { id: number; note: string },
  deps: SidecarDeps = {},
): Promise<TranscriptNoteRecord> {
  const record = deps.updateNote
    ? await deps.updateNote(args.id, args.note)
    : await (async () => {
        const db = createDb();
        if (!db) throw new Error("DATABASE_URL not set; cannot update a note.");
        await ensureSchema(db, migrationsFolder(process.env));
        return updateNote(db, args.id, args.note);
      })();
  if (!record) throw new Error(`Note ${args.id} not found.`);
  return record;
}

export async function handleDeleteNote(
  args: { id: number },
  deps: SidecarDeps = {},
): Promise<{ id: number }> {
  if (deps.deleteNote) {
    await deps.deleteNote(args.id);
    return { id: args.id };
  }
  const db = createDb();
  if (!db) throw new Error("DATABASE_URL not set; cannot delete a note.");
  await ensureSchema(db, migrationsFolder(process.env));
  await deleteNote(db, args.id);
  return { id: args.id };
}

// Parses argv[3] as raw JSON text (Rust reads a user-picked file and hands
// its contents straight through -- see commands.rs's import_dictionary_file)
// and upserts by word. Accepts both an Amical export and this app's own
// plain [{ word, replacement }] shape (parseDictionaryImport above).
export async function handleImportDictionary(
  args: { json: string },
  deps: SidecarDeps = {},
): Promise<ImportResult> {
  const { entries, skipped } = parseDictionaryImport(args.json);
  const result = deps.importDictionary
    ? await deps.importDictionary(entries)
    : await (async () => {
        const db = createDb();
        if (!db) throw new Error("DATABASE_URL not set; cannot import a dictionary.");
        await ensureSchema(db, migrationsFolder(process.env));
        return importDictionaryEntries(db, entries);
      })();
  return { ...result, skipped: result.skipped + skipped };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const command = argv[2];
  const argJson = argv[3];

  try {
    let data: unknown;
    switch (command) {
      case "ping":
        data = await handlePing();
        break;
      case "transcribe": {
        const args = JSON.parse(argJson ?? "{}") as TranscribeArgs;
        data = await handleTranscribe(args);
        break;
      }
      case "list-history":
        data = await handleListHistory();
        break;
      case "get-history": {
        const args = JSON.parse(argJson ?? "{}") as { id: number };
        data = await handleGetHistory(args);
        break;
      }
      case "search-history": {
        const args = JSON.parse(argJson ?? "{}") as { query: string };
        data = await handleSearchHistory(args);
        break;
      }
      case "delete-history-entry": {
        const args = JSON.parse(argJson ?? "{}") as { id: number };
        data = await handleDeleteHistoryEntry(args);
        break;
      }
      case "update-history-title": {
        const args = JSON.parse(argJson ?? "{}") as { id: number; title: string };
        data = await handleUpdateHistoryTitle(args);
        break;
      }
      case "list-dictionary":
        data = await handleListDictionary();
        break;
      case "add-dictionary-entry": {
        const args = JSON.parse(argJson ?? "{}") as DictionaryEntry;
        data = await handleAddDictionaryEntry(args);
        break;
      }
      case "update-dictionary-entry": {
        const args = JSON.parse(argJson ?? "{}") as { id: number } & DictionaryEntry;
        data = await handleUpdateDictionaryEntry(args);
        break;
      }
      case "delete-dictionary-entry": {
        const args = JSON.parse(argJson ?? "{}") as { id: number };
        data = await handleDeleteDictionaryEntry(args);
        break;
      }
      case "import-dictionary": {
        const args = JSON.parse(argJson ?? "{}") as { json: string };
        data = await handleImportDictionary(args);
        break;
      }
      case "list-notes": {
        const args = JSON.parse(argJson ?? "{}") as { transcriptionId: number };
        data = await handleListNotes(args);
        break;
      }
      case "add-note": {
        const args = JSON.parse(argJson ?? "{}") as NewTranscriptNote;
        data = await handleAddNote(args);
        break;
      }
      case "update-note": {
        const args = JSON.parse(argJson ?? "{}") as { id: number; note: string };
        data = await handleUpdateNote(args);
        break;
      }
      case "delete-note": {
        const args = JSON.parse(argJson ?? "{}") as { id: number };
        data = await handleDeleteNote(args);
        break;
      }
      case "test-connection":
        data = await handleTestConnection();
        break;
      default:
        throw new Error(`Unknown sidecar command "${String(command)}"`);
    }
    process.stdout.write(`${JSON.stringify({ ok: true, data })}\n`);
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage(err) })}\n`);
  }
}


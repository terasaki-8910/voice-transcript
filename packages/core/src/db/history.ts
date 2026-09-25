import { eq, desc, count } from "drizzle-orm";
import { transcriptions, transcriptNotes } from "./schema.js";
import { ensureSchema } from "./migrate.js";
import type { Db } from "./client.js";
import type { Segment, TranscriptResult } from "../types.js";

// Every column of `transcriptions`, spelled out (rather than `.select()`'s
// select-everything shorthand) because a leftJoin + count() aggregate
// alongside it needs an explicit column list either way -- kept as one
// constant so listHistory/getHistoryById can't drift apart on which columns
// they return.
const HISTORY_COLUMNS = {
  id: transcriptions.id,
  sourceFileName: transcriptions.sourceFileName,
  startedAt: transcriptions.startedAt,
  model: transcriptions.model,
  language: transcriptions.language,
  formats: transcriptions.formats,
  status: transcriptions.status,
  transcriptText: transcriptions.transcriptText,
  segments: transcriptions.segments,
  noteCount: count(transcriptNotes.id),
};

export interface HistoryRecordInput {
  sourceFileName: string;
  model: string;
  language?: string;
  formats: string[];
  status: "success" | "failed";
  result?: TranscriptResult;
}

export interface HistoryRecord {
  id: number;
  sourceFileName: string;
  startedAt: Date;
  model: string;
  language: string | null;
  formats: string[];
  status: "success" | "failed";
  transcriptText: string | null;
  segments: Segment[] | null;
  // How many transcript notes (db/notes.ts) point at this row -- computed
  // alongside the row itself (one leftJoin+count, not a separate query per
  // row) so the GUI can decide whether a row has anything worth fetching
  // full note bodies for without spawning a sidecar call per row to find
  // out (see useTranscriptNotes' knownNoteCount param on the desktop side).
  noteCount: number;
}

// ACCEPTANCE H1: persist one record per completed run. Returns the new
// row's id -- transcript notes (db/notes.ts) anchor to it, so the GUI needs
// it back the moment a transcription finishes, not only once the entry
// later shows up in a listHistory() call.
export async function recordHistory(db: Db, input: HistoryRecordInput): Promise<number> {
  const [row] = await db
    .insert(transcriptions)
    .values({
      sourceFileName: input.sourceFileName,
      model: input.model,
      language: input.language,
      formats: input.formats,
      status: input.status,
      transcriptText: input.result?.text ?? null,
      segments: input.result?.segments ?? null,
    })
    .returning({ id: transcriptions.id });
  return row.id;
}

// ACCEPTANCE H5: if the DB is unset or unreachable, the write fails loudly
// (logged) and never throws -- the caller's transcription result is never
// blocked or corrupted by a history-write failure. ensureSchema() runs
// first (also inside this try/catch) so a freshly-configured, empty
// database gets its tables created automatically instead of every write
// failing with "relation does not exist" until someone runs the migration
// by hand. Returns undefined (not just on failure, but also whenever there
// is no DB to write to) -- callers use this as the signal for "notes
// aren't available for this transcription," not as an error.
export async function recordHistorySafe(
  db: Db | undefined,
  input: HistoryRecordInput,
  migrationsFolder: string | undefined,
): Promise<number | undefined> {
  if (!db) {
    console.error("[history] DATABASE_URL not set; history not recorded");
    return undefined;
  }
  try {
    await ensureSchema(db, migrationsFolder);
    return await recordHistory(db, input);
  } catch (err) {
    console.error("[history] failed to record history (non-blocking):", err);
    return undefined;
  }
}

// ACCEPTANCE H2: list past runs, newest first.
export async function listHistory(db: Db, limit = 50): Promise<HistoryRecord[]> {
  return db
    .select(HISTORY_COLUMNS)
    .from(transcriptions)
    .leftJoin(transcriptNotes, eq(transcriptNotes.transcriptionId, transcriptions.id))
    .groupBy(transcriptions.id)
    .orderBy(desc(transcriptions.startedAt))
    .limit(limit);
}

// ACCEPTANCE H2: open a past run and read its stored transcript -- no
// transcriber call involved.
export async function getHistoryById(db: Db, id: number): Promise<HistoryRecord | undefined> {
  const rows = await db
    .select(HISTORY_COLUMNS)
    .from(transcriptions)
    .leftJoin(transcriptNotes, eq(transcriptNotes.transcriptionId, transcriptions.id))
    .where(eq(transcriptions.id, id))
    .groupBy(transcriptions.id)
    .limit(1);
  return rows[0];
}

// ACCEPTANCE G9: remove a history record entirely. A no-op (not an error)
// if the id no longer exists -- callers that need to know whether a record
// existed should look it up first (e.g. to read sourceFileName before
// deleting, so the caller can also trash the audio file).
export async function deleteHistoryEntry(db: Db, id: number): Promise<void> {
  await db.delete(transcriptions).where(eq(transcriptions.id, id));
}

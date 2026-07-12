import { eq, desc } from "drizzle-orm";
import { transcriptions } from "./schema.js";
import type { Db } from "./client.js";
import type { Segment, TranscriptResult } from "../types.js";

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
}

// ACCEPTANCE H1: persist one record per completed run.
export async function recordHistory(db: Db, input: HistoryRecordInput): Promise<void> {
  await db.insert(transcriptions).values({
    sourceFileName: input.sourceFileName,
    model: input.model,
    language: input.language,
    formats: input.formats,
    status: input.status,
    transcriptText: input.result?.text ?? null,
    segments: input.result?.segments ?? null,
  });
}

// ACCEPTANCE H5: if the DB is unset or unreachable, the write fails loudly
// (logged) and never throws -- the caller's transcription result is never
// blocked or corrupted by a history-write failure.
export async function recordHistorySafe(db: Db | undefined, input: HistoryRecordInput): Promise<void> {
  if (!db) {
    console.error("[history] DATABASE_URL not set; history not recorded");
    return;
  }
  try {
    await recordHistory(db, input);
  } catch (err) {
    console.error("[history] failed to record history (non-blocking):", err);
  }
}

// ACCEPTANCE H2: list past runs, newest first.
export async function listHistory(db: Db, limit = 50): Promise<HistoryRecord[]> {
  return db.select().from(transcriptions).orderBy(desc(transcriptions.startedAt)).limit(limit);
}

// ACCEPTANCE H2: open a past run and read its stored transcript -- no
// transcriber call involved.
export async function getHistoryById(db: Db, id: number): Promise<HistoryRecord | undefined> {
  const rows = await db.select().from(transcriptions).where(eq(transcriptions.id, id)).limit(1);
  return rows[0];
}

// ACCEPTANCE G9: remove a history record entirely. A no-op (not an error)
// if the id no longer exists -- callers that need to know whether a record
// existed should look it up first (e.g. to read sourceFileName before
// deleting, so the caller can also trash the audio file).
export async function deleteHistoryEntry(db: Db, id: number): Promise<void> {
  await db.delete(transcriptions).where(eq(transcriptions.id, id));
}

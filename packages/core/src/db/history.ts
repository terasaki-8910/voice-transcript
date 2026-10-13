import { eq, desc, count, ilike, or, and, exists, inArray } from "drizzle-orm";
import { transcriptions, transcriptNotes } from "./schema.js";
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
  title: transcriptions.title,
  noteCount: count(transcriptNotes.id),
};

export interface HistoryRecordInput {
  sourceFileName: string;
  model: string;
  language?: string;
  formats: string[];
  status: "success" | "failed";
  result?: TranscriptResult;
  // When the run actually happened. Omitted for a normal write (the DB
  // defaults to now()); set for a deferred write (db/pending.ts) so the
  // entry sorts at the time it ran, not at the time the outbox was flushed.
  startedAt?: Date;
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
  // User-editable display name (2026-09-30, user-requested) -- null until
  // set, in which case the GUI falls back to basename(sourceFileName). See
  // schema.ts's own comment on why this is a separate column from
  // sourceFileName rather than editing that in place.
  title: string | null;
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
      ...(input.startedAt ? { startedAt: input.startedAt } : {}),
      transcriptText: input.result?.text ?? null,
      segments: input.result?.segments ?? null,
    })
    .returning({ id: transcriptions.id });
  return row.id;
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

export interface HistorySearchResult {
  id: number;
  sourceFileName: string;
  startedAt: Date;
  transcriptText: string | null;
  title: string | null;
  // Notes (if any) belonging to this transcription that themselves match
  // at least one search term -- surfaced so a note-only match (neither the
  // title nor the body contains the term at all) is still explainable in
  // the results list, not just a bare filename with no visible reason.
  matchedNotes: { quotedText: string; note: string }[];
}

// Search (SPEC.md > Search): title, transcript body, and note text all at
// once, space-separated terms ANDed together (every term must match
// somewhere; which field can differ per term) -- terms are ORed across the
// four fields (2026-09-30: title joined the other three once a custom
// title became something worth searching by), note-matching via an EXISTS
// subquery rather than a leftJoin so a transcription with several notes
// still produces exactly one result row, not one per matching note.
// Case-insensitive (ilike), consistent with the existing inline sidebar
// filter's toLowerCase() substring match. Unlike that filter, this queries
// the whole table, not just the already-loaded page -- history entries
// past listHistory()'s own limit are otherwise unreachable by search.
export async function searchHistory(db: Db, terms: string[], limit = 50): Promise<HistorySearchResult[]> {
  const cleaned = terms.map((t) => t.trim()).filter((t) => t.length > 0);
  if (cleaned.length === 0) return [];

  const matchesTerm = (term: string) => {
    const pattern = `%${term}%`;
    return or(
      ilike(transcriptions.sourceFileName, pattern),
      ilike(transcriptions.title, pattern),
      ilike(transcriptions.transcriptText, pattern),
      exists(
        db
          .select({ id: transcriptNotes.id })
          .from(transcriptNotes)
          .where(
            and(
              eq(transcriptNotes.transcriptionId, transcriptions.id),
              or(ilike(transcriptNotes.quotedText, pattern), ilike(transcriptNotes.note, pattern)),
            ),
          ),
      ),
    );
  };

  const rows = await db
    .select({
      id: transcriptions.id,
      sourceFileName: transcriptions.sourceFileName,
      startedAt: transcriptions.startedAt,
      transcriptText: transcriptions.transcriptText,
      title: transcriptions.title,
    })
    .from(transcriptions)
    .where(and(...cleaned.map(matchesTerm)))
    .orderBy(desc(transcriptions.startedAt))
    .limit(limit);

  if (rows.length === 0) return [];

  // Second pass: which of THOSE transcriptions' own notes explain the
  // match -- a note matching any one term is relevant to show, even if
  // the transcription as a whole matched via a different term elsewhere.
  const ids = rows.map((r) => r.id);
  const matchingNotes = await db
    .select({
      transcriptionId: transcriptNotes.transcriptionId,
      quotedText: transcriptNotes.quotedText,
      note: transcriptNotes.note,
    })
    .from(transcriptNotes)
    .where(
      and(
        inArray(transcriptNotes.transcriptionId, ids),
        or(...cleaned.map((term) => or(ilike(transcriptNotes.quotedText, `%${term}%`), ilike(transcriptNotes.note, `%${term}%`)))),
      ),
    );

  const notesByTranscription = new Map<number, { quotedText: string; note: string }[]>();
  for (const n of matchingNotes) {
    const list = notesByTranscription.get(n.transcriptionId) ?? [];
    list.push({ quotedText: n.quotedText, note: n.note });
    notesByTranscription.set(n.transcriptionId, list);
  }

  return rows.map((r) => ({ ...r, matchedNotes: notesByTranscription.get(r.id) ?? [] }));
}

// Renaming (2026-09-30, user-requested). A no-op-ish "not found" (undefined,
// not an error) if the id no longer exists -- same convention as
// updateDictionaryEntry. Passing null clears a previously-set title, back
// to falling through to basename(sourceFileName) in the GUI -- not
// treated as an error/no-op, since "give this back its default name" is a
// legitimate, deliberate action.
export async function updateTranscriptionTitle(
  db: Db,
  id: number,
  title: string | null,
): Promise<{ id: number; title: string | null } | undefined> {
  const [row] = await db
    .update(transcriptions)
    .set({ title })
    .where(eq(transcriptions.id, id))
    .returning({ id: transcriptions.id, title: transcriptions.title });
  return row;
}

// ACCEPTANCE G9: remove a history record entirely. A no-op (not an error)
// if the id no longer exists -- callers that need to know whether a record
// existed should look it up first (e.g. to read sourceFileName before
// deleting, so the caller can also trash the audio file).
export async function deleteHistoryEntry(db: Db, id: number): Promise<void> {
  await db.delete(transcriptions).where(eq(transcriptions.id, id));
}

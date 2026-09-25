import { eq, asc } from "drizzle-orm";
import { transcriptNotes } from "./schema.js";
import type { Db } from "./client.js";

export interface TranscriptNoteRecord {
  id: number;
  transcriptionId: number;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  note: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewTranscriptNote {
  transcriptionId: number;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  note: string;
}

// Reading order, not creation order: a transcript with several notes reads
// top-to-bottom the same way the transcript itself does.
export async function listNotes(db: Db, transcriptionId: number): Promise<TranscriptNoteRecord[]> {
  return db
    .select()
    .from(transcriptNotes)
    .where(eq(transcriptNotes.transcriptionId, transcriptionId))
    .orderBy(asc(transcriptNotes.startOffset));
}

export async function addNote(db: Db, input: NewTranscriptNote): Promise<TranscriptNoteRecord> {
  const [row] = await db.insert(transcriptNotes).values(input).returning();
  return row;
}

// Only the note's own text is updatable -- startOffset/endOffset/quotedText
// are the anchor and never change after creation (see schema.ts's comment
// on transcriptNotes).
export async function updateNote(db: Db, id: number, note: string): Promise<TranscriptNoteRecord | undefined> {
  const [row] = await db
    .update(transcriptNotes)
    .set({ note, updatedAt: new Date() })
    .where(eq(transcriptNotes.id, id))
    .returning();
  return row;
}

// A no-op (not an error) if the id no longer exists -- same convention as
// deleteDictionaryEntry/deleteHistoryEntry.
export async function deleteNote(db: Db, id: number): Promise<void> {
  await db.delete(transcriptNotes).where(eq(transcriptNotes.id, id));
}

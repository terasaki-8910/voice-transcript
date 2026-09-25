// Transcript notes (SPEC.md > Transcript notes). One hook instance per row
// (HistoryRow/QueueRow each call this once and hand the result to both
// AnnotatedTranscript and their own copy-with-notes button) -- there's no
// cross-row sharing to justify a Context, unlike e.g.
// VoiceInputSettingsContext's genuinely global setting.
import { useEffect, useState } from "react";
import { listNotes, addNote, updateNote, deleteNote } from "../../lib/tauri";
import type { TranscriptNote } from "../../lib/tauri";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface UseTranscriptNotes {
  notes: TranscriptNote[];
  loadError?: string;
  // Throws (caller displays inline, same convention as
  // DictionarySection's addError/editError) on a range that overlaps an
  // existing note, or on any backend failure.
  add: (startOffset: number, endOffset: number, quotedText: string, note: string) => Promise<void>;
  update: (id: number, note: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

// transcriptionId is undefined whenever this row's transcription never got
// a DB id (no DATABASE_URL configured, or the history write itself failed
// -- see TranscribeResponse's `id` comment in lib/tauri.ts): the hook then
// reports an always-empty, read-only note list rather than erroring, so a
// row can render normally with notes simply unavailable.
//
// knownNoteCount, when passed as exactly 0, skips the initial listNotes()
// fetch entirely -- HistoryRow gets this from listHistory()'s own bulk
// noteCount (a single join+count alongside the rows it was already
// fetching), and QueueRow can pass 0 unconditionally: a queue item's
// transcriptionId is always a row `transcribe` only just inserted, so it
// provably has zero notes yet. Without this, every rendered row -- the
// common case has none -- would spawn its own sidecar subprocess (this
// app's IPC has no persistent connection; every command is a fresh Node
// process, see commands.rs's call_sidecar) just to learn that. Once a note
// is actually added, local state takes over and this stale count is never
// consulted again.
export function useTranscriptNotes(transcriptionId: number | undefined, knownNoteCount?: number): UseTranscriptNotes {
  const [notes, setNotes] = useState<TranscriptNote[]>([]);
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    if (transcriptionId === undefined || knownNoteCount === 0) {
      setNotes([]);
      return;
    }
    listNotes(transcriptionId)
      .then(setNotes)
      .catch((err: unknown) => setLoadError(errorMessage(err)));
  }, [transcriptionId, knownNoteCount]);

  const add = async (startOffset: number, endOffset: number, quotedText: string, note: string) => {
    if (transcriptionId === undefined) {
      throw new Error("This transcript has no saved history entry yet, so it can't take notes.");
    }
    if (notes.some((n) => rangesOverlap(startOffset, endOffset, n.startOffset, n.endOffset))) {
      throw new Error("This range overlaps an existing note.");
    }
    const created = await addNote(transcriptionId, startOffset, endOffset, quotedText, note);
    setNotes((prev) => [...prev, created].sort((a, b) => a.startOffset - b.startOffset));
  };

  const update = async (id: number, note: string) => {
    const updated = await updateNote(id, note);
    setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
  };

  const remove = async (id: number) => {
    await deleteNote(id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
  };

  return { notes, loadError, add, update, remove };
}

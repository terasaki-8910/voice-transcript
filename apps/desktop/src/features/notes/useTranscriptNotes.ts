// Transcript notes (SPEC.md > Transcript notes). One hook instance per row
// (HistoryRow/QueueRow each call this once and hand the result to both
// AnnotatedTranscript and their own copy-with-notes button) -- there's no
// cross-row sharing to justify a Context, unlike e.g.
// VoiceInputSettingsContext's genuinely global setting.
//
// Optimistic (2026-09-29, user-reported): add/update/remove apply to local
// state immediately and the sidecar round trip happens in the background
// -- see SPEC.md's "Transcript notes" section for why. A background
// failure leaves the note visible with a recorded NoteFailure rather than
// silently reverting or blocking further interaction; AnnotatedTranscript
// renders that as a distinct "unsaved" state with retry()/discard()
// actions.
import { useEffect, useRef, useState } from "react";
import { listNotes, addNote, updateNote, deleteNote } from "../../lib/tauri";
import type { TranscriptNote } from "../../lib/tauri";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export type NoteFailure =
  | {
      action: "add";
      error: string;
      args: { startOffset: number; endOffset: number; quotedText: string; note: string };
    }
  | { action: "update"; error: string; previousNote: string; attemptedNote: string }
  | { action: "delete"; error: string; snapshot: TranscriptNote };

export interface UseTranscriptNotes {
  notes: TranscriptNote[];
  loadError?: string;
  failures: Map<number, NoteFailure>;
  // Applies immediately to local state; the sidecar write happens in the
  // background (see module comment). Still throws SYNCHRONOUSLY -- and
  // does NOT apply -- for a range that overlaps an existing note: that's a
  // real, immediate validation failure, not something retry/discard is
  // for, so the caller (AnnotatedTranscript) keeps showing it inline
  // exactly as before optimism.
  add: (startOffset: number, endOffset: number, quotedText: string, note: string) => void;
  update: (id: number, note: string) => void;
  remove: (id: number) => void;
  // Re-runs the action a note's current NoteFailure came from. No-op if
  // the note has no failure.
  retry: (id: number) => void;
  // Reverts a failed action instead of retrying it: undoes an unsaved add
  // (removes the note), an unsaved edit (restores the previous text), or
  // an unsaved delete (keeps the note -- "discard the delete attempt").
  // No-op if the note has no failure.
  discard: (id: number) => void;
}

// transcriptionId is undefined whenever this row's transcription never got
// a DB id (no database connection configured, or the history write itself
// failed -- see TranscribeResponse's `id` comment in lib/tauri.ts): the
// hook then reports an always-empty, read-only note list rather than
// erroring, so a row can render normally with notes simply unavailable.
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
  const [failures, setFailures] = useState<Map<number, NoteFailure>>(new Map());
  // Temp ids for an optimistically-added note, always negative -- real DB
  // ids are serial and always positive, so the two can never collide.
  const nextTempId = useRef(0);

  useEffect(() => {
    if (transcriptionId === undefined || knownNoteCount === 0) {
      setNotes([]);
      return;
    }
    listNotes(transcriptionId)
      .then(setNotes)
      .catch((err: unknown) => setLoadError(errorMessage(err)));
  }, [transcriptionId, knownNoteCount]);

  const clearFailure = (id: number) => {
    setFailures((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const setFailure = (id: number, failure: NoteFailure) => {
    setFailures((prev) => new Map(prev).set(id, failure));
  };

  const runAdd = (tempId: number, args: { startOffset: number; endOffset: number; quotedText: string; note: string }) => {
    if (transcriptionId === undefined) return;
    addNote(transcriptionId, args.startOffset, args.endOffset, args.quotedText, args.note)
      .then((created) => {
        setNotes((prev) => prev.map((n) => (n.id === tempId ? created : n)).sort((a, b) => a.startOffset - b.startOffset));
        clearFailure(tempId);
      })
      .catch((err: unknown) => setFailure(tempId, { action: "add", error: errorMessage(err), args }));
  };

  const add = (startOffset: number, endOffset: number, quotedText: string, note: string) => {
    if (transcriptionId === undefined) {
      throw new Error("This transcript has no saved history entry yet, so it can't take notes.");
    }
    if (notes.some((n) => rangesOverlap(startOffset, endOffset, n.startOffset, n.endOffset))) {
      throw new Error("This range overlaps an existing note.");
    }
    const tempId = --nextTempId.current;
    const optimistic: TranscriptNote = {
      id: tempId,
      transcriptionId,
      startOffset,
      endOffset,
      quotedText,
      note,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setNotes((prev) => [...prev, optimistic].sort((a, b) => a.startOffset - b.startOffset));
    runAdd(tempId, { startOffset, endOffset, quotedText, note });
  };

  const runUpdate = (id: number, note: string, previousNote: string) => {
    updateNote(id, note)
      .then((updated) => {
        setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
        clearFailure(id);
      })
      .catch((err: unknown) => setFailure(id, { action: "update", error: errorMessage(err), previousNote, attemptedNote: note }));
  };

  const update = (id: number, note: string) => {
    const previousNote = notes.find((n) => n.id === id)?.note ?? "";
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, note } : n)));
    clearFailure(id);
    runUpdate(id, note, previousNote);
  };

  const runRemove = (snapshot: TranscriptNote) => {
    deleteNote(snapshot.id).catch((err: unknown) => {
      setNotes((prev) => [...prev, snapshot].sort((a, b) => a.startOffset - b.startOffset));
      setFailure(snapshot.id, { action: "delete", error: errorMessage(err), snapshot });
    });
  };

  const remove = (id: number) => {
    const snapshot = notes.find((n) => n.id === id);
    if (!snapshot) return;
    setNotes((prev) => prev.filter((n) => n.id !== id));
    clearFailure(id);
    runRemove(snapshot);
  };

  const retry = (id: number) => {
    const failure = failures.get(id);
    if (!failure) return;
    clearFailure(id);
    if (failure.action === "add") {
      runAdd(id, failure.args);
    } else if (failure.action === "update") {
      runUpdate(id, failure.attemptedNote, failure.previousNote);
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== id));
      runRemove(failure.snapshot);
    }
  };

  const discard = (id: number) => {
    const failure = failures.get(id);
    if (!failure) return;
    clearFailure(id);
    if (failure.action === "add") {
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } else if (failure.action === "update") {
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, note: failure.previousNote } : n)));
    }
    // A discarded delete-failure needs no further change: the note is
    // already sitting in `notes` (re-inserted when the delete failed).
  };

  return { notes, loadError, failures, add, update, remove, retry, discard };
}

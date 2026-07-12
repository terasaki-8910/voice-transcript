// F18 (gui-history). Loads the DB-backed history list on mount and exposes
// the two distinct delete actions the design gate confirmed: trashAudio
// (G7 -- removes only the source audio, keeps the record) and remove (G9 --
// deletes the record, and trashes the audio too if it's still there).
// trashedIds is local-only UI state (not persisted): once trashed in this
// session, the "Trash audio" action is disabled for that row instead of
// silently no-op'ing on a second click.
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { listHistory, trashAudio, deleteHistoryEntry } from "../../lib/tauri";
import type { HistoryEntry, TrashResult } from "../../lib/tauri";

export type HistoryStatus = "loading" | "ready" | "error";

interface HistoryContextValue {
  items: HistoryEntry[];
  status: HistoryStatus;
  error?: string;
  trashedIds: Set<number>;
  // Per-row failures from trash()/remove() -- kept separate from the
  // whole-list `error` above, which is only for a failed initial load.
  actionErrors: Map<number, string>;
  refresh: () => void;
  trash: (id: number) => Promise<void>;
  remove: (id: number) => Promise<void>;
  // Lets a row surface a failure that happens BEFORE trash()/remove() is
  // even called (e.g. the confirm() dialog itself throwing) through the
  // same per-row error slot, instead of that becoming an unhandled
  // rejection with no visible feedback.
  reportActionError: (id: number, message: string) => void;
}

const HistoryContext = createContext<HistoryContextValue | null>(null);

export interface HistoryProviderProps {
  children: ReactNode;
  // Injectable for tests -- defaults to the real Tauri-backed functions.
  listHistoryFn?: () => Promise<HistoryEntry[]>;
  trashAudioFn?: (id: number) => Promise<TrashResult>;
  deleteHistoryEntryFn?: (id: number) => Promise<TrashResult>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function HistoryProvider({
  children,
  listHistoryFn = listHistory,
  trashAudioFn = trashAudio,
  deleteHistoryEntryFn = deleteHistoryEntry,
}: HistoryProviderProps) {
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [status, setStatus] = useState<HistoryStatus>("loading");
  const [error, setError] = useState<string>();
  const [trashedIds, setTrashedIds] = useState<Set<number>>(new Set());
  const [actionErrors, setActionErrors] = useState<Map<number, string>>(new Map());

  const refresh = () => {
    setStatus("loading");
    listHistoryFn()
      .then((rows) => {
        setItems(rows);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        setError(errorMessage(err));
        setStatus("error");
      });
  };

  useEffect(refresh, [listHistoryFn]);

  const clearActionError = (id: number) => {
    setActionErrors((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const trash = async (id: number) => {
    try {
      const result = await trashAudioFn(id);
      if (result.trashed) {
        setTrashedIds((prev) => new Set(prev).add(id));
      }
      clearActionError(id);
    } catch (err) {
      setActionErrors((prev) => new Map(prev).set(id, errorMessage(err)));
    }
  };

  const remove = async (id: number) => {
    try {
      await deleteHistoryEntryFn(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      clearActionError(id);
    } catch (err) {
      setActionErrors((prev) => new Map(prev).set(id, errorMessage(err)));
    }
  };

  const reportActionError = (id: number, message: string) => {
    setActionErrors((prev) => new Map(prev).set(id, message));
  };

  return (
    <HistoryContext.Provider
      value={{ items, status, error, trashedIds, actionErrors, refresh, trash, remove, reportActionError }}
    >
      {children}
    </HistoryContext.Provider>
  );
}

export function useHistory(): HistoryContextValue {
  const ctx = useContext(HistoryContext);
  if (!ctx) {
    throw new Error("useHistory must be used within a HistoryProvider");
  }
  return ctx;
}

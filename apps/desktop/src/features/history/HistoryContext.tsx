// F18 (gui-history). Loads the DB-backed history list on mount and exposes
// the two distinct delete actions the design gate confirmed: trashAudio
// (G7 -- removes only the source audio, keeps the record) and remove (G9 --
// deletes the record, and trashes the audio too if it's still there).
// trashedIds is local-only UI state (not persisted): once trashed in this
// session, the "Trash audio" action is disabled for that row instead of
// silently no-op'ing on a second click.
//
// Local cache + stale-while-revalidate (2026-07-14, real usage feedback):
// the DB lives on a remote self-hosted server (Tailscale/LAN) -- every
// History open/refresh used to block on that round-trip synchronously, and
// a transient network hiccup (confirmed against the real server: a Tailscale
// timeout, not a DB or schema problem) dumped a raw SQL error over the
// whole view even though a perfectly good previous list was already known.
// Now: the last-fetched list is cached in localStorage and shown instantly
// on mount; refresh() always fetches in the background afterward, and only
// replaces what's on screen with a blocking error when there is truly
// nothing cached to fall back to. A failed background refresh with cached
// data present instead sets `syncError` (non-blocking, small indicator),
// leaving the visible list untouched.
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { listHistory, trashAudio, deleteHistoryEntry } from "../../lib/tauri";
import type { HistoryEntry, TrashResult } from "../../lib/tauri";

export type HistoryStatus = "loading" | "ready" | "error";

interface HistoryContextValue {
  items: HistoryEntry[];
  status: HistoryStatus;
  error?: string;
  // Set when a background refresh fails while cached/previous items are
  // still being shown -- distinct from `error` (which only applies when
  // there is nothing else to display). Cleared on the next successful
  // refresh.
  syncError?: string;
  // Sidebar follow-up (2026-07-19): raw `items` above stays unfiltered --
  // trash()/remove() and friends still key off the full list. HistoryView
  // is the one place that reads searchQuery to derive what it renders.
  searchQuery: string;
  setSearchQuery: (query: string) => void;
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

const CACHE_KEY = "voice-transcript-history-cache-v1";

// Never throws -- a cache read/write failure (corrupt JSON, quota exceeded,
// localStorage unavailable) is a pure performance/resilience nicety lost,
// never a reason to break the app.
function loadCache(): HistoryEntry[] | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as (Omit<HistoryEntry, "startedAt"> & { startedAt: string })[];
    return parsed.map((item) => ({ ...item, startedAt: new Date(item.startedAt) }));
  } catch {
    return null;
  }
}

function saveCache(items: HistoryEntry[]): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(items));
  } catch {
    // Quota exceeded or unavailable -- see loadCache's comment.
  }
}

export function HistoryProvider({
  children,
  listHistoryFn = listHistory,
  trashAudioFn = trashAudio,
  deleteHistoryEntryFn = deleteHistoryEntry,
}: HistoryProviderProps) {
  const [items, setItems] = useState<HistoryEntry[]>(() => loadCache() ?? []);
  const [status, setStatus] = useState<HistoryStatus>(() => (items.length > 0 ? "ready" : "loading"));
  const [error, setError] = useState<string>();
  const [syncError, setSyncError] = useState<string>();
  const [searchQuery, setSearchQuery] = useState("");
  const [trashedIds, setTrashedIds] = useState<Set<number>>(new Set());
  const [actionErrors, setActionErrors] = useState<Map<number, string>>(new Map());

  const refresh = () => {
    // Only show the blocking loading state when there's nothing cached to
    // display meanwhile -- a background refresh (initial mount with a warm
    // cache, or triggered by a queue completion) should never blank out an
    // already-showing list while it's in flight.
    setStatus((prev) => (prev === "ready" ? prev : "loading"));
    listHistoryFn()
      .then((rows) => {
        setItems(rows);
        setStatus("ready");
        setError(undefined);
        setSyncError(undefined);
        saveCache(rows);
      })
      .catch((err: unknown) => {
        setItems((prevItems) => {
          if (prevItems.length > 0) {
            setSyncError(errorMessage(err));
          } else {
            setError(errorMessage(err));
            setStatus("error");
          }
          return prevItems;
        });
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
      setItems((prev) => {
        const next = prev.filter((item) => item.id !== id);
        saveCache(next);
        return next;
      });
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
      value={{
        items,
        status,
        error,
        syncError,
        searchQuery,
        setSearchQuery,
        trashedIds,
        actionErrors,
        refresh,
        trash,
        remove,
        reportActionError,
      }}
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

// F17 (gui-queue). Multi-file queue: each file is transcribed
// independently and tracked separately -- one failure does not abort the
// others (ACCEPTANCE G5). Processes exactly one "queued" item at a time
// (processingRef), moving to the next queued item regardless of whether
// the previous one succeeded or failed.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { transcribe } from "../../lib/tauri";
import type { TranscribeRequest, TranscribeResponse } from "../../lib/tauri";

// Mirrors packages/core/src/config.ts's DEFAULT_MODEL -- not imported
// directly to avoid pulling packages/core's runtime code into the webview
// bundle for a single string constant (see lib/tauri.ts's "./types"
// subpath-import comment for the same class of issue with the barrel).
const DEFAULT_MODEL = "whisper-large-v3-turbo";

export type QueueItemStatus = "queued" | "transcribing" | "done" | "failed";

export interface QueueItem {
  id: string;
  filePath: string;
  fileName: string;
  status: QueueItemStatus;
  result?: TranscribeResponse;
  error?: string;
}

interface QueueContextValue {
  items: QueueItem[];
  addFiles: (filePaths: string[]) => void;
  retry: (id: string) => void;
  // Removes a "done"/"failed" item from the queue list only -- a purely
  // client-side dismissal (the source file and, for "done" items, the
  // already-written history record are both untouched; History has its own
  // separate trash/delete actions for those). User testing feedback,
  // 2026-07-14: a queue with no way to clear finished items just grows
  // forever until restart.
  remove: (id: string) => void;
}

const QueueContext = createContext<QueueContextValue | null>(null);

function basename(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface QueueProviderProps {
  children: ReactNode;
  // Injectable for tests -- defaults to the real Tauri-backed transcribe().
  transcribeFn?: (request: TranscribeRequest) => Promise<TranscribeResponse>;
}

export function QueueProvider({ children, transcribeFn = transcribe }: QueueProviderProps) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const processingRef = useRef(false);

  const addFiles = (filePaths: string[]) => {
    setItems((prev) => [
      ...prev,
      ...filePaths.map(
        (filePath): QueueItem => ({
          id: makeId(),
          filePath,
          fileName: basename(filePath),
          status: "queued",
        }),
      ),
    ]);
  };

  const retry = (id: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: "queued", error: undefined, result: undefined } : item)),
    );
  };

  const remove = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  useEffect(() => {
    if (processingRef.current) return;
    const next = items.find((item) => item.status === "queued");
    if (!next) return;

    processingRef.current = true;
    setItems((prev) => prev.map((item) => (item.id === next.id ? { ...item, status: "transcribing" } : item)));

    transcribeFn({ filePath: next.filePath, model: DEFAULT_MODEL, format: "txt" })
      .then((result) => {
        setItems((prev) => prev.map((item) => (item.id === next.id ? { ...item, status: "done", result } : item)));
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setItems((prev) => prev.map((item) => (item.id === next.id ? { ...item, status: "failed", error: message } : item)));
      })
      .finally(() => {
        processingRef.current = false;
      });
  }, [items, transcribeFn]);

  const value = useMemo<QueueContextValue>(() => ({ items, addFiles, retry, remove }), [items]);

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

export function useQueue(): QueueContextValue {
  const ctx = useContext(QueueContext);
  if (!ctx) {
    throw new Error("useQueue must be used within a QueueProvider");
  }
  return ctx;
}

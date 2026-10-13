// F17 (gui-queue). Multi-file queue: each file is transcribed
// independently and tracked separately -- one failure does not abort the
// others (ACCEPTANCE G5). Processes exactly one "queued" item at a time
// (processingRef), moving to the next queued item regardless of whether
// the previous one succeeded or failed.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { onTranscribeProgress, transcribe } from "../../lib/tauri";
import type { TranscribeProgress, TranscribeRequest, TranscribeResponse } from "../../lib/tauri";
import { applyProgressEvent } from "./queueProgress";
import type { QueueProgress } from "./queueProgress";
import { useVoiceInputSettings } from "../preferences/VoiceInputSettingsContext";

export type QueueItemStatus = "queued" | "transcribing" | "done" | "failed";

// Distinct from AudioSource/audioSource (microphone/system/both -- what
// was captured) -- this is about where the FILE came from: the app's own
// recording feature, vs. an upload/drag-drop. Named "origin" rather than
// "source" specifically to avoid colliding in meaning with AudioSource.
// Only "recording" is tagged explicitly; an upload leaves this undefined
// rather than introducing an "upload" value nothing needs to check for.
export type QueueItemOrigin = "recording";

export interface QueueItem {
  id: string;
  filePath: string;
  fileName: string;
  status: QueueItemStatus;
  origin?: QueueItemOrigin;
  result?: TranscribeResponse;
  error?: string;
  // Only while status is "transcribing" -- cleared once it finishes either way.
  progress?: QueueProgress;
}

interface QueueContextValue {
  items: QueueItem[];
  addFiles: (filePaths: string[], origin?: QueueItemOrigin) => void;
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
  // Same, for the progress events that arrive while transcribeFn runs.
  subscribeProgressFn?: (handler: (progress: TranscribeProgress) => void) => Promise<() => void>;
}

export function QueueProvider({
  children,
  transcribeFn = transcribe,
  subscribeProgressFn = onTranscribeProgress,
}: QueueProviderProps) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const processingRef = useRef(false);

  // Attributed by runId (the item id sent with the request), and only to an
  // item still transcribing -- a late event can never repaint a row that
  // has already finished or been retried.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let disposed = false;
    void subscribeProgressFn(({ runId, event }) => {
      setItems((prev) =>
        prev.map((item) =>
          item.id === runId && item.status === "transcribing"
            ? { ...item, progress: applyProgressEvent(item.progress, event) }
            : item,
        ),
      );
    }).then((fn) => {
      if (disposed) fn();
      else unsubscribe = fn;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [subscribeProgressFn]);
  // Settings > Voice input's model/language, instead of a hardcoded default
  // -- ACCEPTANCE G12. autoDetectLanguage stays the default (Groq's
  // language param omitted); toggling it off in Settings sends the chosen
  // override, mirroring packages/cli's --language flag.
  const { model, autoDetectLanguage, language, trimSilence } = useVoiceInputSettings();

  const addFiles = (filePaths: string[], origin?: QueueItemOrigin) => {
    setItems((prev) => [
      ...prev,
      ...filePaths.map(
        (filePath): QueueItem => ({
          id: makeId(),
          filePath,
          fileName: basename(filePath),
          status: "queued",
          origin,
        }),
      ),
    ]);
  };

  const retry = (id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status: "queued", error: undefined, result: undefined, progress: undefined } : item,
      ),
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

    transcribeFn({
      filePath: next.filePath,
      model,
      format: "txt",
      language: autoDetectLanguage ? undefined : language,
      runId: next.id,
      trimSilence,
    })
      .then((result) => {
        setItems((prev) =>
          prev.map((item) => (item.id === next.id ? { ...item, status: "done", result, progress: undefined } : item)),
        );
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setItems((prev) =>
          prev.map((item) =>
            item.id === next.id ? { ...item, status: "failed", error: message, progress: undefined } : item,
          ),
        );
      })
      .finally(() => {
        processingRef.current = false;
      });
  }, [items, transcribeFn, model, autoDetectLanguage, language, trimSilence]);

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

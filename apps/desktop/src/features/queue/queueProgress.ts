// Folds the sidecar's PipelineEvents (packages/core/src/types.ts, forwarded
// by commands.rs as "transcribe-progress") into what a queue row shows while
// it is transcribing. Kept pure so the folding is testable without a
// Tauri runtime; QueueRow owns the wording.
import type { PipelineEvent } from "@voice-transcript/core/types";

export interface QueueProgress {
  total?: number;
  done: number;
  // Set when the audio is longer than Groq's free-tier hourly budget.
  overBudget?: { audioSeconds: number; budgetSeconds: number };
  // Chunks currently sleeping out a rate-limit wait: 1-based chunk -> resumeAt (ISO).
  waits: Record<number, string>;
}

const EMPTY: QueueProgress = { done: 0, waits: {} };

export function applyProgressEvent(prev: QueueProgress | undefined, event: PipelineEvent): QueueProgress {
  const progress = prev ?? EMPTY;
  switch (event.type) {
    case "over-hourly-budget":
      return { ...progress, overBudget: { audioSeconds: event.audioSeconds, budgetSeconds: event.budgetSeconds } };
    case "chunks-planned":
      return { ...progress, total: event.total };
    case "chunk-done": {
      const waits = { ...progress.waits };
      delete waits[event.chunk];
      return { ...progress, total: event.total, done: event.done, waits };
    }
    case "rate-limit-wait":
      return { ...progress, total: event.total, waits: { ...progress.waits, [event.chunk]: event.resumeAt } };
    default:
      return progress;
  }
}

// The latest time any waiting chunk resumes -- the earliest the whole file
// can finish -- or undefined when nothing is waiting.
export function latestResume(progress: QueueProgress): string | undefined {
  const times = Object.values(progress.waits);
  if (times.length === 0) return undefined;
  return times.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
}

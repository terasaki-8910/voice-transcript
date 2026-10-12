export type OutputFormat = "txt" | "srt" | "vtt" | "json";

export interface Segment {
  start: number; // seconds
  end: number; // seconds
  text: string;
}

export interface TranscriptResult {
  text: string;
  segments: Segment[];
  language?: string;
  duration?: number;
}

export interface TranscribeParams {
  audio: Uint8Array;
  filename: string;
  model: string;
  language?: string;
  // Aborts the request and any retry wait in progress. runPipeline uses it
  // to stop a file's other chunks once one of them has failed for good, so
  // a sibling isn't left sleeping out a rate-limit wait for nothing.
  signal?: AbortSignal;
  // Called right before the client sleeps on a 429 that said how long to
  // wait (Groq's retry-after), with that wait in ms.
  onRateLimitWait?: (waitMs: number) => void;
}

// Structured progress from runPipeline, for a caller that renders its own
// (localized) text -- the desktop app. onProgress keeps the plain English
// lines the CLI prints.
export type PipelineEvent =
  // The audio is longer than Groq's free-tier hourly audio budget, so part
  // of it will have to wait for that budget to free up.
  | { type: "over-hourly-budget"; audioSeconds: number; budgetSeconds: number }
  | { type: "chunks-planned"; total: number }
  // chunk is 1-based in both of these. resumeAt is an ISO timestamp.
  | { type: "chunk-done"; chunk: number; done: number; total: number }
  | { type: "rate-limit-wait"; chunk: number; total: number; waitSeconds: number; resumeAt: string };

export interface Transcriber {
  transcribe(params: TranscribeParams): Promise<TranscriptResult>;
}

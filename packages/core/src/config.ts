import type { OutputFormat } from "./types.js";

export const DEFAULT_MODEL = "whisper-large-v3-turbo";
export const MAX_UPLOAD_BYTES = 25_000_000; // Groq free-tier per-file cap, decimal MB
export const CHUNK_TARGET_BYTES = 20_000_000; // headroom under the cap for per-chunk bitrate variance
export const MAX_RETRIES = 4;

// Groq's free tier allows 7,200 audio-seconds per hour (and 28,800 per day)
// for both Whisper models, counted over a rolling window -- verified against
// console.groq.com/docs/rate-limits on 2026-10-12. Audio longer than this
// can't finish inside one window no matter how it is chunked.
export const FREE_TIER_AUDIO_SECONDS_PER_HOUR = 7_200;
// The longest single retry-after this app sleeps out on its own. The hourly
// window never asks for more than an hour; a longer wait means the daily
// budget is spent, which is better reported than waited on.
export const MAX_RATE_LIMIT_WAIT_MS = 65 * 60 * 1000;
// How many retry-after waits one chunk may sit through. Separate from
// MAX_RETRIES: those are short exponential backoffs for transient failures.
export const MAX_RATE_LIMIT_WAITS = 6;

// Prefix of the stderr lines the desktop sidecar writes for PipelineEvents
// (one JSON object per line after it). apps/desktop/src-tauri/src/commands.rs
// matches the same literal -- change both together.
export const PROGRESS_EVENT_PREFIX = "@@progress ";

export const GROQ_TRANSCRIPTION_ENDPOINT =
  "https://api.groq.com/openai/v1/audio/transcriptions";

export const OUTPUT_FORMATS: readonly OutputFormat[] = ["txt", "srt", "vtt", "json"];

import type { OutputFormat } from "./types.js";

export const DEFAULT_MODEL = "whisper-large-v3-turbo";
export const MAX_UPLOAD_BYTES = 25_000_000; // Groq free-tier per-file cap, decimal MB
export const CHUNK_TARGET_BYTES = 20_000_000; // headroom under the cap for per-chunk bitrate variance
export const MAX_RETRIES = 4;

export const GROQ_TRANSCRIPTION_ENDPOINT =
  "https://api.groq.com/openai/v1/audio/transcriptions";

export const OUTPUT_FORMATS: readonly OutputFormat[] = ["txt", "srt", "vtt", "json"];

import type { OutputFormat } from "./types.js";

export const DEFAULT_MODEL = "whisper-large-v3-turbo";
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // hard Groq cap (per request)
export const CHUNK_TARGET_BYTES = 24 * 1024 * 1024; // stay under the cap
export const MAX_RETRIES = 4;

export const GROQ_TRANSCRIPTION_ENDPOINT =
  "https://api.groq.com/openai/v1/audio/transcriptions";

export const OUTPUT_FORMATS: readonly OutputFormat[] = ["txt", "srt", "vtt", "json"];

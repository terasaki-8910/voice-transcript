export type {
  OutputFormat,
  Segment,
  TranscriptResult,
  TranscribeParams,
  Transcriber,
} from "./types.js";

export {
  DEFAULT_MODEL,
  MAX_UPLOAD_BYTES,
  CHUNK_TARGET_BYTES,
  MAX_RETRIES,
  GROQ_TRANSCRIPTION_ENDPOINT,
  OUTPUT_FORMATS,
} from "./config.js";

export { planChunks } from "./chunk.js";
export type { ChunkPlanInput } from "./chunk.js";

export { createFfmpegBackend, FfmpegNotFoundError } from "./audio.js";
export type { AudioBackend, AudioChunk, NormalizedAudio } from "./audio.js";

export { render } from "./formats.js";

export { stitchChunks } from "./stitch.js";

export { GroqClient, GroqApiError } from "./groq.js";

export { runPipeline } from "./pipeline.js";

export { transcriptions, transcriptionStatus } from "./db/schema.js";
export { createDb } from "./db/client.js";
export type { Db } from "./db/client.js";
export {
  recordHistory,
  recordHistorySafe,
  listHistory,
  getHistoryById,
} from "./db/history.js";
export type { HistoryRecordInput, HistoryRecord } from "./db/history.js";
export { ensureSchema, defaultMigrationsFolder } from "./db/migrate.js";

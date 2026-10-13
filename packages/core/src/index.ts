export type {
  OutputFormat,
  Segment,
  TranscriptResult,
  TranscribeParams,
  Transcriber,
  PipelineEvent,
} from "./types.js";

export {
  DEFAULT_MODEL,
  MAX_UPLOAD_BYTES,
  CHUNK_TARGET_BYTES,
  MAX_RETRIES,
  FREE_TIER_AUDIO_SECONDS_PER_HOUR,
  MAX_RATE_LIMIT_WAIT_MS,
  MAX_RATE_LIMIT_WAITS,
  PROGRESS_EVENT_PREFIX,
  GROQ_TRANSCRIPTION_ENDPOINT,
  OUTPUT_FORMATS,
} from "./config.js";

export { planChunks } from "./chunk.js";
export type { ChunkPlanInput } from "./chunk.js";

export { createFfmpegBackend, FfmpegNotFoundError } from "./audio.js";
export type { AudioBackend, AudioChunk, NormalizedAudio } from "./audio.js";

export { render } from "./formats.js";

export { planKeptIntervals, createTimeMap, remapToOriginal } from "./timeline.js";
export type { Interval, TimeMap } from "./timeline.js";

export { stitchChunks } from "./stitch.js";

export { GroqClient, GroqApiError, parseRetryAfterMs, formatWait } from "./groq.js";

export { runPipeline } from "./pipeline.js";

export { transcriptions, transcriptionStatus, dictionaryEntries, transcriptNotes } from "./db/schema.js";
export { createDb } from "./db/client.js";
export type { Db } from "./db/client.js";
export {
  recordHistory,
  listHistory,
  getHistoryById,
  deleteHistoryEntry,
  searchHistory,
} from "./db/history.js";
export {
  pendingHistoryDir,
  savePendingHistory,
  flushPendingHistory,
  recordHistoryOrDefer,
} from "./db/pending.js";
export type { HistoryRecordInput, HistoryRecord, HistorySearchResult } from "./db/history.js";
export {
  listDictionary,
  addDictionaryEntry,
  updateDictionaryEntry,
  deleteDictionaryEntry,
  importDictionaryEntries,
} from "./db/dictionary.js";
export type { DictionaryRecord, ImportResult } from "./db/dictionary.js";
export { listNotes, addNote, updateNote, deleteNote } from "./db/notes.js";
export type { TranscriptNoteRecord, NewTranscriptNote } from "./db/notes.js";
export { ensureSchema, defaultMigrationsFolder } from "./db/migrate.js";

export { applyDictionary } from "./dictionary.js";
export type { DictionaryEntry } from "./dictionary.js";

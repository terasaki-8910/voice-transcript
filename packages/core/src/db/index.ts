export { transcriptions, transcriptionStatus, dictionaryEntries, transcriptNotes } from "./schema.js";
export { createDb } from "./client.js";
export type { Db } from "./client.js";
export {
  recordHistory,
  recordHistorySafe,
  listHistory,
  getHistoryById,
  deleteHistoryEntry,
  searchHistory,
} from "./history.js";
export type { HistoryRecordInput, HistoryRecord, HistorySearchResult } from "./history.js";
export {
  listDictionary,
  addDictionaryEntry,
  updateDictionaryEntry,
  deleteDictionaryEntry,
  importDictionaryEntries,
} from "./dictionary.js";
export type { DictionaryRecord, ImportResult } from "./dictionary.js";
export { listNotes, addNote, updateNote, deleteNote } from "./notes.js";
export type { TranscriptNoteRecord, NewTranscriptNote } from "./notes.js";
export { ensureSchema, defaultMigrationsFolder } from "./migrate.js";

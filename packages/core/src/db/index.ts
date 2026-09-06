export { transcriptions, transcriptionStatus, dictionaryEntries } from "./schema.js";
export { createDb } from "./client.js";
export type { Db } from "./client.js";
export {
  recordHistory,
  recordHistorySafe,
  listHistory,
  getHistoryById,
  deleteHistoryEntry,
} from "./history.js";
export type { HistoryRecordInput, HistoryRecord } from "./history.js";
export {
  listDictionary,
  addDictionaryEntry,
  updateDictionaryEntry,
  deleteDictionaryEntry,
  importDictionaryEntries,
} from "./dictionary.js";
export type { DictionaryRecord, ImportResult } from "./dictionary.js";
export { ensureSchema, defaultMigrationsFolder } from "./migrate.js";

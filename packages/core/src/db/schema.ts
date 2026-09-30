import { pgTable, serial, integer, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import type { Segment } from "../types.js";

// Custom dictionary (word replacement): applied to every transcript, GUI and
// CLI alike (see src/dictionary.ts's applyDictionary()). `word` is unique --
// that is what makes import (db/dictionary.ts) an idempotent upsert.
export const dictionaryEntries = pgTable("dictionary_entries", {
  id: serial("id").primaryKey(),
  word: text("word").notNull().unique(),
  replacement: text("replacement").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ACCEPTANCE H1: every completed run (CLI or GUI) writes one history record
// with source file name, started-at timestamp, model, language, requested
// format(s), status, and the resulting transcript text (+ segments).
export const transcriptionStatus = pgEnum("transcription_status", ["success", "failed"]);

export const transcriptions = pgTable("transcriptions", {
  id: serial("id").primaryKey(),
  sourceFileName: text("source_file_name").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  model: text("model").notNull(),
  language: text("language"),
  formats: jsonb("formats").$type<string[]>().notNull(),
  status: transcriptionStatus("status").notNull(),
  transcriptText: text("transcript_text"),
  segments: jsonb("segments").$type<Segment[]>(),
  // User-editable display name (2026-09-30, user-requested), separate from
  // sourceFileName on purpose: sourceFileName is also the real filesystem
  // path trash_audio/delete_history_entry use to find the audio to trash
  // (commands.rs), so it can never be edited without breaking that lookup.
  // Null means "no custom title set yet" -- the GUI falls back to
  // basename(sourceFileName), same as before this column existed.
  title: text("title"),
});

// Transcript notes (annotations): a side comment anchored to a character
// range of one transcription's transcriptText, e.g. flagging "2GOMCP"
// should have read "TogoMCP" -- the body text itself is never edited (see
// SPEC.md > Transcript notes for why: offset anchoring only stays valid
// because transcriptText is immutable after the row is written, so the
// note's own text is the only thing this table ever updates). Cascade
// delete: a note about a transcript that no longer exists is never a state
// worth keeping.
export const transcriptNotes = pgTable("transcript_notes", {
  id: serial("id").primaryKey(),
  transcriptionId: integer("transcription_id")
    .notNull()
    .references(() => transcriptions.id, { onDelete: "cascade" }),
  startOffset: integer("start_offset").notNull(),
  endOffset: integer("end_offset").notNull(),
  quotedText: text("quoted_text").notNull(),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

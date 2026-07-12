import { pgTable, serial, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import type { Segment } from "../types.js";

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
});

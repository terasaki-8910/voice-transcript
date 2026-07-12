CREATE TYPE "public"."transcription_status" AS ENUM('success', 'failed');--> statement-breakpoint
CREATE TABLE "transcriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_file_name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model" text NOT NULL,
	"language" text,
	"formats" jsonb NOT NULL,
	"status" "transcription_status" NOT NULL,
	"transcript_text" text,
	"segments" jsonb
);

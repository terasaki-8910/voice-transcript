CREATE TABLE "dictionary_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"word" text NOT NULL,
	"replacement" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dictionary_entries_word_unique" UNIQUE("word")
);

import { eq, desc } from "drizzle-orm";
import { dictionaryEntries } from "./schema.js";
import type { Db } from "./client.js";
import type { DictionaryEntry } from "../dictionary.js";

export interface DictionaryRecord {
  id: number;
  word: string;
  replacement: string;
  createdAt: Date;
  updatedAt: Date;
}

// Newest-first, matching listHistory()'s convention.
export async function listDictionary(db: Db): Promise<DictionaryRecord[]> {
  return db.select().from(dictionaryEntries).orderBy(desc(dictionaryEntries.createdAt));
}

export async function addDictionaryEntry(db: Db, entry: DictionaryEntry): Promise<DictionaryRecord> {
  const [row] = await db.insert(dictionaryEntries).values(entry).returning();
  return row;
}

export async function updateDictionaryEntry(
  db: Db,
  id: number,
  entry: DictionaryEntry,
): Promise<DictionaryRecord | undefined> {
  const [row] = await db
    .update(dictionaryEntries)
    .set({ word: entry.word, replacement: entry.replacement, updatedAt: new Date() })
    .where(eq(dictionaryEntries.id, id))
    .returning();
  return row;
}

// A no-op (not an error) if the id no longer exists -- same convention as
// deleteHistoryEntry.
export async function deleteDictionaryEntry(db: Db, id: number): Promise<void> {
  await db.delete(dictionaryEntries).where(eq(dictionaryEntries.id, id));
}

export interface ImportResult {
  inserted: number;
  updated: number;
  skipped: number;
}

// Upsert by word (the unique constraint added in migration 0001): a word
// already on file gets its replacement/updatedAt refreshed, a new word gets
// inserted. Re-importing the same file is a no-op on the DB but still
// reports the correct updated count -- the idempotence property this is
// tested for.
export async function importDictionaryEntries(
  db: Db,
  entries: DictionaryEntry[],
): Promise<ImportResult> {
  let inserted = 0;
  let updated = 0;

  for (const entry of entries) {
    const existing = await db
      .select({ id: dictionaryEntries.id, replacement: dictionaryEntries.replacement })
      .from(dictionaryEntries)
      .where(eq(dictionaryEntries.word, entry.word))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(dictionaryEntries).values(entry);
      inserted++;
    } else {
      if (existing[0].replacement !== entry.replacement) {
        await db
          .update(dictionaryEntries)
          .set({ replacement: entry.replacement, updatedAt: new Date() })
          .where(eq(dictionaryEntries.id, existing[0].id));
      }
      updated++;
    }
  }

  return { inserted, updated, skipped: 0 };
}

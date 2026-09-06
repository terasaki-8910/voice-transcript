// ACCEPTANCE K1-K2: custom dictionary word replacement.
// Pins the contract of applyDictionary() in src/dictionary.ts. Fixtures use
// real entries from the user's Amical vocabulary export
// (~/Downloads/amical_vocabulary_export.json) so the substring-containment
// and ASCII-boundary cases are the actual ones this dictionary ships with,
// not hypothetical.
import { describe, it, expect } from "vitest";
import { applyDictionary } from "../src/dictionary.js";
import type { DictionaryEntry } from "../src/dictionary.js";
import type { TranscriptResult } from "../src/types.js";

function result(text: string, segments: TranscriptResult["segments"] = []): TranscriptResult {
  return { text, segments };
}

describe("K1 - replaces text and segments", () => {
  it("replaces every occurrence in result.text", () => {
    const entries: DictionaryEntry[] = [{ word: "cloud.md", replacement: "CLAUDE.md" }];
    const out = applyDictionary(result("Please read cloud.md and cloud.md again."), entries);
    expect(out.text).toBe("Please read CLAUDE.md and CLAUDE.md again.");
  });

  it("replaces occurrences inside every segment's text, independently of result.text", () => {
    const entries: DictionaryEntry[] = [{ word: "スパークル", replacement: "SPARQL" }];
    const out = applyDictionary(
      result("スパークルの説明", [
        { start: 0, end: 1, text: "スパークルとは" },
        { start: 1, end: 2, text: "何ですか" },
      ]),
      entries,
    );
    expect(out.text).toBe("SPARQLの説明");
    expect(out.segments[0].text).toBe("SPARQLとは");
    expect(out.segments[1].text).toBe("何ですか");
  });

  it("returns the result unchanged when there are no entries", () => {
    const original = result("no changes here");
    expect(applyDictionary(original, [])).toEqual(original);
  });
});

describe("K2 - ASCII whole-word vs non-ASCII substring matching", () => {
  it("does not fire an ASCII word inside a larger token (Spark vs sparkle)", () => {
    const entries: DictionaryEntry[] = [
      { word: "Spark", replacement: "SPARQL" },
      { word: "sparkle", replacement: "SPARQL" },
    ];
    const out = applyDictionary(result("Spark and sparkle and Sparkling"), entries);
    // "Spark" matches standalone; "sparkle" matches standalone; "Sparkling"
    // is untouched by either (not a whole-word match for "Spark").
    expect(out.text).toBe("SPARQL and SPARQL and Sparkling");
  });

  it("matches a non-ASCII word as a plain substring (no word-boundary concept in Japanese)", () => {
    const entries: DictionaryEntry[] = [{ word: "ずー", replacement: "図" }];
    const out = applyDictionary(result("ずーにーを見る"), entries);
    // "ずーにー" is a *different* entry in the real export (-> "図2"); with
    // only "ずー" registered here, plain substring matching means it fires
    // inside "ずーにー" too -- this is exactly why longest-first ordering
    // (next test) matters once both entries are present together.
    expect(out.text).toBe("図にーを見る");
  });

  it("is case-sensitive and literal (Ultra sync vs ultrasync kept distinct)", () => {
    const entries: DictionaryEntry[] = [
      { word: "Ultra sync", replacement: "ultrathink" },
      { word: "ultrasync", replacement: "ultrathink" },
    ];
    const out = applyDictionary(result("Ultra sync and ultrasync and ULTRASYNC"), entries);
    expect(out.text).toBe("ultrathink and ultrathink and ULTRASYNC");
  });
});

describe("longest-word-first resolves real substring-containment cases", () => {
  it("一時書紙 / 書紙 (real export pair)", () => {
    const entries: DictionaryEntry[] = [
      { word: "書紙", replacement: "書誌" },
      { word: "一時書紙", replacement: "一次書誌" },
    ];
    const out = applyDictionary(result("これは一時書紙です。書紙も直る。"), entries);
    expect(out.text).toBe("これは一次書誌です。書誌も直る。");
  });

  it("ずーにー / ずー (real export pair)", () => {
    const entries: DictionaryEntry[] = [
      { word: "ずー", replacement: "図" },
      { word: "ずーにー", replacement: "図2" },
    ];
    const out = applyDictionary(result("ずーにーとずーを見る"), entries);
    expect(out.text).toBe("図2と図を見る");
  });

  it("クロードコード / クロード (real export pair)", () => {
    const entries: DictionaryEntry[] = [
      { word: "クロード", replacement: "Claude" },
      { word: "クロードコード", replacement: "ClaudeCode" },
    ];
    const out = applyDictionary(result("クロードコードとクロードを使う"), entries);
    expect(out.text).toBe("ClaudeCodeとClaudeを使う");
  });

  it("does not cascade: a replacement's own output is never re-scanned", () => {
    // Constructed adversarial case (not in the real export, which has 0
    // cascade risk today) -- proves the single-pass design, not just that
    // today's data happens to avoid it.
    const entries: DictionaryEntry[] = [
      { word: "A", replacement: "B" },
      { word: "B", replacement: "C" },
    ];
    const out = applyDictionary(result("A"), entries);
    expect(out.text).toBe("B");
  });
});

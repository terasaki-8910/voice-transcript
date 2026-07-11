// ACCEPTANCE B3: stitching chunk transcripts with cumulative time offsets.
// Pins `stitchChunks(chunks)` in src/stitch.ts.
//
// Each chunk carries an `offset` (the cumulative duration of all preceding
// chunks). Its segment timestamps are local to the chunk; stitching must add
// the offset so merged timestamps are absolute and monotonic non-decreasing.
import { describe, it, expect } from "vitest";
import { stitchChunks } from "../src/stitch.js";
import type { TranscriptResult } from "../src/types.js";

const chunkA: TranscriptResult = {
  text: "one two",
  segments: [
    { start: 0, end: 2, text: "one" },
    { start: 2, end: 5, text: "two" },
  ],
};
const chunkB: TranscriptResult = {
  text: "three four",
  segments: [
    { start: 0, end: 1.5, text: "three" },
    { start: 1.5, end: 4, text: "four" },
  ],
};
const chunkC: TranscriptResult = {
  text: "five",
  segments: [{ start: 0, end: 3, text: "five" }],
};

describe("B3 - offset + monotonic stitch", () => {
  it("offsets each chunk's timestamps by the cumulative preceding duration", () => {
    // Chunk durations 5s and 4s => offsets 0, 5, 9.
    const merged = stitchChunks([
      { offset: 0, result: chunkA },
      { offset: 5, result: chunkB },
      { offset: 9, result: chunkC },
    ]);

    expect(merged.segments.map((s) => [s.start, s.end])).toEqual([
      [0, 2],
      [2, 5],
      [6.5, 9], // 5 + 1.5, 5 + 4
      [7, 10],
      [14, 17], // 9 + ...
    ]);
    expect(merged.segments.map((s) => s.text)).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five",
    ]);
  });

  it("produces monotonic non-decreasing merged timestamps", () => {
    const merged = stitchChunks([
      { offset: 0, result: chunkA },
      { offset: 5, result: chunkB },
      { offset: 9, result: chunkC },
    ]);

    let prev = -Infinity;
    for (const seg of merged.segments) {
      expect(seg.start).toBeGreaterThanOrEqual(prev);
      expect(seg.end).toBeGreaterThanOrEqual(seg.start);
      prev = seg.end;
    }
  });

  it("concatenates chunk text without dropping any chunk", () => {
    const merged = stitchChunks([
      { offset: 0, result: chunkA },
      { offset: 5, result: chunkB },
      { offset: 9, result: chunkC },
    ]);
    for (const word of ["one", "two", "three", "four", "five"]) {
      expect(merged.text).toContain(word);
    }
  });
});

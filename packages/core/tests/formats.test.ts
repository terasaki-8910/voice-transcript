// ACCEPTANCE C1-C4: output format correctness.
// Pins the contract of `render(result, format)` in src/formats.ts.
import { describe, it, expect } from "vitest";
import { render } from "../src/formats.js";
import type { TranscriptResult } from "../src/types.js";

const sample: TranscriptResult = {
  language: "en",
  duration: 7.5,
  text: "Hello world. This is a test.",
  segments: [
    { start: 0, end: 3.2, text: "Hello world." },
    { start: 3.2, end: 7.5, text: "This is a test." },
  ],
};

describe("C1 - SRT", () => {
  it("uses sequential integer indices and HH:MM:SS,mmm timing lines", () => {
    const out = render(sample, "srt");
    const lines = out.split(/\r?\n/);

    // Sequential integer cue indices starting at 1.
    const indices = lines.filter((l) => /^\d+$/.test(l)).map(Number);
    expect(indices).toEqual([1, 2]);

    // Timing lines: HH:MM:SS,mmm --> HH:MM:SS,mmm (comma decimal separator).
    const timing = lines.filter((l) => l.includes("-->"));
    expect(timing).toHaveLength(2);
    for (const line of timing) {
      expect(line).toMatch(
        /^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}$/,
      );
    }
    // First cue starts at 00:00:00,000.
    expect(timing[0].startsWith("00:00:00,000 --> ")).toBe(true);
  });
});

describe("C2 - VTT", () => {
  it("begins with WEBVTT and uses HH:MM:SS.mmm timings", () => {
    const out = render(sample, "vtt");
    expect(out.startsWith("WEBVTT")).toBe(true);

    const timing = out.split(/\r?\n/).filter((l) => l.includes("-->"));
    expect(timing.length).toBeGreaterThan(0);
    for (const line of timing) {
      // Dot decimal separator (distinct from SRT's comma).
      expect(line).toMatch(
        /^\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}$/,
      );
    }
  });
});

describe("C3 - JSON", () => {
  it("is valid JSON whose segments each contain start, end and text", () => {
    const out = render(sample, "json");
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed.segments)).toBe(true);
    expect(parsed.segments.length).toBe(sample.segments.length);
    for (const seg of parsed.segments) {
      expect(typeof seg.start).toBe("number");
      expect(typeof seg.end).toBe("number");
      expect(typeof seg.text).toBe("string");
    }
  });
});

describe("C4 - TXT", () => {
  it("contains no timestamps and no emoji", () => {
    const out = render(sample, "txt");
    // No cue arrows and no HH:MM:SS timestamps of either flavour.
    expect(out).not.toContain("-->");
    expect(out).not.toMatch(/\d{2}:\d{2}:\d{2}[.,]\d{3}/);
    // No emoji.
    expect(out).not.toMatch(/\p{Extended_Pictographic}/u);
    // Still carries the words.
    expect(out).toContain("Hello world.");
    expect(out).toContain("This is a test.");
  });
});

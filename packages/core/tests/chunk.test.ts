// ACCEPTANCE B1 + B2 (core): chunk-boundary planning.
// Pins `planChunks(input)` in src/chunk.ts. Pure function, no ffmpeg needed.
//
// Contract: returns the INTERIOR split points (seconds), sorted ascending,
// strictly between 0 and durationSec. An empty array means "do not split"
// (a single upload). Every returned boundary MUST be one of the provided
// detected-silence times -- boundaries are chosen at silence, never at fixed
// arithmetic offsets.
import { describe, it, expect } from "vitest";
import { planChunks } from "../src/chunk.js";

const MB = 1024 * 1024;

describe("B1 - no chunking when the encode fits", () => {
  it("returns [] when encodedBytes <= maxBytes (single request)", () => {
    const boundaries = planChunks({
      durationSec: 3600,
      encodedBytes: 20 * MB,
      maxBytes: 24 * MB,
      silences: [600, 1200, 1800, 2400, 3000],
    });
    expect(boundaries).toEqual([]);
  });

  it("returns [] exactly at the threshold", () => {
    const boundaries = planChunks({
      durationSec: 3600,
      encodedBytes: 24 * MB,
      maxBytes: 24 * MB,
      silences: [600, 1200, 1800, 2400, 3000],
    });
    expect(boundaries).toEqual([]);
  });
});

describe("B2 - chunk at detected silence when the encode is too big", () => {
  const silences = [480, 923, 1500, 1980, 2510, 3050, 3600, 4100];

  it("splits into N>1 chunks and every boundary is a detected silence", () => {
    const durationSec = 4674; // ~78 min test file
    const boundaries = planChunks({
      durationSec,
      encodedBytes: 73 * MB, // exceeds the cap -> must split
      maxBytes: 24 * MB,
      silences,
    });

    // More than one chunk => at least one interior boundary.
    expect(boundaries.length).toBeGreaterThanOrEqual(1);

    // Boundaries are sorted, unique, strictly inside (0, duration).
    const sorted = [...boundaries].sort((a, b) => a - b);
    expect(boundaries).toEqual(sorted);
    expect(new Set(boundaries).size).toBe(boundaries.length);
    for (const b of boundaries) {
      expect(b).toBeGreaterThan(0);
      expect(b).toBeLessThan(durationSec);
    }

    // The defining property: NOT fixed offsets -- every cut is a detected silence.
    for (const b of boundaries) {
      expect(silences).toContain(b);
    }
  });

  it("keeps each resulting chunk within the byte budget", () => {
    const durationSec = 4674;
    const encodedBytes = 73 * MB;
    const maxBytes = 24 * MB;
    const boundaries = planChunks({ durationSec, encodedBytes, maxBytes, silences });

    // Bytes are proportional to duration for a constant-bitrate normalized encode.
    const bytesPerSec = encodedBytes / durationSec;
    const cuts = [0, ...boundaries, durationSec];
    for (let i = 1; i < cuts.length; i++) {
      const chunkBytes = (cuts[i] - cuts[i - 1]) * bytesPerSec;
      expect(chunkBytes).toBeLessThanOrEqual(maxBytes);
    }
  });
});

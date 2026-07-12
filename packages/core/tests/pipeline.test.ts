// ACCEPTANCE B1, B2 (request count) and D2 (no silent chunk drop).
// Pins `runPipeline(inputFile, deps)` in src/pipeline.ts, exercised with a
// mocked audio backend and a mocked transcriber (no real ffmpeg/network).
import { describe, it, expect, vi } from "vitest";
import { runPipeline } from "../src/pipeline.js";
import type { AudioBackend, AudioChunk } from "../src/audio.js";
import type { Transcriber, TranscribeParams, TranscriptResult } from "../src/types.js";

const MB = 1024 * 1024;
const MAX = 24 * MB;

// Build an audio backend whose splitAt honours the boundaries runPipeline
// computes, so the number of chunks (and thus requests) is driven by the real
// planning logic. `bytes` is the normalized encode size (drives chunking).
function makeAudio(opts: {
  durationSec: number;
  bytes: number;
  silences: number[];
}): AudioBackend {
  const splitCalls: number[][] = [];
  const backend: AudioBackend & { splitCalls: number[][] } = {
    splitCalls,
    assertAvailable: vi.fn(async () => {}),
    probeDuration: vi.fn(async () => opts.durationSec),
    normalize: vi.fn(async () => ({
      path: "/tmp/normalized.wav",
      bytes: opts.bytes,
      duration: opts.durationSec,
    })),
    detectSilences: vi.fn(async () => opts.silences),
    splitAt: vi.fn(async (_file: string, boundaries: number[]): Promise<AudioChunk[]> => {
      splitCalls.push(boundaries);
      const cuts = [0, ...boundaries, opts.durationSec];
      const chunks: AudioChunk[] = [];
      for (let i = 1; i < cuts.length; i++) {
        chunks.push({
          path: `/tmp/chunk-${i - 1}.wav`,
          offset: cuts[i - 1],
          duration: cuts[i] - cuts[i - 1],
          bytes: Math.round(((cuts[i] - cuts[i - 1]) / opts.durationSec) * opts.bytes),
        });
      }
      return chunks;
    }),
    readBytes: vi.fn(async (chunk: AudioChunk) => new Uint8Array([chunk.offset & 0xff])),
  };
  return backend;
}

function makeTranscriber(
  impl?: (p: TranscribeParams, callIndex: number) => Promise<TranscriptResult>,
): Transcriber & { calls: TranscribeParams[] } {
  const calls: TranscribeParams[] = [];
  let i = 0;
  return {
    calls,
    transcribe: vi.fn(async (p: TranscribeParams) => {
      const idx = i++;
      calls.push(p);
      if (impl) return impl(p, idx);
      return { text: `seg${idx}`, segments: [{ start: 0, end: 1, text: `seg${idx}` }] };
    }),
  };
}

describe("B1 - single request when the encode fits", () => {
  it("makes exactly one transcription request and no split", async () => {
    const audio = makeAudio({ durationSec: 3600, bytes: 20 * MB, silences: [600, 1200] });
    const transcriber = makeTranscriber();

    await runPipeline("in.m4a", {
      audio,
      transcriber,
      maxBytes: MAX,
      model: "whisper-large-v3-turbo",
    });

    expect(transcriber.transcribe).toHaveBeenCalledTimes(1);
  });
});

describe("B2 - N>1 requests at detected silence when the encode is too big", () => {
  it("splits and makes one request per chunk, cutting only at silence", async () => {
    const silences = [480, 923, 1500, 1980, 2510, 3050, 3600, 4100];
    const audio = makeAudio({ durationSec: 4674, bytes: 73 * MB, silences }) as AudioBackend & {
      splitCalls: number[][];
    };
    const transcriber = makeTranscriber();

    await runPipeline("in.m4a", {
      audio,
      transcriber,
      maxBytes: MAX,
      model: "whisper-large-v3-turbo",
    });

    const n = (transcriber.transcribe as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(n).toBeGreaterThan(1);

    // Every boundary handed to splitAt is a detected silence (not a fixed offset).
    const boundaries = audio.splitCalls.flat();
    expect(boundaries.length).toBeGreaterThanOrEqual(1);
    for (const b of boundaries) {
      expect(silences).toContain(b);
    }
  });
});

describe("D2 - a chunk's text is never silently dropped", () => {
  it("fails loudly if any chunk transcription ultimately rejects", async () => {
    const silences = [480, 923, 1500, 1980, 2510, 3050, 3600, 4100];
    const audio = makeAudio({ durationSec: 4674, bytes: 73 * MB, silences });
    // Second chunk always fails (client already exhausted its own retries).
    const transcriber = makeTranscriber(async (_p, idx) => {
      if (idx === 1) throw new Error("chunk 1 permanently failed");
      return { text: `seg${idx}`, segments: [{ start: 0, end: 1, text: `seg${idx}` }] };
    });

    await expect(
      runPipeline("in.m4a", {
        audio,
        transcriber,
        maxBytes: MAX,
        model: "whisper-large-v3-turbo",
      }),
    ).rejects.toThrow();
  });

  it("includes every chunk's text when all chunks succeed", async () => {
    const silences = [480, 923, 1500, 1980, 2510, 3050, 3600, 4100];
    const audio = makeAudio({ durationSec: 4674, bytes: 73 * MB, silences });
    const transcriber = makeTranscriber();

    const merged = await runPipeline("in.m4a", {
      audio,
      transcriber,
      maxBytes: MAX,
      model: "whisper-large-v3-turbo",
    });

    const n = transcriber.calls.length;
    expect(n).toBeGreaterThan(1);
    // No chunk dropped: each chunk's distinct text survives into the merge.
    for (let i = 0; i < n; i++) {
      expect(merged.text).toContain(`seg${i}`);
    }
  });
});

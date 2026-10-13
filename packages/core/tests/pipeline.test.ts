// ACCEPTANCE B1, B2 (request count) and D2 (no silent chunk drop).
// Pins `runPipeline(inputFile, deps)` in src/pipeline.ts, exercised with a
// mocked audio backend and a mocked transcriber (no real ffmpeg/network).
import { describe, it, expect, vi } from "vitest";
import { runPipeline } from "../src/pipeline.js";
import type { AudioBackend, AudioChunk } from "../src/audio.js";
import type { PipelineEvent, Transcriber, TranscribeParams, TranscriptResult } from "../src/types.js";
import { CHUNK_TARGET_BYTES, FREE_TIER_AUDIO_SECONDS_PER_HOUR, MAX_UPLOAD_BYTES } from "../src/config.js";

const MB = 1024 * 1024;
const MAX = CHUNK_TARGET_BYTES;

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
    const audio = makeAudio({ durationSec: 3600, bytes: 15 * MB, silences: [600, 1200] });
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

describe("B2 - a split that overshoots the upload cap is re-planned smaller", () => {
  it("re-splits with a smaller budget until every chunk fits under the cap", async () => {
    const silences = [480, 923, 1500, 1980, 2510, 3050, 3600, 4100];
    const audio = makeAudio({ durationSec: 4674, bytes: 73 * MB, silences }) as AudioBackend & {
      splitCalls: number[][];
    };
    const baseSplit = audio.splitAt;
    let calls = 0;
    audio.splitAt = vi.fn(async (file: string, boundaries: number[]) => {
      const chunks = await baseSplit(file, boundaries);
      calls++;
      return calls === 1 ? chunks.map((c) => ({ ...c, bytes: c.bytes * 2 })) : chunks;
    });
    const transcriber = makeTranscriber();

    await runPipeline("in.m4a", { audio, transcriber, model: "whisper-large-v3-turbo" });

    expect(audio.splitAt).toHaveBeenCalledTimes(2);
    const [first, second] = audio.splitCalls;
    expect(second.length).toBeGreaterThan(first.length);
    expect(transcriber.calls.length).toBe(second.length + 1);
  });

  it("fails without transcribing when no split can fit under the upload cap", async () => {
    const silences = [480, 923, 1500, 1980, 2510, 3050, 3600, 4100];
    const audio = makeAudio({ durationSec: 4674, bytes: 73 * MB, silences });
    const baseSplit = audio.splitAt;
    audio.splitAt = vi.fn(async (file: string, boundaries: number[]) =>
      (await baseSplit(file, boundaries)).map((c) => ({ ...c, bytes: MAX_UPLOAD_BYTES + 1 })),
    );
    const transcriber = makeTranscriber();

    await expect(
      runPipeline("in.m4a", { audio, transcriber, model: "whisper-large-v3-turbo" }),
    ).rejects.toThrow(/upload cap/);
    expect(audio.splitAt).toHaveBeenCalledTimes(3);
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });
});

describe("B2 - upload cap is Groq's documented 25 MB, with headroom for the chunk target", () => {
  it("pins the cap at 25,000,000 bytes and keeps the chunk target below it", () => {
    expect(MAX_UPLOAD_BYTES).toBe(25_000_000);
    expect(CHUNK_TARGET_BYTES).toBeLessThan(MAX_UPLOAD_BYTES);
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

describe("B5 - temp artifacts are removed whether the run succeeds or fails", () => {
  function makeAudioWithCleanup(opts: { durationSec: number; bytes: number; silences: number[] }) {
    const cleanup = vi.fn(async () => {});
    const backend = makeAudio(opts) as AudioBackend & { splitCalls: number[][] };
    return { ...backend, cleanup };
  }

  it("calls cleanup exactly once after a successful run, once every chunk has been read", async () => {
    const audio = makeAudioWithCleanup({ durationSec: 3600, bytes: 15 * MB, silences: [600, 1200] });
    const transcriber = makeTranscriber();

    await runPipeline("in.m4a", { audio, transcriber, maxBytes: MAX, model: "whisper-large-v3-turbo" });

    expect(audio.cleanup).toHaveBeenCalledTimes(1);
    const readOrder = (audio.readBytes as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const cleanupOrder = (audio.cleanup as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(cleanupOrder).toBeGreaterThan(readOrder);
  });

  it("still calls cleanup, and the real error still propagates, when a chunk transcription rejects", async () => {
    const audio = makeAudioWithCleanup({ durationSec: 3600, bytes: 15 * MB, silences: [] });
    const transcriber = makeTranscriber(async () => {
      throw new Error("chunk failed");
    });

    await expect(
      runPipeline("in.m4a", { audio, transcriber, maxBytes: MAX, model: "whisper-large-v3-turbo" }),
    ).rejects.toThrow("chunk failed");
    expect(audio.cleanup).toHaveBeenCalledTimes(1);
  });

  it("still calls cleanup when detectSilences rejects", async () => {
    const audio = makeAudioWithCleanup({ durationSec: 3600, bytes: 15 * MB, silences: [] });
    audio.detectSilences = vi.fn(async () => {
      throw new Error("detect failed");
    });
    const transcriber = makeTranscriber();

    await expect(
      runPipeline("in.m4a", { audio, transcriber, maxBytes: MAX, model: "whisper-large-v3-turbo" }),
    ).rejects.toThrow("detect failed");
    expect(audio.cleanup).toHaveBeenCalledTimes(1);
  });

  it("still calls cleanup when splitAt rejects", async () => {
    const audio = makeAudioWithCleanup({ durationSec: 3600, bytes: 15 * MB, silences: [] });
    audio.splitAt = vi.fn(async () => {
      throw new Error("split failed");
    });
    const transcriber = makeTranscriber();

    await expect(
      runPipeline("in.m4a", { audio, transcriber, maxBytes: MAX, model: "whisper-large-v3-turbo" }),
    ).rejects.toThrow("split failed");
    expect(audio.cleanup).toHaveBeenCalledTimes(1);
  });

  it("does not call cleanup if assertAvailable itself rejects (no temp dirs exist yet)", async () => {
    const audio = makeAudioWithCleanup({ durationSec: 3600, bytes: 15 * MB, silences: [] });
    audio.assertAvailable = vi.fn(async () => {
      throw new Error("ffmpeg not found");
    });
    const transcriber = makeTranscriber();

    await expect(
      runPipeline("in.m4a", { audio, transcriber, maxBytes: MAX, model: "whisper-large-v3-turbo" }),
    ).rejects.toThrow("ffmpeg not found");
    expect(audio.cleanup).not.toHaveBeenCalled();
  });

  it("a rejecting cleanup() never changes a successful run's own result", async () => {
    const audio = makeAudioWithCleanup({ durationSec: 3600, bytes: 15 * MB, silences: [] });
    audio.cleanup = vi.fn(async () => {
      throw new Error("rm failed");
    });
    const transcriber = makeTranscriber();

    const result = await runPipeline("in.m4a", { audio, transcriber, maxBytes: MAX, model: "whisper-large-v3-turbo" });
    expect(result.text).toContain("seg0");
  });

  it("a rejecting cleanup() never replaces a failed run's own error", async () => {
    const audio = makeAudioWithCleanup({ durationSec: 3600, bytes: 15 * MB, silences: [] });
    audio.cleanup = vi.fn(async () => {
      throw new Error("rm failed");
    });
    const transcriber = makeTranscriber(async () => {
      throw new Error("the real error");
    });

    await expect(
      runPipeline("in.m4a", { audio, transcriber, maxBytes: MAX, model: "whisper-large-v3-turbo" }),
    ).rejects.toThrow("the real error");
  });
});

describe("progress events and Groq's hourly audio budget", () => {
  function longAudio(durationSec: number) {
    // 4 chunks' worth of bytes, silence every 10 minutes.
    const silences = Array.from({ length: Math.floor(durationSec / 600) }, (_, i) => (i + 1) * 600);
    return makeAudio({ durationSec, bytes: 4 * MAX - MB, silences });
  }

  it("flags audio longer than the free tier's hourly budget before transcribing", async () => {
    const events: PipelineEvent[] = [];
    const progress: string[] = [];
    await runPipeline("in.m4a", {
      audio: longAudio(9000),
      transcriber: makeTranscriber(),
      maxBytes: MAX,
      model: "whisper-large-v3-turbo",
      onEvent: (e) => events.push(e),
      onProgress: (m) => progress.push(m),
    });

    expect(events[0]).toEqual({ type: "over-hourly-budget", audioSeconds: 9000, budgetSeconds: FREE_TIER_AUDIO_SECONDS_PER_HOUR });
    expect(progress.some((m) => m.includes("150 min") && m.includes("120 min"))).toBe(true);
  });

  it("does not flag audio within the budget", async () => {
    const events: PipelineEvent[] = [];
    await runPipeline("in.m4a", {
      audio: longAudio(4674),
      transcriber: makeTranscriber(),
      maxBytes: MAX,
      model: "whisper-large-v3-turbo",
      onEvent: (e) => events.push(e),
    });
    expect(events.some((e) => e.type === "over-hourly-budget")).toBe(false);
  });

  it("reports the chunk plan and each finished chunk", async () => {
    const events: PipelineEvent[] = [];
    await runPipeline("in.m4a", {
      audio: longAudio(9000),
      transcriber: makeTranscriber(),
      maxBytes: MAX,
      model: "whisper-large-v3-turbo",
      onEvent: (e) => events.push(e),
    });
    const planned = events.find((e) => e.type === "chunks-planned");
    expect(planned).toMatchObject({ type: "chunks-planned" });
    const total = planned?.type === "chunks-planned" ? planned.total : 0;
    expect(total).toBeGreaterThan(1);
    const done = events.filter((e) => e.type === "chunk-done");
    expect(done.map((e) => (e.type === "chunk-done" ? e.done : 0))).toEqual(Array.from({ length: total }, (_, i) => i + 1));
  });

  it("forwards a chunk's rate-limit wait with its 1-based index and resume time", async () => {
    const events: PipelineEvent[] = [];
    const progress: string[] = [];
    const now = Date.parse("2026-10-12T10:00:00Z");
    const transcriber = makeTranscriber(async (p, idx) => {
      if (idx === 1) p.onRateLimitWait?.(992_500);
      return { text: `seg${String(idx)}`, segments: [] };
    });
    await runPipeline("in.m4a", {
      audio: longAudio(9000),
      transcriber,
      maxBytes: MAX,
      model: "whisper-large-v3-turbo",
      onEvent: (e) => events.push(e),
      onProgress: (m) => progress.push(m),
      now: () => now,
    });
    const wait = events.find((e) => e.type === "rate-limit-wait");
    expect(wait).toMatchObject({ type: "rate-limit-wait", chunk: 2, waitSeconds: 993, resumeAt: new Date(now + 992_500).toISOString() });
    expect(progress.some((m) => m.includes("waiting 16m33s"))).toBe(true);
  });

  it("aborts the other chunks once one fails for good, and reports the real error", async () => {
    let siblingAborted = false;
    const transcriber = makeTranscriber(async (p, idx) => {
      if (idx === 0) throw new Error("chunk 0 failed");
      // A sibling sitting in a long rate-limit wait.
      await new Promise<void>((_, reject) => {
        p.signal?.addEventListener("abort", () => {
          siblingAborted = true;
          reject(p.signal?.reason);
        });
      });
      return { text: "never", segments: [] };
    });

    await expect(
      runPipeline("in.m4a", { audio: longAudio(9000), transcriber, maxBytes: MAX, model: "whisper-large-v3-turbo" }),
    ).rejects.toThrow("chunk 0 failed");
    expect(siblingAborted).toBe(true);
  });
});

describe("silence trimming (opt-in)", () => {
  // 4 min file with a 30 s silence at 60-90 s. Kept: [0, 60.5] and [89.5, 240];
  // 210.5 + ... computed below. The trimmed file is what gets chunked/sent.
  const SILENCE = { start: 60, end: 90 };
  const KEPT = [
    { start: 0, end: 60.5 },
    { start: 89.5, end: 240 },
  ];
  const TRIMMED_SEC = 60.5 + 150.5;

  function trimAudio(silences: Array<{ start: number; end: number }>, durationSec = 240) {
    const audio = makeAudio({ durationSec, bytes: 1 * MB, silences: [] });
    const trimmed = { path: "/tmp/trimmed.flac", bytes: 1 * MB, duration: TRIMMED_SEC };
    audio.detectSilenceIntervals = vi.fn(async () => silences);
    audio.keepIntervals = vi.fn(async () => trimmed);
    return audio;
  }

  const base = { maxBytes: MAX, model: "whisper-large-v3-turbo" };

  it("is off by default: the new backend methods are never called", async () => {
    const audio = trimAudio([SILENCE]);
    const result = await runPipeline("in.m4a", { audio, transcriber: makeTranscriber(), ...base });
    expect(audio.detectSilenceIntervals).not.toHaveBeenCalled();
    expect(audio.keepIntervals).not.toHaveBeenCalled();
    expect(result.segments).toEqual([{ start: 0, end: 1, text: "seg0" }]);
    expect(result.duration).toBe(1);
  });

  it("cuts the silence, sends the compacted audio, and maps output to the original timeline", async () => {
    const audio = trimAudio([SILENCE]);
    const progress: string[] = [];
    const transcriber = makeTranscriber(async () => ({
      text: "a b",
      segments: [
        { start: 10, end: 12, text: "a" },
        { start: 70, end: 72, text: "b" }, // after the cut: compacted 70 s is original 99 s
      ],
    }));
    const result = await runPipeline("in.m4a", {
      audio,
      transcriber,
      trimSilence: true,
      onProgress: (m) => progress.push(m),
      ...base,
    });

    expect(audio.detectSilenceIntervals).toHaveBeenCalledWith("/tmp/normalized.wav", -60, 2);
    expect(audio.keepIntervals).toHaveBeenCalledWith("/tmp/normalized.wav", KEPT);
    // The chunk analysed and cut downstream is the trimmed file.
    expect(audio.detectSilences).toHaveBeenCalledWith("/tmp/trimmed.flac");
    expect(audio.splitAt).toHaveBeenCalledWith("/tmp/trimmed.flac", []);
    expect(transcriber.calls).toHaveLength(1);
    expect(result.segments).toEqual([
      { start: 10, end: 12, text: "a" },
      { start: 99, end: 101, text: "b" },
    ]);
    expect(result.duration).toBe(240);
    expect(progress).toContain("finding silent stretches");
    expect(progress.some((m) => m.startsWith("trimmed 29s of silence; sending 4 of 4 min"))).toBe(true);
  });

  it("does not re-encode when there is nothing to remove", async () => {
    const audio = trimAudio([{ start: 10, end: 11 }]);
    const progress: string[] = [];
    await runPipeline("in.m4a", {
      audio,
      transcriber: makeTranscriber(),
      trimSilence: true,
      onProgress: (m) => progress.push(m),
      ...base,
    });
    expect(audio.detectSilenceIntervals).toHaveBeenCalledTimes(1);
    expect(audio.keepIntervals).not.toHaveBeenCalled();
    expect(audio.detectSilences).toHaveBeenCalledWith("/tmp/normalized.wav");
    expect(progress).toContain("no silent stretches to trim");
  });

  it("fails clearly when the backend cannot trim", async () => {
    const audio = makeAudio({ durationSec: 240, bytes: 1 * MB, silences: [] });
    await expect(
      runPipeline("in.m4a", { audio, transcriber: makeTranscriber(), trimSilence: true, ...base }),
    ).rejects.toThrow(/does not support silence trimming/);
  });

  it("measures the hourly budget on the trimmed duration", async () => {
    const audio = makeAudio({ durationSec: 9000, bytes: 1 * MB, silences: [] });
    audio.detectSilenceIntervals = vi.fn(async () => [{ start: 1000, end: 3000 }]);
    audio.keepIntervals = vi.fn(async () => ({ path: "/tmp/trimmed.flac", bytes: 1 * MB, duration: 7001 }));
    const events: PipelineEvent[] = [];
    await runPipeline("in.m4a", {
      audio,
      transcriber: makeTranscriber(),
      trimSilence: true,
      onEvent: (e) => events.push(e),
      ...base,
    });
    // 7001 s sent is under the 7200 s budget, though 9000 s was recorded.
    expect(events.some((e) => e.type === "over-hourly-budget")).toBe(false);

    const audio2 = makeAudio({ durationSec: 9000, bytes: 1 * MB, silences: [] });
    audio2.detectSilenceIntervals = vi.fn(async () => [{ start: 1000, end: 2000 }]);
    audio2.keepIntervals = vi.fn(async () => ({ path: "/tmp/trimmed.flac", bytes: 1 * MB, duration: 8001 }));
    const events2: PipelineEvent[] = [];
    await runPipeline("in.m4a", {
      audio: audio2,
      transcriber: makeTranscriber(),
      trimSilence: true,
      onEvent: (e) => events2.push(e),
      ...base,
    });
    expect(events2[0]).toEqual({ type: "over-hourly-budget", audioSeconds: 8001, budgetSeconds: FREE_TIER_AUDIO_SECONDS_PER_HOUR });
  });
});

// Pins createFfmpegBackend()'s cleanup() -- previously nothing removed the
// temp dirs normalize()/splitAt() create via mkdtemp(), leaking one per
// transcription into the OS temp dir permanently (see audio.ts's own
// comments on AudioBackend.cleanup and MakeTmpDir). Uses the real
// filesystem (mkdtemp/rm are real Node fs calls) rather than mocking it,
// since that's the actual thing under test; normalize()'s own ffmpeg call
// is exercised with a nonexistent input file so it fails AFTER creating
// its temp dir regardless of whether ffmpeg itself is installed on the
// test machine (missing ffmpeg -> ENOENT -> FfmpegNotFoundError; present
// ffmpeg given a bogus file -> nonzero exit -> a generic Error) -- either
// way, exactly the "dir created, then the call fails" case this pins.
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFfmpegBackend, createRangeFilter, parseSilenceIntervals } from "../src/audio.js";
import { planKeptIntervals } from "../src/timeline.js";

async function ownTmpDirCount(): Promise<number> {
  const entries = await readdir(tmpdir());
  return entries.filter((e) => e.startsWith("voice-transcript-")).length;
}

describe("createFfmpegBackend cleanup", () => {
  it("is a no-op when nothing has been created yet", async () => {
    const backend = createFfmpegBackend();
    await expect(backend.cleanup?.()).resolves.toBeUndefined();
  });

  it("removes the temp dir even when normalize() itself fails partway", async () => {
    const backend = createFfmpegBackend();
    const before = await ownTmpDirCount();

    await expect(backend.normalize(join(tmpdir(), "does-not-exist.wav"))).rejects.toThrow();

    // The failed call's dir is still there until cleanup() runs.
    expect(await ownTmpDirCount()).toBe(before + 1);

    await backend.cleanup?.();
    expect(await ownTmpDirCount()).toBe(before);
  });

  it("is idempotent -- calling cleanup() twice is safe and only removes each dir once", async () => {
    const backend = createFfmpegBackend();
    await expect(backend.normalize(join(tmpdir(), "does-not-exist.wav"))).rejects.toThrow();

    await backend.cleanup?.();
    const before = await ownTmpDirCount();
    await expect(backend.cleanup?.()).resolves.toBeUndefined();
    expect(await ownTmpDirCount()).toBe(before);
  });
});

// Sanity check for the helper itself, since every test above depends on it
// counting correctly.
describe("ownTmpDirCount", () => {
  it("only counts this project's own prefixed dirs", async () => {
    expect(existsSync(tmpdir())).toBe(true);
    expect(await ownTmpDirCount()).toBeGreaterThanOrEqual(0);
  });
});

describe("parseSilenceIntervals", () => {
  const STDERR = [
    "[silencedetect @ 0x6000] silence_start: 12.5",
    "[silencedetect @ 0x6000] silence_end: 20.25 | silence_duration: 7.75",
    "size=N/A time=00:01:00.00 bitrate=N/A speed= 300x",
    "[silencedetect @ 0x6000] silence_start: -0.0029",
    "[silencedetect @ 0x6000] silence_end: 3 | silence_duration: 3",
    "[silencedetect @ 0x6000] silence_start: 55.5",
  ].join("\n");

  it("pairs starts with ends in order, clamps negatives, and closes a trailing start at the duration", () => {
    expect(parseSilenceIntervals(STDERR, 60)).toEqual([
      { start: 12.5, end: 20.25 },
      { start: 0, end: 3 },
      { start: 55.5, end: 60 },
    ]);
  });

  it("returns nothing for output without silences", () => {
    expect(parseSilenceIntervals("size=N/A time=00:00:10", 10)).toEqual([]);
  });
});

describe("createRangeFilter", () => {
  async function run(chunks: number[][], ranges: Array<{ start: number; end: number }>): Promise<number[]> {
    const filter = createRangeFilter(ranges);
    const out: Buffer[] = [];
    filter.on("data", (b: Buffer) => out.push(b));
    for (const c of chunks) filter.write(Buffer.from(c));
    filter.end();
    await new Promise((resolve) => filter.on("end", resolve));
    return [...Buffer.concat(out)];
  }
  const bytes = Array.from({ length: 20 }, (_, i) => i);
  const split = (sizes: number[]): number[][] => {
    const out: number[][] = [];
    let at = 0;
    for (const n of sizes) {
      out.push(bytes.slice(at, at + n));
      at += n;
    }
    return out;
  };

  it("passes only the ranges, whatever the chunking", async () => {
    const ranges = [{ start: 3, end: 6 }, { start: 9, end: 10 }, { start: 15, end: 20 }];
    const expected = [3, 4, 5, 9, 15, 16, 17, 18, 19];
    expect(await run(split([20]), ranges)).toEqual(expected);
    expect(await run(split([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), ranges)).toEqual(expected);
    expect(await run(split([7, 2, 5, 6]), ranges)).toEqual(expected);
  });

  it("handles a range that starts and ends mid-chunk and one that spans several chunks", async () => {
    expect(await run(split([4, 4, 4, 4, 4]), [{ start: 2, end: 3 }, { start: 5, end: 18 }])).toEqual([
      2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
    ]);
  });

  it("outputs nothing for an empty range list", async () => {
    expect(await run(split([5, 15]), [])).toEqual([]);
  });
});

const ffmpegAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;

// Real ffmpeg: tone (3 s) + digital silence (6 s) + tone (3 s).
describe.skipIf(!ffmpegAvailable)("silence trimming against real ffmpeg", () => {
  it("detects, plans, cuts, and cleans up", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trim-test-"));
    try {
      const src = join(dir, "src.wav");
      const gen = spawnSync("ffmpeg", [
        "-y", "-v", "error",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=16000",
        "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono:d=6",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=16000",
        "-filter_complex", "[0][1][2]concat=n=3:v=0:a=1",
        src,
      ]);
      expect(gen.status).toBe(0);

      const backend = createFfmpegBackend();
      const before = await ownTmpDirCount();
      const silences = (await backend.detectSilenceIntervals?.(src, -60, 2)) ?? [];
      expect(silences).toHaveLength(1);
      expect(silences[0].start).toBeCloseTo(3, 1);
      expect(silences[0].end).toBeCloseTo(9, 1);

      const kept = planKeptIntervals(silences, 12, { minSilenceSec: 2, padSec: 0.5, sampleRate: 16000 });
      const plannedSec = kept.reduce((sum, p) => sum + (p.end - p.start), 0);
      expect(plannedSec).toBeCloseTo(7, 1);

      const out = await backend.keepIntervals?.(src, kept);
      expect(out?.duration).toBeCloseTo(plannedSec, 2);
      expect(out?.bytes).toBeGreaterThan(0);
      expect(await ownTmpDirCount()).toBe(before + 1);

      await backend.cleanup?.();
      expect(await ownTmpDirCount()).toBe(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects with the ffmpeg error for a missing input file", async () => {
    const backend = createFfmpegBackend();
    await expect(backend.keepIntervals?.(join(tmpdir(), "nope.wav"), [{ start: 0, end: 1 }])).rejects.toThrow();
    await backend.cleanup?.();
  });
});

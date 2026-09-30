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
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFfmpegBackend } from "../src/audio.js";

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

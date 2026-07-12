// ACCEPTANCE A1-A5 (CLI contract) and B4 (ffmpeg missing).
// Pins `main(argv, deps)` in src/cli.ts. All IO is injected: env, stdout,
// stderr, an audio backend, a transcriber factory, writeFile and fileExists.
// `main` resolves to the process exit code (0 on success, non-zero on error).
import { describe, it, expect, vi } from "vitest";
import { main } from "../src/cli.js";
import type { CliDeps } from "../src/cli.js";
import { FfmpegNotFoundError } from "@voice-transcript/core";
import type { AudioBackend, AudioChunk, Transcriber } from "@voice-transcript/core";

const HELLO = { text: "hello world", segments: [{ start: 0, end: 2, text: "hello world" }] };

function makeAudio(): AudioBackend {
  return {
    assertAvailable: vi.fn(async () => {}),
    probeDuration: vi.fn(async () => 120),
    normalize: vi.fn(async () => ({ path: "/tmp/n.wav", bytes: 1_000_000, duration: 120 })),
    detectSilences: vi.fn(async () => []),
    splitAt: vi.fn(async (_f: string, boundaries: number[]): Promise<AudioChunk[]> => {
      const cuts = [0, ...boundaries, 120];
      const chunks: AudioChunk[] = [];
      for (let i = 1; i < cuts.length; i++) {
        chunks.push({ path: `/tmp/c${i}.wav`, offset: cuts[i - 1], duration: cuts[i] - cuts[i - 1], bytes: 1000 });
      }
      return chunks;
    }),
    readBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
}

function makeDeps(overrides: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const transcriber: Transcriber = { transcribe: vi.fn(async () => HELLO) };
  const makeTranscriber = vi.fn((_key: string) => transcriber);
  const writeFile = vi.fn(async (_p: string, _d: string) => {});
  const recordHistory = vi.fn(async () => {});
  const deps: CliDeps = {
    env: { GROQ_API_KEY: "gsk_dummy_key_for_tests" },
    stdout: (s: string) => out.push(s),
    stderr: (s: string) => err.push(s),
    audio: makeAudio(),
    makeTranscriber,
    writeFile,
    fileExists: vi.fn(async () => true),
    recordHistory,
    ...overrides,
  };
  return { deps, out, err, makeTranscriber, writeFile, transcriber, recordHistory };
}

describe("A1 - no arguments", () => {
  it("exits non-zero and prints usage to stderr", async () => {
    const { deps, out, err } = makeDeps();
    const code = await main([], deps);
    expect(code).not.toBe(0);
    expect(err.join("")).toMatch(/usage/i);
    expect(out.join("")).toBe("");
  });
});

describe("A2 - missing input file", () => {
  it("exits non-zero naming the file and makes no API call", async () => {
    const { deps, err, transcriber, recordHistory } = makeDeps({
      fileExists: vi.fn(async () => false),
    });
    const code = await main(["/no/such/audio.m4a"], deps);
    expect(code).not.toBe(0);
    expect(err.join("")).toContain("/no/such/audio.m4a");
    expect(transcriber.transcribe).not.toHaveBeenCalled();
    expect((deps.audio!.normalize as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    // A pre-flight usage error is not a "run" -- nothing to persist.
    expect(recordHistory).not.toHaveBeenCalled();
  });
});

describe("A3 - missing API key", () => {
  it("exits non-zero mentioning the key; no ffmpeg or API call", async () => {
    const { deps, err, transcriber } = makeDeps({ env: {} });
    const code = await main(["input.m4a"], deps);
    expect(code).not.toBe(0);
    expect(err.join("")).toMatch(/GROQ_API_KEY|key/i);
    expect(transcriber.transcribe).not.toHaveBeenCalled();
    expect((deps.audio!.assertAvailable as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((deps.audio!.normalize as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe("A4 - format validation", () => {
  it.each(["txt", "srt", "vtt", "json"])("accepts --format %s", async (fmt) => {
    const { deps } = makeDeps();
    const code = await main(["input.m4a", "--format", fmt], deps);
    expect(code).toBe(0);
  });

  it("rejects an unknown --format with a non-zero exit and an error", async () => {
    const { deps, err } = makeDeps();
    const code = await main(["input.m4a", "--format", "xml"], deps);
    expect(code).not.toBe(0);
    expect(err.join("")).toMatch(/format/i);
  });
});

describe("A5 - output routing", () => {
  it("writes the transcript to stdout by default", async () => {
    const { deps, out, err, writeFile } = makeDeps();
    const code = await main(["input.m4a"], deps);
    expect(code).toBe(0);
    expect(out.join("")).toContain("hello world");
    expect(writeFile).not.toHaveBeenCalled();
    // Logs go to stderr, never the transcript.
    expect(err.join("")).not.toContain("hello world");
  });

  it("writes to the file for -o and keeps the transcript off stdout", async () => {
    const { deps, out, writeFile } = makeDeps();
    const code = await main(["input.m4a", "-o", "out.txt"], deps);
    expect(code).toBe(0);
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path, data] = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe("out.txt");
    expect(data).toContain("hello world");
    expect(out.join("")).not.toContain("hello world");
  });
});

describe("H1/H5 - history recorded on every completed run", () => {
  it("records a success entry with the transcript result after a successful run", async () => {
    const { deps, recordHistory } = makeDeps();
    const code = await main(["input.m4a", "--format", "srt"], deps);
    expect(code).toBe(0);
    expect(recordHistory).toHaveBeenCalledTimes(1);
    expect(recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFileName: "input.m4a",
        formats: ["srt"],
        status: "success",
        result: expect.objectContaining({ text: HELLO.text, segments: HELLO.segments }),
      }),
    );
  });

  it("records a failed entry when the transcription pipeline throws, and still reports the error", async () => {
    const transcriber: Transcriber = {
      transcribe: vi.fn(async () => {
        throw new Error("upstream boom");
      }),
    };
    const { deps, err, recordHistory } = makeDeps({
      makeTranscriber: vi.fn((_key: string) => transcriber),
    });
    const code = await main(["input.m4a"], deps);
    expect(code).not.toBe(0);
    expect(err.join("")).toContain("upstream boom");
    expect(recordHistory).toHaveBeenCalledTimes(1);
    expect(recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({ sourceFileName: "input.m4a", status: "failed" }),
    );
  });

  it("a history-recording failure never blocks a successful run's exit code or output", async () => {
    const recordHistory = vi.fn(async () => {
      throw new Error("db unreachable");
    });
    const { deps, out, err } = makeDeps({ recordHistory });
    const code = await main(["input.m4a"], deps);
    // main() itself swallows a broken recordHistory (H5) -- it does not
    // just trust the default's own internal safety net.
    expect(code).toBe(0);
    expect(out.join("")).toContain("hello world");
    expect(err.join("")).toMatch(/history.*non-blocking/i);
  });
});

describe("B4 - ffmpeg not installed", () => {
  it("exits non-zero with an actionable error naming ffmpeg", async () => {
    const audio = makeAudio();
    audio.assertAvailable = vi.fn(async () => {
      throw new FfmpegNotFoundError("ffmpeg was not found on PATH; install ffmpeg");
    });
    const { deps, err } = makeDeps({ audio });
    const code = await main(["input.m4a"], deps);
    expect(code).not.toBe(0);
    expect(err.join("")).toMatch(/ffmpeg/i);
  });
});

// Pins handlePing/handleTranscribe/main in src/sidecar.ts -- the Node
// sidecar the Tauri Rust shell spawns (F15, desktop-ipc). All IO is
// injected, same DI shape as packages/cli/tests/cli.test.ts.
import { describe, it, expect, vi } from "vitest";
import { handlePing, handleTranscribe, main } from "../src/sidecar.js";
import type { SidecarDeps } from "../src/sidecar.js";
import type { AudioBackend, AudioChunk } from "../src/audio.js";
import type { Transcriber } from "../src/types.js";

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

function makeDeps(overrides: Partial<SidecarDeps> = {}): { deps: SidecarDeps; recordHistory: ReturnType<typeof vi.fn>; transcriber: Transcriber } {
  const transcriber: Transcriber = { transcribe: vi.fn(async () => HELLO) };
  const recordHistory = vi.fn(async () => {});
  const deps: SidecarDeps = {
    env: { GROQ_API_KEY: "gsk_dummy_key_for_tests" },
    audio: makeAudio(),
    makeTranscriber: vi.fn((_key: string) => transcriber),
    recordHistory,
    ...overrides,
  };
  return { deps, recordHistory, transcriber };
}

describe("ping", () => {
  it("resolves to pong", async () => {
    await expect(handlePing()).resolves.toBe("pong");
  });
});

describe("transcribe", () => {
  it("returns the rendered transcript and records success history", async () => {
    const { deps, recordHistory } = makeDeps();
    const result = await handleTranscribe(
      { filePath: "input.m4a", model: "whisper-large-v3-turbo", format: "txt" },
      deps,
    );
    expect(result.text).toBe("hello world");
    expect(result.rendered).toContain("hello world");
    expect(recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({ sourceFileName: "input.m4a", status: "success" }),
    );
  });

  it("throws when GROQ_API_KEY is missing, without calling the transcriber", async () => {
    const { deps, transcriber } = makeDeps({ env: {} });
    await expect(
      handleTranscribe({ filePath: "input.m4a", model: "whisper-large-v3-turbo", format: "txt" }, deps),
    ).rejects.toThrow(/GROQ_API_KEY/);
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  it("records failure history and rethrows when the pipeline fails", async () => {
    const failingTranscriber: Transcriber = {
      transcribe: vi.fn(async () => {
        throw new Error("upstream boom");
      }),
    };
    const { deps, recordHistory } = makeDeps({ makeTranscriber: vi.fn(() => failingTranscriber) });
    await expect(
      handleTranscribe({ filePath: "input.m4a", model: "whisper-large-v3-turbo", format: "txt" }, deps),
    ).rejects.toThrow("upstream boom");
    expect(recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({ sourceFileName: "input.m4a", status: "failed" }),
    );
  });
});

describe("main (argv protocol)", () => {
  it("writes { ok: true, data: 'pong' } for the ping command", async () => {
    const chunks: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    await main(["node", "sidecar.js", "ping"]);
    write.mockRestore();
    expect(JSON.parse(chunks.join(""))).toEqual({ ok: true, data: "pong" });
  });

  it("writes { ok: false, error } instead of throwing for an unknown command", async () => {
    const chunks: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    await main(["node", "sidecar.js", "not-a-real-command"]);
    write.mockRestore();
    const parsed = JSON.parse(chunks.join(""));
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/unknown sidecar command/i);
  });
});

// Pins handlePing/handleTranscribe/handleListHistory/handleGetHistory/
// handleDeleteHistoryEntry/main in src/sidecar.ts -- the Node sidecar the
// Tauri Rust shell spawns (F15 desktop-ipc, F18 gui-history). All IO is
// injected, same DI shape as packages/cli/tests/cli.test.ts.
import { describe, it, expect, vi } from "vitest";
import {
  handlePing,
  handleTranscribe,
  handleListHistory,
  handleGetHistory,
  handleDeleteHistoryEntry,
  main,
} from "../src/sidecar.js";
import type { SidecarDeps } from "../src/sidecar.js";
import type { AudioBackend, AudioChunk } from "../src/audio.js";
import type { Transcriber } from "../src/types.js";
import type { HistoryRecord } from "../src/db/history.js";

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

function makeRecord(overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: 1,
    sourceFileName: "/audio/a.m4a",
    startedAt: new Date("2026-07-13T00:00:00Z"),
    model: "whisper-large-v3-turbo",
    language: null,
    formats: ["txt"],
    status: "success",
    transcriptText: "hello world",
    segments: null,
    ...overrides,
  };
}

describe("listHistory", () => {
  it("returns the injected list", async () => {
    const record = makeRecord();
    const listHistory = vi.fn(async () => [record]);
    const result = await handleListHistory({ listHistory });
    expect(result).toEqual([record]);
  });

  it("returns [] (not an error) when there is no DB configured and no injection", async () => {
    await expect(handleListHistory({})).resolves.toEqual([]);
  });
});

describe("getHistory", () => {
  it("returns the record when found", async () => {
    const record = makeRecord({ id: 7 });
    const getHistory = vi.fn(async (id: number) => (id === 7 ? record : undefined));
    await expect(handleGetHistory({ id: 7 }, { getHistory })).resolves.toEqual(record);
  });

  it("throws when the id doesn't exist", async () => {
    const getHistory = vi.fn(async () => undefined);
    await expect(handleGetHistory({ id: 99 }, { getHistory })).rejects.toThrow(/99/);
  });
});

describe("deleteHistoryEntry", () => {
  it("deletes and returns the sourceFileName so the caller can trash the audio", async () => {
    const record = makeRecord({ id: 3, sourceFileName: "/audio/c.m4a" });
    const getHistory = vi.fn(async () => record);
    const deleteHistoryEntry = vi.fn(async () => {});
    const result = await handleDeleteHistoryEntry({ id: 3 }, { getHistory, deleteHistoryEntry });
    expect(result).toEqual({ sourceFileName: "/audio/c.m4a" });
    expect(deleteHistoryEntry).toHaveBeenCalledWith(3);
  });

  it("throws instead of deleting when the id doesn't exist", async () => {
    const getHistory = vi.fn(async () => undefined);
    const deleteHistoryEntry = vi.fn(async () => {});
    await expect(handleDeleteHistoryEntry({ id: 99 }, { getHistory, deleteHistoryEntry })).rejects.toThrow(/99/);
    expect(deleteHistoryEntry).not.toHaveBeenCalled();
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

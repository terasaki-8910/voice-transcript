// Pins handlePing/handleTranscribe/handleListHistory/handleGetHistory/
// handleDeleteHistoryEntry/main in src/sidecar.ts -- the Node sidecar the
// Tauri Rust shell spawns (F15 desktop-ipc, F18 gui-history). All IO is
// injected, same DI shape as packages/cli/tests/cli.test.ts.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  handlePing,
  handleTranscribe,
  handleListHistory,
  handleGetHistory,
  handleDeleteHistoryEntry,
  handleListDictionary,
  handleAddDictionaryEntry,
  handleUpdateDictionaryEntry,
  handleDeleteDictionaryEntry,
  handleImportDictionary,
  handleListNotes,
  handleAddNote,
  handleUpdateNote,
  handleDeleteNote,
  parseDictionaryImport,
  main,
} from "../src/sidecar.js";
import type { SidecarDeps } from "../src/sidecar.js";
import type { AudioBackend, AudioChunk } from "../src/audio.js";
import type { Transcriber } from "../src/types.js";
import type { HistoryRecord } from "../src/db/history.js";
import type { DictionaryRecord } from "../src/db/dictionary.js";
import type { TranscriptNoteRecord } from "../src/db/notes.js";

const HELLO = { text: "hello world", segments: [{ start: 0, end: 2, text: "hello world" }] };

// handleListHistory/handleGetHistory/handleDeleteHistoryEntry fall back to
// createDb(), which reads DATABASE_URL straight from process.env (db/
// client.ts) rather than an injected value. A developer machine or CI
// runner with DATABASE_URL exported ambiently (e.g. a shared Postgres used
// by other projects) would otherwise leak into the "no DB configured" cases
// below and have them try a real network connection instead of taking the
// undefined-db branch. Stub it out for every test in this file and restore
// the ambient value afterwards.
afterEach(() => {
  vi.unstubAllEnvs();
});

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

// listDictionary defaults to [] here for the same reason recordHistory
// defaults to a mock: handleTranscribe now also fetches the dictionary on
// every call (fetchDictionarySafe), and without a stub it would fall
// through to a real createDb() + network call, same class of ambient-env
// leak the file-level DATABASE_URL comment above already warns about.
function makeDeps(overrides: Partial<SidecarDeps> = {}): { deps: SidecarDeps; recordHistory: ReturnType<typeof vi.fn>; transcriber: Transcriber } {
  const transcriber: Transcriber = { transcribe: vi.fn(async () => HELLO) };
  const recordHistory = vi.fn(async () => 1);
  const deps: SidecarDeps = {
    env: { GROQ_API_KEY: "gsk_dummy_key_for_tests" },
    audio: makeAudio(),
    makeTranscriber: vi.fn((_key: string) => transcriber),
    recordHistory,
    listDictionary: vi.fn(async () => []),
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
    // The transcriptions.id recordHistory returns -- transcript notes
    // anchor to this, so the GUI needs it back on the response itself, not
    // only from a later listHistory() call.
    expect(result.id).toBe(1);
    expect(recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({ sourceFileName: "input.m4a", status: "success" }),
    );
  });

  it("omits id when recordHistory records nothing (no DB configured)", async () => {
    const { deps } = makeDeps({ recordHistory: vi.fn(async () => undefined) });
    const result = await handleTranscribe(
      { filePath: "input.m4a", model: "whisper-large-v3-turbo", format: "txt" },
      deps,
    );
    expect(result.id).toBeUndefined();
  });

  it("throws when GROQ_API_KEY is missing, without calling the transcriber", async () => {
    const { deps, transcriber } = makeDeps({ env: {} });
    await expect(
      handleTranscribe({ filePath: "input.m4a", model: "whisper-large-v3-turbo", format: "txt" }, deps),
    ).rejects.toThrow(/GROQ_API_KEY/);
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  it("applies the custom dictionary to the result before rendering/recording history", async () => {
    const listDictionary = vi.fn(async () => [makeDictionaryRecord({ word: "hello", replacement: "HI" })]);
    const { deps, recordHistory } = makeDeps({ listDictionary });
    const result = await handleTranscribe(
      { filePath: "input.m4a", model: "whisper-large-v3-turbo", format: "txt" },
      deps,
    );
    expect(result.text).toBe("HI world");
    expect(result.rendered).toContain("HI world");
    expect(recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({ result: expect.objectContaining({ text: "HI world" }) }),
    );
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
    noteCount: 0,
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
    vi.stubEnv("DATABASE_URL", undefined);
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

function makeDictionaryRecord(overrides: Partial<DictionaryRecord> = {}): DictionaryRecord {
  return {
    id: 1,
    word: "スパークル",
    replacement: "SPARQL",
    createdAt: new Date("2026-07-13T00:00:00Z"),
    updatedAt: new Date("2026-07-13T00:00:00Z"),
    ...overrides,
  };
}

describe("listDictionary", () => {
  it("returns the injected list", async () => {
    const record = makeDictionaryRecord();
    const listDictionary = vi.fn(async () => [record]);
    await expect(handleListDictionary({ listDictionary })).resolves.toEqual([record]);
  });

  it("returns [] (not an error) when there is no DB configured and no injection", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    await expect(handleListDictionary({})).resolves.toEqual([]);
  });
});

describe("addDictionaryEntry", () => {
  it("adds and returns the new record", async () => {
    const record = makeDictionaryRecord({ id: 5, word: "cloud.md", replacement: "CLAUDE.md" });
    const addDictionaryEntry = vi.fn(async () => record);
    const result = await handleAddDictionaryEntry(
      { word: "cloud.md", replacement: "CLAUDE.md" },
      { addDictionaryEntry },
    );
    expect(result).toEqual(record);
    expect(addDictionaryEntry).toHaveBeenCalledWith({ word: "cloud.md", replacement: "CLAUDE.md" });
  });
});

describe("updateDictionaryEntry", () => {
  it("updates and returns the record", async () => {
    const record = makeDictionaryRecord({ id: 2, replacement: "updated" });
    const updateDictionaryEntry = vi.fn(async () => record);
    const result = await handleUpdateDictionaryEntry(
      { id: 2, word: "スパークル", replacement: "updated" },
      { updateDictionaryEntry },
    );
    expect(result).toEqual(record);
    expect(updateDictionaryEntry).toHaveBeenCalledWith(2, { word: "スパークル", replacement: "updated" });
  });

  it("throws when the id doesn't exist", async () => {
    const updateDictionaryEntry = vi.fn(async () => undefined);
    await expect(
      handleUpdateDictionaryEntry({ id: 99, word: "x", replacement: "y" }, { updateDictionaryEntry }),
    ).rejects.toThrow(/99/);
  });
});

describe("deleteDictionaryEntry", () => {
  it("deletes and returns the id", async () => {
    const deleteDictionaryEntry = vi.fn(async () => {});
    await expect(handleDeleteDictionaryEntry({ id: 4 }, { deleteDictionaryEntry })).resolves.toEqual({ id: 4 });
    expect(deleteDictionaryEntry).toHaveBeenCalledWith(4);
  });
});

function makeNoteRecord(overrides: Partial<TranscriptNoteRecord> = {}): TranscriptNoteRecord {
  return {
    id: 1,
    transcriptionId: 10,
    startOffset: 4,
    endOffset: 11,
    quotedText: "2GOMCP",
    note: "正しくはTogoMCP",
    createdAt: new Date("2026-09-25T00:00:00Z"),
    updatedAt: new Date("2026-09-25T00:00:00Z"),
    ...overrides,
  };
}

describe("listNotes", () => {
  it("returns the injected list for the given transcription", async () => {
    const record = makeNoteRecord();
    const listNotes = vi.fn(async () => [record]);
    await expect(handleListNotes({ transcriptionId: 10 }, { listNotes })).resolves.toEqual([record]);
    expect(listNotes).toHaveBeenCalledWith(10);
  });

  it("returns [] (not an error) when there is no DB configured and no injection", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    await expect(handleListNotes({ transcriptionId: 10 }, {})).resolves.toEqual([]);
  });
});

describe("addNote", () => {
  it("adds and returns the new record", async () => {
    const record = makeNoteRecord();
    const addNote = vi.fn(async () => record);
    const args = { transcriptionId: 10, startOffset: 4, endOffset: 11, quotedText: "2GOMCP", note: "正しくはTogoMCP" };
    await expect(handleAddNote(args, { addNote })).resolves.toEqual(record);
    expect(addNote).toHaveBeenCalledWith(args);
  });

  it("rejects a range where end does not come after start", async () => {
    const addNote = vi.fn(async () => makeNoteRecord());
    await expect(
      handleAddNote({ transcriptionId: 10, startOffset: 5, endOffset: 5, quotedText: "x", note: "y" }, { addNote }),
    ).rejects.toThrow(/range/i);
    expect(addNote).not.toHaveBeenCalled();
  });

  it("rejects a negative start offset", async () => {
    const addNote = vi.fn(async () => makeNoteRecord());
    await expect(
      handleAddNote({ transcriptionId: 10, startOffset: -1, endOffset: 3, quotedText: "x", note: "y" }, { addNote }),
    ).rejects.toThrow(/range/i);
    expect(addNote).not.toHaveBeenCalled();
  });
});

describe("updateNote", () => {
  it("updates and returns the record -- the anchor (offsets/quotedText) is untouched", async () => {
    const record = makeNoteRecord({ note: "updated note" });
    const updateNote = vi.fn(async () => record);
    await expect(handleUpdateNote({ id: 1, note: "updated note" }, { updateNote })).resolves.toEqual(record);
    expect(updateNote).toHaveBeenCalledWith(1, "updated note");
  });

  it("throws when the id doesn't exist", async () => {
    const updateNote = vi.fn(async () => undefined);
    await expect(handleUpdateNote({ id: 99, note: "x" }, { updateNote })).rejects.toThrow(/99/);
  });
});

describe("deleteNote", () => {
  it("deletes and returns the id", async () => {
    const deleteNote = vi.fn(async () => {});
    await expect(handleDeleteNote({ id: 7 }, { deleteNote })).resolves.toEqual({ id: 7 });
    expect(deleteNote).toHaveBeenCalledWith(7);
  });
});

describe("parseDictionaryImport", () => {
  it("parses an Amical export, mapping replacement_word and skipping non-replacement entries", () => {
    const json = JSON.stringify({
      source_device: "windows",
      count: 2,
      entries: [
        { word: "スパークル", replacement_word: "SPARQL", is_replacement: 1 },
        { word: "vocab-hint-only", replacement_word: "", is_replacement: 0 },
      ],
    });
    expect(parseDictionaryImport(json)).toEqual({
      entries: [{ word: "スパークル", replacement: "SPARQL" }],
      skipped: 1,
    });
  });

  it("parses the plain [{ word, replacement }] shape", () => {
    const json = JSON.stringify([{ word: "a", replacement: "b" }]);
    expect(parseDictionaryImport(json)).toEqual({ entries: [{ word: "a", replacement: "b" }], skipped: 0 });
  });

  it("throws on an unrecognized shape", () => {
    expect(() => parseDictionaryImport(JSON.stringify({ nope: true }))).toThrow(/unrecognized/i);
  });

  // tauri-capability-reviewer finding (defense-in-depth): Node's own
  // SyntaxError for invalid JSON embeds a snippet of the offending input
  // (e.g. `Unexpected token 'g', "gsk_123"... is not valid JSON`), which
  // this app's Rust side would otherwise surface verbatim to the webview.
  // A clean, fixed message must never leak any part of the input.
  it("throws a clean, fixed message on invalid JSON -- never the raw input", () => {
    expect(() => parseDictionaryImport("gsk_not_actually_json_1234567890")).toThrow(
      "Not a valid dictionary JSON file.",
    );
    try {
      parseDictionaryImport("gsk_not_actually_json_1234567890");
    } catch (err) {
      expect(String(err)).not.toContain("gsk_");
    }
  });
});

describe("importDictionary", () => {
  it("parses and imports, folding any skipped-by-parse count into the result", async () => {
    const importDictionary = vi.fn(async () => ({ inserted: 1, updated: 0, skipped: 0 }));
    const json = JSON.stringify({
      entries: [
        { word: "a", replacement_word: "b", is_replacement: 1 },
        { word: "hint", replacement_word: "", is_replacement: 0 },
      ],
    });
    const result = await handleImportDictionary({ json }, { importDictionary });
    expect(importDictionary).toHaveBeenCalledWith([{ word: "a", replacement: "b" }]);
    expect(result).toEqual({ inserted: 1, updated: 0, skipped: 1 });
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

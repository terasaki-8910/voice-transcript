// ACCEPTANCE H6: durable outbox for history records the database could not
// take. Real temp dirs for the outbox; recordHistory/ensureSchema/listDictionary
// are mocked so no database is needed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, readFile, stat, writeFile, mkdir, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/db/history.js", () => ({ recordHistory: vi.fn() }));
vi.mock("../src/db/migrate.js", () => ({ ensureSchema: vi.fn() }));
vi.mock("../src/db/dictionary.js", () => ({ listDictionary: vi.fn() }));

import { recordHistory } from "../src/db/history.js";
import { ensureSchema } from "../src/db/migrate.js";
import { listDictionary } from "../src/db/dictionary.js";
import {
  pendingHistoryDir,
  savePendingHistory,
  flushPendingHistory,
  recordHistoryOrDefer,
} from "../src/db/pending.js";
import type { Db } from "../src/db/client.js";
import type { HistoryRecordInput } from "../src/db/history.js";

const db = {} as Db;
const mockRecord = vi.mocked(recordHistory);
const mockSchema = vi.mocked(ensureSchema);
const mockDict = vi.mocked(listDictionary);

function input(name: string, text = "hello world"): HistoryRecordInput {
  return {
    sourceFileName: name,
    model: "m",
    formats: ["txt"],
    status: "success",
    result: { text, segments: [{ start: 0, end: 1, text }] },
  };
}

let dir: string;
beforeEach(async () => {
  dir = join(await mkdtemp(join(tmpdir(), "vt-pending-")), "pending");
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(join(dir, ".."), { recursive: true, force: true });
});

describe("pendingHistoryDir", () => {
  it("honours the env override", () => {
    expect(pendingHistoryDir({ VOICE_TRANSCRIPT_PENDING_DIR: "/x/y" }, "linux", "/h")).toBe("/x/y");
  });
  it("resolves macOS", () => {
    expect(pendingHistoryDir({}, "darwin", "/Users/a")).toBe(
      "/Users/a/Library/Application Support/voice-transcript/pending-history",
    );
  });
  it("resolves Windows from APPDATA, falling back to AppData/Roaming", () => {
    expect(pendingHistoryDir({ APPDATA: "/R" }, "win32", "/h")).toBe("/R/voice-transcript/pending-history");
    expect(pendingHistoryDir({}, "win32", "/h")).toBe("/h/AppData/Roaming/voice-transcript/pending-history");
  });
  it("resolves Linux from XDG_DATA_HOME or ~/.local/share", () => {
    expect(pendingHistoryDir({ XDG_DATA_HOME: "/xdg" }, "linux", "/h")).toBe("/xdg/voice-transcript/pending-history");
    expect(pendingHistoryDir({}, "linux", "/h")).toBe("/h/.local/share/voice-transcript/pending-history");
  });
});

describe("savePendingHistory", () => {
  it("writes an owner-only JSON file atomically", async () => {
    const startedAt = new Date("2026-10-13T01:02:03.456Z");
    await savePendingHistory(dir, { startedAt, dictionaryApplied: false, input: { ...input("a.m4a"), startedAt } });
    const names = await readdir(dir);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^2026-10-13T01-02-03-456Z-[0-9a-f]+\.json$/);
    expect((await stat(join(dir, names[0]))).mode & 0o777).toBe(0o600);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    const body = JSON.parse(await readFile(join(dir, names[0]), "utf8"));
    expect(body).toMatchObject({ version: 1, startedAt: startedAt.toISOString(), dictionaryApplied: false });
    expect(body.input.sourceFileName).toBe("a.m4a");
    expect(body.input.startedAt).toBeUndefined();
  });
});

describe("flushPendingHistory", () => {
  it("does nothing, and never touches the DB, for a missing or empty dir", async () => {
    await expect(flushPendingHistory(db, dir)).resolves.toEqual({ saved: 0, remaining: 0 });
    await mkdir(dir, { recursive: true });
    await expect(flushPendingHistory(db, dir)).resolves.toEqual({ saved: 0, remaining: 0 });
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("inserts in chronological order with the original startedAt and deletes the files", async () => {
    const t1 = new Date("2026-10-13T01:00:00Z");
    const t2 = new Date("2026-10-13T02:00:00Z");
    await savePendingHistory(dir, { startedAt: t2, dictionaryApplied: true, input: input("second") });
    await savePendingHistory(dir, { startedAt: t1, dictionaryApplied: true, input: input("first") });
    mockRecord.mockResolvedValue(1);
    await expect(flushPendingHistory(db, dir)).resolves.toEqual({ saved: 2, remaining: 0 });
    expect(mockRecord.mock.calls.map((c) => [c[1].sourceFileName, c[1].startedAt])).toEqual([
      ["first", t1],
      ["second", t2],
    ]);
    expect(await readdir(dir)).toEqual([]);
  });

  it("stops and keeps the remaining files on an insert error", async () => {
    for (const [i, n] of ["a", "b", "c"].entries()) {
      await savePendingHistory(dir, {
        startedAt: new Date(Date.UTC(2026, 9, 13, i)),
        dictionaryApplied: true,
        input: input(n),
      });
    }
    mockRecord.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error("down"));
    await expect(flushPendingHistory(db, dir)).resolves.toEqual({ saved: 1, remaining: 2 });
    expect(mockRecord).toHaveBeenCalledTimes(2);
    expect(await readdir(dir)).toHaveLength(2);
  });

  it("sets aside a record that keeps failing so it cannot block the ones behind it", async () => {
    await savePendingHistory(dir, { startedAt: new Date(Date.UTC(2026, 9, 13, 0)), dictionaryApplied: true, input: input("poison") });
    await savePendingHistory(dir, { startedAt: new Date(Date.UTC(2026, 9, 13, 1)), dictionaryApplied: true, input: input("ok") });
    mockRecord.mockImplementation(async (_db, rec) => {
      if (rec.sourceFileName === "poison") throw new Error("value too long");
      return 7;
    });
    for (let i = 0; i < 4; i++) {
      await expect(flushPendingHistory(db, dir)).resolves.toEqual({ saved: 0, remaining: 2 });
    }
    // The fifth failure gives up on it, and the next record goes in.
    await expect(flushPendingHistory(db, dir)).resolves.toEqual({ saved: 1, remaining: 0 });
    const left = await readdir(dir);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatch(/\.json\.bad$/);
    expect(JSON.parse(await readFile(join(dir, left[0]), "utf8")).attempts).toBe(4);
  });

  it("renames a corrupt file to .bad and still flushes the rest", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "0000-corrupt.json"), "{not json");
    await writeFile(join(dir, "0001-old.json"), JSON.stringify({ version: 99, startedAt: "x", input: {} }));
    await savePendingHistory(dir, { startedAt: new Date(), dictionaryApplied: true, input: input("ok") });
    mockRecord.mockResolvedValue(1);
    await expect(flushPendingHistory(db, dir)).resolves.toEqual({ saved: 1, remaining: 0 });
    expect((await readdir(dir)).sort()).toEqual(["0000-corrupt.json.bad", "0001-old.json.bad"]);
  });

  it("does nothing while another flusher holds a fresh lock", async () => {
    await savePendingHistory(dir, { startedAt: new Date(), dictionaryApplied: true, input: input("a") });
    await writeFile(join(dir, ".lock"), "");
    await expect(flushPendingHistory(db, dir)).resolves.toEqual({ saved: 0, remaining: 1 });
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("takes over a stale lock and removes the lock afterwards", async () => {
    await savePendingHistory(dir, { startedAt: new Date(), dictionaryApplied: true, input: input("a") });
    const lock = join(dir, ".lock");
    await writeFile(lock, "");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    await utimes(lock, old, old);
    mockRecord.mockResolvedValue(1);
    await expect(flushPendingHistory(db, dir)).resolves.toEqual({ saved: 1, remaining: 0 });
    expect(await readdir(dir)).toEqual([]);
  });

  it("releases the lock even when a record fails", async () => {
    await savePendingHistory(dir, { startedAt: new Date(), dictionaryApplied: true, input: input("a") });
    mockRecord.mockRejectedValue(new Error("down"));
    await flushPendingHistory(db, dir);
    expect(await readdir(dir)).not.toContain(".lock");
  });

  it("applies the dictionary only to records that lack it, loading it once", async () => {
    await savePendingHistory(dir, { startedAt: new Date(Date.UTC(2026, 9, 13, 1)), dictionaryApplied: false, input: input("a") });
    await savePendingHistory(dir, { startedAt: new Date(Date.UTC(2026, 9, 13, 2)), dictionaryApplied: false, input: input("b") });
    await savePendingHistory(dir, { startedAt: new Date(Date.UTC(2026, 9, 13, 3)), dictionaryApplied: true, input: input("c") });
    mockRecord.mockResolvedValue(1);
    const loadDictionary = vi.fn(async () => [{ word: "hello", replacement: "HI" }]);
    await flushPendingHistory(db, dir, { loadDictionary });
    expect(loadDictionary).toHaveBeenCalledTimes(1);
    expect(mockRecord.mock.calls.map((c) => c[1].result?.text)).toEqual(["HI world", "HI world", "hello world"]);
  });

  it("does not load the dictionary when every record already has it", async () => {
    await savePendingHistory(dir, { startedAt: new Date(), dictionaryApplied: true, input: input("a") });
    mockRecord.mockResolvedValue(1);
    const loadDictionary = vi.fn(async () => []);
    await flushPendingHistory(db, dir, { loadDictionary });
    expect(loadDictionary).not.toHaveBeenCalled();
  });
});

describe("recordHistoryOrDefer", () => {
  const opts = () => ({ pendingDir: dir, dictionaryApplied: true });

  it("returns pending: false and writes no file when there is no DB", async () => {
    await expect(recordHistoryOrDefer(undefined, input("a"), opts())).resolves.toEqual({ pending: false });
    await expect(readdir(dir)).rejects.toThrow();
  });

  it("returns the id and flushes earlier deferred records after a successful write", async () => {
    await savePendingHistory(dir, { startedAt: new Date(0), dictionaryApplied: true, input: input("older") });
    mockRecord.mockResolvedValueOnce(7).mockResolvedValue(8);
    mockDict.mockResolvedValue([]);
    await expect(recordHistoryOrDefer(db, input("new"), opts())).resolves.toEqual({ id: 7, pending: false });
    expect(mockRecord.mock.calls.map((c) => c[1].sourceFileName)).toEqual(["new", "older"]);
    expect(await readdir(dir)).toEqual([]);
  });

  it("defers to the outbox when the write fails", async () => {
    mockSchema.mockRejectedValue(new Error("ETIMEDOUT"));
    const startedAt = new Date("2026-10-13T00:00:00Z");
    await expect(recordHistoryOrDefer(db, { ...input("a"), startedAt }, { ...opts(), dictionaryApplied: false })).resolves.toEqual({
      pending: true,
    });
    const [name] = await readdir(dir);
    const body = JSON.parse(await readFile(join(dir, name), "utf8"));
    expect(body).toMatchObject({ startedAt: startedAt.toISOString(), dictionaryApplied: false });
  });

  it("reports pending: false, without throwing, when the outbox cannot be written either", async () => {
    mockSchema.mockRejectedValue(new Error("down"));
    const blocker = join(dir, "..", "file");
    await writeFile(blocker, "");
    await expect(recordHistoryOrDefer(db, input("a"), { ...opts(), pendingDir: join(blocker, "sub") })).resolves.toEqual({
      pending: false,
    });
  });
});

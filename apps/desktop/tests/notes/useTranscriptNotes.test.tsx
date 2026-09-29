// Transcript notes (SPEC.md > Transcript notes). Pins useTranscriptNotes'
// load/add/update/remove lifecycle against a routed invoke() mock, same
// convention as VoiceInputSection.test.tsx/PreferencesView.test.tsx.
//
// Optimistic (2026-09-29, user-reported): add/update/remove apply to local
// state synchronously -- no more await/act(async) around them -- and the
// sidecar round trip happens in the background. `add` still throws
// SYNCHRONOUSLY for a transcript with no id or an overlapping range (a
// real, immediate validation failure, not a sync failure); everything
// else that can go wrong is recorded in `failures` instead of rejecting.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useTranscriptNotes } from "../../src/features/notes/useTranscriptNotes";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: unknown) => invoke(command, args),
}));

function makeDto(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    transcriptionId: 10,
    startOffset: 0,
    endOffset: 6,
    quotedText: "2GOMCP",
    note: "正しくはTogoMCP",
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useTranscriptNotes", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("stays empty and never calls invoke when transcriptionId is undefined", async () => {
    const { result } = renderHook(() => useTranscriptNotes(undefined));
    expect(result.current.notes).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("loads notes for the given transcriptionId on mount", async () => {
    invoke.mockResolvedValueOnce([makeDto()]);
    const { result } = renderHook(() => useTranscriptNotes(10));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    expect(result.current.notes[0].quotedText).toBe("2GOMCP");
    expect(invoke).toHaveBeenCalledWith("list_notes", { transcriptionId: 10 });
  });

  it("skips the fetch entirely when knownNoteCount is 0", async () => {
    const { result } = renderHook(() => useTranscriptNotes(10, 0));
    expect(result.current.notes).toEqual([]);
    // Give any accidental async fetch a tick to have fired.
    await new Promise((r) => setTimeout(r, 0));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("still fetches when knownNoteCount is undefined (unknown, not zero)", async () => {
    invoke.mockResolvedValueOnce([makeDto()]);
    const { result } = renderHook(() => useTranscriptNotes(10));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    expect(invoke).toHaveBeenCalledWith("list_notes", { transcriptionId: 10 });
  });

  it("surfaces a load failure via loadError instead of throwing", async () => {
    invoke.mockRejectedValueOnce(new Error("db unreachable"));
    const { result } = renderHook(() => useTranscriptNotes(10));
    await waitFor(() => expect(result.current.loadError).toBe("db unreachable"));
    expect(result.current.notes).toEqual([]);
  });

  it("add() throws synchronously without calling invoke when transcriptionId is undefined", () => {
    const { result } = renderHook(() => useTranscriptNotes(undefined));
    expect(() => result.current.add(0, 6, "2GOMCP", "note")).toThrow(/no saved history/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("add() throws synchronously for a range that overlaps an existing note, without calling invoke", async () => {
    invoke.mockResolvedValueOnce([makeDto({ startOffset: 0, endOffset: 6 })]);
    const { result } = renderHook(() => useTranscriptNotes(10));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    invoke.mockClear();
    expect(() => result.current.add(3, 9, "overlap", "note")).toThrow(/overlaps/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("add() allows two notes that only touch at a boundary (not truly overlapping)", async () => {
    invoke.mockResolvedValueOnce([makeDto({ id: 1, startOffset: 0, endOffset: 6 })]);
    const { result } = renderHook(() => useTranscriptNotes(10));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    invoke.mockResolvedValueOnce(makeDto({ id: 2, startOffset: 6, endOffset: 9, quotedText: "next" }));
    act(() => {
      result.current.add(6, 9, "next", "note");
    });
    expect(result.current.notes).toHaveLength(2);
    await waitFor(() => expect(result.current.notes[1].id).toBe(2));
  });

  it("add() inserts an optimistic note immediately, with a temp negative id, before add_note resolves", () => {
    const gate = deferred<unknown>();
    invoke.mockReturnValueOnce(gate.promise);
    const { result } = renderHook(() => useTranscriptNotes(10, 0));

    act(() => {
      result.current.add(0, 6, "2GOMCP", "note");
    });

    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0].id).toBeLessThan(0);
    expect(result.current.notes[0].note).toBe("note");
    expect(invoke).toHaveBeenCalledWith("add_note", {
      request: { transcriptionId: 10, startOffset: 0, endOffset: 6, quotedText: "2GOMCP", note: "note" },
    });
  });

  it("a second overlapping add is rejected even while the first is still in flight", () => {
    const gate = deferred<unknown>();
    invoke.mockReturnValueOnce(gate.promise);
    const { result } = renderHook(() => useTranscriptNotes(10, 0));

    act(() => {
      result.current.add(0, 6, "2GOMCP", "note");
    });
    expect(() => result.current.add(3, 9, "overlap", "note2")).toThrow(/overlaps/);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("reconciles the temp note with the server record once add_note resolves", async () => {
    const gate = deferred<unknown>();
    invoke.mockReturnValueOnce(gate.promise);
    const { result } = renderHook(() => useTranscriptNotes(10, 0));
    act(() => {
      result.current.add(0, 6, "2GOMCP", "note");
    });

    gate.resolve(makeDto({ id: 42 }));
    await waitFor(() => expect(result.current.notes[0]?.id).toBe(42));
    expect(result.current.failures.size).toBe(0);
  });

  it("if add_note fails, the temp note stays visible and a NoteFailure is recorded", async () => {
    const gate = deferred<unknown>();
    invoke.mockReturnValueOnce(gate.promise);
    const { result } = renderHook(() => useTranscriptNotes(10, 0));
    act(() => {
      result.current.add(0, 6, "2GOMCP", "note");
    });
    const tempId = result.current.notes[0].id;

    gate.reject(new Error("db unreachable"));
    await waitFor(() => expect(result.current.failures.get(tempId)).toBeDefined());
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.failures.get(tempId)).toEqual({
      action: "add",
      error: "db unreachable",
      args: { startOffset: 0, endOffset: 6, quotedText: "2GOMCP", note: "note" },
    });
  });

  it("update() applies the new text immediately and reconciles with the server record", async () => {
    invoke.mockResolvedValueOnce([makeDto()]);
    const { result } = renderHook(() => useTranscriptNotes(10));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    invoke.mockResolvedValueOnce(makeDto({ note: "updated" }));
    act(() => {
      result.current.update(1, "updated");
    });
    expect(result.current.notes[0].note).toBe("updated");
    expect(invoke).toHaveBeenCalledWith("update_note", { request: { id: 1, note: "updated" } });
    await waitFor(() => expect(result.current.failures.size).toBe(0));
  });

  it("if update_note fails, the optimistic text is kept and previousNote/attemptedNote are recorded", async () => {
    invoke.mockResolvedValueOnce([makeDto({ note: "元の注釈" })]);
    const { result } = renderHook(() => useTranscriptNotes(10));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    invoke.mockReturnValueOnce(Promise.reject(new Error("db unreachable")));
    act(() => {
      result.current.update(1, "更新後");
    });
    expect(result.current.notes[0].note).toBe("更新後");

    await waitFor(() => expect(result.current.failures.get(1)).toBeDefined());
    expect(result.current.notes[0].note).toBe("更新後");
    expect(result.current.failures.get(1)).toEqual({
      action: "update",
      error: "db unreachable",
      previousNote: "元の注釈",
      attemptedNote: "更新後",
    });
  });

  it("remove() removes immediately and calls delete_note", async () => {
    invoke.mockResolvedValueOnce([makeDto()]);
    const { result } = renderHook(() => useTranscriptNotes(10));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    invoke.mockResolvedValueOnce(undefined);
    act(() => {
      result.current.remove(1);
    });
    expect(result.current.notes).toEqual([]);
    expect(invoke).toHaveBeenCalledWith("delete_note", { id: 1 });
  });

  it("if delete_note fails, the note reappears with a recorded NoteFailure", async () => {
    invoke.mockResolvedValueOnce([makeDto()]);
    const { result } = renderHook(() => useTranscriptNotes(10));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    invoke.mockReturnValueOnce(Promise.reject(new Error("db unreachable")));
    act(() => {
      result.current.remove(1);
    });
    expect(result.current.notes).toHaveLength(0);

    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    expect(result.current.failures.get(1)).toMatchObject({ action: "delete", error: "db unreachable" });
  });

  describe("retry()", () => {
    it("re-runs a failed add with the original args and clears the failure on success", async () => {
      invoke.mockReturnValueOnce(Promise.reject(new Error("db unreachable")));
      const { result } = renderHook(() => useTranscriptNotes(10, 0));
      act(() => {
        result.current.add(0, 6, "2GOMCP", "note");
      });
      const tempId = result.current.notes[0].id;
      await waitFor(() => expect(result.current.failures.get(tempId)).toBeDefined());

      invoke.mockResolvedValueOnce(makeDto({ id: 42 }));
      act(() => {
        result.current.retry(tempId);
      });
      expect(result.current.failures.has(tempId)).toBe(false);
      await waitFor(() => expect(result.current.notes[0]?.id).toBe(42));
      expect(invoke).toHaveBeenLastCalledWith("add_note", {
        request: { transcriptionId: 10, startOffset: 0, endOffset: 6, quotedText: "2GOMCP", note: "note" },
      });
    });

    it("re-runs a failed update with the attempted text", async () => {
      invoke.mockResolvedValueOnce([makeDto({ note: "元の注釈" })]);
      const { result } = renderHook(() => useTranscriptNotes(10));
      await waitFor(() => expect(result.current.notes).toHaveLength(1));
      invoke.mockReturnValueOnce(Promise.reject(new Error("db unreachable")));
      act(() => {
        result.current.update(1, "更新後");
      });
      await waitFor(() => expect(result.current.failures.get(1)).toBeDefined());

      invoke.mockResolvedValueOnce(makeDto({ note: "更新後" }));
      act(() => {
        result.current.retry(1);
      });
      await waitFor(() => expect(result.current.failures.size).toBe(0));
      expect(invoke).toHaveBeenLastCalledWith("update_note", { request: { id: 1, note: "更新後" } });
    });

    it("re-runs a failed delete", async () => {
      invoke.mockResolvedValueOnce([makeDto()]);
      const { result } = renderHook(() => useTranscriptNotes(10));
      await waitFor(() => expect(result.current.notes).toHaveLength(1));
      invoke.mockReturnValueOnce(Promise.reject(new Error("db unreachable")));
      act(() => {
        result.current.remove(1);
      });
      await waitFor(() => expect(result.current.failures.get(1)).toBeDefined());

      invoke.mockResolvedValueOnce(undefined);
      act(() => {
        result.current.retry(1);
      });
      expect(result.current.notes).toHaveLength(0);
      await waitFor(() => expect(result.current.failures.size).toBe(0));
      expect(invoke).toHaveBeenLastCalledWith("delete_note", { id: 1 });
    });

    it("is a no-op for a note with no failure", () => {
      const { result } = renderHook(() => useTranscriptNotes(10, 0));
      act(() => {
        result.current.retry(999);
      });
      expect(invoke).not.toHaveBeenCalled();
    });
  });

  describe("discard()", () => {
    it("removes the note for a failed add", async () => {
      invoke.mockReturnValueOnce(Promise.reject(new Error("db unreachable")));
      const { result } = renderHook(() => useTranscriptNotes(10, 0));
      act(() => {
        result.current.add(0, 6, "2GOMCP", "note");
      });
      const tempId = result.current.notes[0].id;
      await waitFor(() => expect(result.current.failures.get(tempId)).toBeDefined());

      act(() => {
        result.current.discard(tempId);
      });
      expect(result.current.notes).toHaveLength(0);
      expect(result.current.failures.has(tempId)).toBe(false);
    });

    it("reverts to the previous text for a failed update", async () => {
      invoke.mockResolvedValueOnce([makeDto({ note: "元の注釈" })]);
      const { result } = renderHook(() => useTranscriptNotes(10));
      await waitFor(() => expect(result.current.notes).toHaveLength(1));
      invoke.mockReturnValueOnce(Promise.reject(new Error("db unreachable")));
      act(() => {
        result.current.update(1, "更新後");
      });
      await waitFor(() => expect(result.current.failures.get(1)).toBeDefined());

      act(() => {
        result.current.discard(1);
      });
      expect(result.current.notes[0].note).toBe("元の注釈");
      expect(result.current.failures.has(1)).toBe(false);
    });

    it("keeps the note for a failed delete (discards the delete attempt, not the note)", async () => {
      invoke.mockResolvedValueOnce([makeDto()]);
      const { result } = renderHook(() => useTranscriptNotes(10));
      await waitFor(() => expect(result.current.notes).toHaveLength(1));
      invoke.mockReturnValueOnce(Promise.reject(new Error("db unreachable")));
      act(() => {
        result.current.remove(1);
      });
      await waitFor(() => expect(result.current.failures.get(1)).toBeDefined());

      act(() => {
        result.current.discard(1);
      });
      expect(result.current.notes).toHaveLength(1);
      expect(result.current.failures.has(1)).toBe(false);
    });

    it("is a no-op for a note with no failure", () => {
      const { result } = renderHook(() => useTranscriptNotes(10, 0));
      act(() => {
        result.current.discard(999);
      });
      expect(invoke).not.toHaveBeenCalled();
    });
  });
});

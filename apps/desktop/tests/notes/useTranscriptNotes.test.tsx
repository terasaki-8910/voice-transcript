// Transcript notes (SPEC.md > Transcript notes). Pins useTranscriptNotes'
// load/add/update/remove lifecycle against a routed invoke() mock, same
// convention as VoiceInputSection.test.tsx/PreferencesView.test.tsx.
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

  it("add() still works after a skipped fetch (knownNoteCount 0 is not the same as no transcriptionId)", async () => {
    const { result } = renderHook(() => useTranscriptNotes(10, 0));
    invoke.mockResolvedValueOnce(makeDto());
    await act(async () => {
      await result.current.add(0, 6, "2GOMCP", "note");
    });
    expect(result.current.notes).toHaveLength(1);
  });

  it("surfaces a load failure via loadError instead of throwing", async () => {
    invoke.mockRejectedValueOnce(new Error("db unreachable"));
    const { result } = renderHook(() => useTranscriptNotes(10));
    await waitFor(() => expect(result.current.loadError).toBe("db unreachable"));
    expect(result.current.notes).toEqual([]);
  });

  it("add() rejects without calling invoke when transcriptionId is undefined", async () => {
    const { result } = renderHook(() => useTranscriptNotes(undefined));
    await expect(result.current.add(0, 6, "2GOMCP", "note")).rejects.toThrow(/no saved history/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("add() calls add_note and inserts the new record, sorted by startOffset", async () => {
    invoke.mockResolvedValueOnce([makeDto({ id: 1, startOffset: 10, quotedText: "later" })]);
    const { result } = renderHook(() => useTranscriptNotes(10));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    invoke.mockResolvedValueOnce(makeDto({ id: 2, startOffset: 0, quotedText: "earlier" }));
    await act(async () => {
      await result.current.add(0, 6, "earlier", "note");
    });

    expect(invoke).toHaveBeenCalledWith("add_note", {
      request: { transcriptionId: 10, startOffset: 0, endOffset: 6, quotedText: "earlier", note: "note" },
    });
    expect(result.current.notes.map((n) => n.quotedText)).toEqual(["earlier", "later"]);
  });

  it("add() rejects a range that overlaps an existing note, without calling invoke", async () => {
    invoke.mockResolvedValueOnce([makeDto({ startOffset: 0, endOffset: 6 })]);
    const { result } = renderHook(() => useTranscriptNotes(10));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    invoke.mockClear();
    await expect(result.current.add(3, 9, "overlap", "note")).rejects.toThrow(/overlaps/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("add() allows two notes that only touch at a boundary (not truly overlapping)", async () => {
    invoke.mockResolvedValueOnce([makeDto({ id: 1, startOffset: 0, endOffset: 6 })]);
    const { result } = renderHook(() => useTranscriptNotes(10));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    invoke.mockResolvedValueOnce(makeDto({ id: 2, startOffset: 6, endOffset: 9, quotedText: "next" }));
    await act(async () => {
      await result.current.add(6, 9, "next", "note");
    });
    expect(result.current.notes).toHaveLength(2);
  });

  it("update() calls update_note and replaces the record in place", async () => {
    invoke.mockResolvedValueOnce([makeDto()]);
    const { result } = renderHook(() => useTranscriptNotes(10));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    invoke.mockResolvedValueOnce(makeDto({ note: "updated" }));
    await act(async () => {
      await result.current.update(1, "updated");
    });
    expect(invoke).toHaveBeenCalledWith("update_note", { request: { id: 1, note: "updated" } });
    expect(result.current.notes[0].note).toBe("updated");
  });

  it("remove() calls delete_note and removes the record from state", async () => {
    invoke.mockResolvedValueOnce([makeDto()]);
    const { result } = renderHook(() => useTranscriptNotes(10));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    invoke.mockResolvedValueOnce(undefined);
    await act(async () => {
      await result.current.remove(1);
    });
    expect(invoke).toHaveBeenCalledWith("delete_note", { id: 1 });
    expect(result.current.notes).toEqual([]);
  });
});

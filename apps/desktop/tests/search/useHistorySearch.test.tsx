// Search (SPEC.md > Search). Pins useHistorySearch's debounce (no
// search-per-keystroke, given every sidecar call is its own subprocess)
// and its space-separated term splitting.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useHistorySearch } from "../../src/features/search/useHistorySearch";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: unknown) => invoke(command, args),
}));

beforeEach(() => {
  invoke.mockReset();
  // shouldAdvanceTime: real wall-clock time still passes in the background
  // (needed for @testing-library's own waitFor polling, which otherwise
  // hangs forever under fully-faked timers -- see RecordingContext.test.tsx's
  // identical setup), while vi.advanceTimersByTime below still
  // fast-forwards the debounce deterministically.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useHistorySearch", () => {
  it("starts with an empty query and no results, without calling invoke", () => {
    const { result } = renderHook(() => useHistorySearch());
    expect(result.current.query).toBe("");
    expect(result.current.results).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not search until the debounce window elapses", async () => {
    invoke.mockResolvedValue([]);
    const { result } = renderHook(() => useHistorySearch());

    act(() => result.current.setQuery("2GOMCP"));
    expect(invoke).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(249);
    });
    expect(invoke).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(invoke).toHaveBeenCalledWith("search_history", { query: "2GOMCP" });
  });

  it("resets the debounce timer on every keystroke, firing only once for a burst of typing", async () => {
    invoke.mockResolvedValue([]);
    const { result } = renderHook(() => useHistorySearch());

    act(() => result.current.setQuery("2"));
    await act(async () => vi.advanceTimersByTime(150));
    act(() => result.current.setQuery("2G"));
    await act(async () => vi.advanceTimersByTime(150));
    act(() => result.current.setQuery("2GOMCP"));
    await act(async () => vi.advanceTimersByTime(250));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("search_history", { query: "2GOMCP" });
  });

  it("splits the query into space-separated terms for callers that need them (e.g. highlighting)", () => {
    const { result } = renderHook(() => useHistorySearch());
    act(() => result.current.setQuery("  2GOMCP   TogoMCP "));
    expect(result.current.terms).toEqual(["2GOMCP", "TogoMCP"]);
  });

  it("clears results immediately when the query is emptied, without waiting for the debounce", async () => {
    invoke.mockResolvedValue([{ id: 1, sourceFileName: "a.m4a", startedAt: "2026-01-01", transcriptText: "hi", matchedNotes: [] }]);
    const { result } = renderHook(() => useHistorySearch());
    act(() => result.current.setQuery("hi"));
    await act(async () => vi.advanceTimersByTime(250));
    await waitFor(() => expect(result.current.results).toHaveLength(1));

    act(() => result.current.setQuery(""));
    expect(result.current.results).toEqual([]);
  });

  it("surfaces a search failure via `error` without throwing", async () => {
    invoke.mockRejectedValue(new Error("db unreachable"));
    const { result } = renderHook(() => useHistorySearch());
    act(() => result.current.setQuery("hi"));
    await act(async () => vi.advanceTimersByTime(250));
    await waitFor(() => expect(result.current.error).toBe("db unreachable"));
  });

  it("sets loading true while a search is in flight and false once it resolves", async () => {
    let resolve!: (v: unknown[]) => void;
    invoke.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useHistorySearch());
    act(() => result.current.setQuery("hi"));
    await act(async () => vi.advanceTimersByTime(250));
    expect(result.current.loading).toBe(true);

    await act(async () => resolve([]));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});

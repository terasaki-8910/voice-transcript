// F18 (gui-history). Pins HistoryContext's fetch-on-mount, and the two
// distinct delete actions: trash (G7, keeps the record, disables itself
// once trashed) and remove (G9, drops the record from the list locally).
// All Tauri calls are injected -- no module mocking needed.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HistoryProvider, useHistory } from "../../src/features/history/HistoryContext";
import type { HistoryEntry, TrashResult } from "../../src/lib/tauri";

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 1,
    sourceFileName: "/audio/a.m4a",
    startedAt: new Date("2026-07-13T00:00:00Z"),
    model: "whisper-large-v3-turbo",
    formats: ["txt"],
    status: "success",
    transcriptText: "hello",
    ...overrides,
  };
}

function Inspector() {
  const { items, status, error, syncError, trashedIds, actionErrors, trash, remove } = useHistory();
  if (status === "loading") return <p>loading</p>;
  if (status === "error") return <p>error: {error}</p>;
  return (
    <ul>
      {syncError && <li data-testid="sync-error">sync-error: {syncError}</li>}
      {items.map((item) => (
        <li key={item.id} data-testid={`item-${item.id}`}>
          {item.sourceFileName}
          {trashedIds.has(item.id) && ":trashed"}
          {actionErrors.has(item.id) && `:action-error=${actionErrors.get(item.id)}`}
          <button type="button" onClick={() => void trash(item.id)}>
            trash-{item.id}
          </button>
          <button type="button" onClick={() => void remove(item.id)}>
            remove-{item.id}
          </button>
        </li>
      ))}
    </ul>
  );
}

describe("HistoryContext", () => {
  // Local cache (localStorage) persists across tests in the same jsdom
  // instance otherwise -- each test needs a clean slate to correctly
  // exercise the "nothing cached yet" vs. "cache present" paths.
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("loads history on mount", async () => {
    const listHistoryFn = vi.fn(async () => [makeEntry({ id: 1 }), makeEntry({ id: 2, sourceFileName: "/audio/b.m4a" })]);
    render(<HistoryProvider listHistoryFn={listHistoryFn}>
      <Inspector />
    </HistoryProvider>);

    await waitFor(() => expect(screen.getByTestId("item-1")).toBeDefined());
    expect(screen.getByTestId("item-2").textContent).toContain("/audio/b.m4a");
    expect(listHistoryFn).toHaveBeenCalledTimes(1);
  });

  it("surfaces a load failure as an error state", async () => {
    const listHistoryFn = vi.fn(async () => {
      throw new Error("DB unreachable");
    });
    render(<HistoryProvider listHistoryFn={listHistoryFn}>
      <Inspector />
    </HistoryProvider>);

    await waitFor(() => expect(screen.getByText(/DB unreachable/)).toBeDefined());
  });

  // Real usage feedback, 2026-07-14: the DB lives on a remote server, and a
  // transient network hiccup used to dump a raw SQL error over the whole
  // view even though a perfectly good previous list was already cached.
  it("shows cached items instantly on mount, before the real fetch resolves", async () => {
    window.localStorage.setItem(
      "voice-transcript-history-cache-v1",
      JSON.stringify([{ ...makeEntry({ id: 9 }), startedAt: "2026-07-01T00:00:00.000Z" }]),
    );
    let resolveFetch: (rows: HistoryEntry[]) => void = () => {};
    const listHistoryFn = vi.fn(() => new Promise<HistoryEntry[]>((resolve) => (resolveFetch = resolve)));
    render(
      <HistoryProvider listHistoryFn={listHistoryFn}>
        <Inspector />
      </HistoryProvider>,
    );

    // Cached item shows immediately -- no "loading" state, no waitFor needed.
    expect(screen.getByTestId("item-9")).toBeDefined();

    resolveFetch([makeEntry({ id: 1 })]);
    await waitFor(() => expect(screen.getByTestId("item-1")).toBeDefined());
    expect(screen.queryByTestId("item-9")).toBeNull();
  });

  it("keeps showing cached items and sets syncError when the background refresh fails", async () => {
    window.localStorage.setItem(
      "voice-transcript-history-cache-v1",
      JSON.stringify([{ ...makeEntry({ id: 9 }), startedAt: "2026-07-01T00:00:00.000Z" }]),
    );
    const listHistoryFn = vi.fn(async () => {
      throw new Error("connect ETIMEDOUT");
    });
    render(
      <HistoryProvider listHistoryFn={listHistoryFn}>
        <Inspector />
      </HistoryProvider>,
    );

    expect(screen.getByTestId("item-9")).toBeDefined();
    await waitFor(() => expect(screen.getByTestId("sync-error").textContent).toContain("connect ETIMEDOUT"));
    expect(screen.getByTestId("item-9")).toBeDefined();
  });

  it("trash() marks the entry trashed without removing it from the list", async () => {
    const listHistoryFn = vi.fn(async () => [makeEntry({ id: 1 })]);
    const trashAudioFn = vi.fn(async (): Promise<TrashResult> => ({ trashed: true }));
    render(
      <HistoryProvider listHistoryFn={listHistoryFn} trashAudioFn={trashAudioFn}>
        <Inspector />
      </HistoryProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("item-1")).toBeDefined());
    fireEvent.click(screen.getByText("trash-1"));

    await waitFor(() => expect(screen.getByTestId("item-1").textContent).toContain(":trashed"));
    expect(trashAudioFn).toHaveBeenCalledWith(1);
  });

  it("remove() drops the entry from the list", async () => {
    const listHistoryFn = vi.fn(async () => [makeEntry({ id: 1 }), makeEntry({ id: 2 })]);
    const deleteHistoryEntryFn = vi.fn(async (): Promise<TrashResult> => ({ trashed: false }));
    render(
      <HistoryProvider listHistoryFn={listHistoryFn} deleteHistoryEntryFn={deleteHistoryEntryFn}>
        <Inspector />
      </HistoryProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("item-2")).toBeDefined());
    fireEvent.click(screen.getByText("remove-1"));

    await waitFor(() => expect(screen.queryByTestId("item-1")).toBeNull());
    expect(screen.getByTestId("item-2")).toBeDefined();
    expect(deleteHistoryEntryFn).toHaveBeenCalledWith(1);
  });

  // Regression coverage for a bug caught in pre-merge review: trash()/
  // remove() used to await their Tauri calls with no try/catch, so a
  // rejected promise (e.g. the Rust command failing to parse the sidecar's
  // response) surfaced only as an unhandled rejection, invisible in the UI.
  it("trash() surfaces a per-row error instead of throwing, and clears it on a later success", async () => {
    const listHistoryFn = vi.fn(async () => [makeEntry({ id: 1 })]);
    const trashAudioFn = vi
      .fn<() => Promise<TrashResult>>()
      .mockRejectedValueOnce(new Error("sidecar returned invalid JSON"))
      .mockResolvedValueOnce({ trashed: true });
    render(
      <HistoryProvider listHistoryFn={listHistoryFn} trashAudioFn={trashAudioFn}>
        <Inspector />
      </HistoryProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("item-1")).toBeDefined());
    fireEvent.click(screen.getByText("trash-1"));
    await waitFor(() =>
      expect(screen.getByTestId("item-1").textContent).toContain("action-error=sidecar returned invalid JSON"),
    );
    expect(screen.getByTestId("item-1").textContent).not.toContain(":trashed");

    fireEvent.click(screen.getByText("trash-1"));
    await waitFor(() => expect(screen.getByTestId("item-1").textContent).toContain(":trashed"));
    expect(screen.getByTestId("item-1").textContent).not.toContain("action-error");
  });

  it("remove() surfaces a per-row error and does not remove the item", async () => {
    const listHistoryFn = vi.fn(async () => [makeEntry({ id: 1 })]);
    const deleteHistoryEntryFn = vi.fn(async (): Promise<TrashResult> => {
      throw new Error("history entry not found");
    });
    render(
      <HistoryProvider listHistoryFn={listHistoryFn} deleteHistoryEntryFn={deleteHistoryEntryFn}>
        <Inspector />
      </HistoryProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("item-1")).toBeDefined());
    fireEvent.click(screen.getByText("remove-1"));

    await waitFor(() =>
      expect(screen.getByTestId("item-1").textContent).toContain("action-error=history entry not found"),
    );
  });
});

// F18 (gui-history). Pins HistoryView's rendered states (loading is
// transient and covered indirectly; empty and populated are the
// user-visible steady states) and HistoryRow's View/Trash/Delete actions,
// driven through a real HistoryProvider (injected functions) the same way
// tests/queue/QueueRow.test.tsx drives QueueRow through a real
// QueueProvider.
//
// Post-integration fix batch (2026-07-13): Trash/Delete now go through an
// OS-native confirm() first -- mocked here so tests control whether the
// "user" accepts or cancels. save()/invoke() are mocked too for Export
// coverage. All three come from modules with no injectable seam on
// HistoryRow, consistent with how other direct Tauri API calls are mocked
// elsewhere in this suite.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { HistoryProvider } from "../../src/features/history/HistoryContext";
import { HistoryView } from "../../src/features/history/HistoryView";
import { SelectionProvider } from "../../src/features/selection/SelectionContext";
import type { HistoryEntry, TrashResult } from "../../src/lib/tauri";

const confirmDialog = vi.fn();
const save = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: (...args: unknown[]) => confirmDialog(...args),
  save: (...args: unknown[]) => save(...args),
}));

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 1,
    sourceFileName: "/audio/a.m4a",
    startedAt: new Date("2026-07-13T00:00:00Z"),
    model: "whisper-large-v3-turbo",
    formats: ["txt"],
    status: "success",
    transcriptText: "hello world",
    ...overrides,
  };
}

function renderView(listHistoryFn: () => Promise<HistoryEntry[]>) {
  return render(
    <I18nProvider>
      <SelectionProvider>
        <HistoryProvider listHistoryFn={listHistoryFn}>
          <HistoryView />
        </HistoryProvider>
      </SelectionProvider>
    </I18nProvider>,
  );
}

describe("HistoryView", () => {
  beforeEach(() => {
    confirmDialog.mockReset();
    confirmDialog.mockResolvedValue(true);
    save.mockReset();
    invoke.mockReset();
  });

  it("shows the empty state when there is no history -- responds even with zero entries", async () => {
    renderView(async () => []);
    await waitFor(() => expect(screen.getByText("No history yet")).toBeDefined());
  });

  it("lists entries and expands a transcript via View", async () => {
    renderView(async () => [makeEntry()]);

    await waitFor(() => expect(screen.getByText("a.m4a")).toBeDefined());
    expect(screen.queryByText("hello world")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(screen.getByText("hello world")).toBeDefined();
  });

  it("Trash audio asks for confirmation first, then disables itself once trashed", async () => {
    const trashAudioFn = vi.fn(async (): Promise<TrashResult> => ({ trashed: true }));
    render(
      <I18nProvider>
        <SelectionProvider>
          <HistoryProvider listHistoryFn={async () => [makeEntry()]} trashAudioFn={trashAudioFn}>
            <HistoryView />
          </HistoryProvider>
        </SelectionProvider>
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Trash audio" })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Trash audio" }));

    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    expect(confirmDialog.mock.calls[0][1]).toMatchObject({ title: "Trash audio", kind: "warning" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Audio trashed" })).toHaveProperty("disabled", true));
    expect(trashAudioFn).toHaveBeenCalledWith(1);
  });

  it("cancelling the confirmation dialog does not trash the audio", async () => {
    confirmDialog.mockResolvedValue(false);
    const trashAudioFn = vi.fn(async (): Promise<TrashResult> => ({ trashed: true }));
    render(
      <I18nProvider>
        <SelectionProvider>
          <HistoryProvider listHistoryFn={async () => [makeEntry()]} trashAudioFn={trashAudioFn}>
            <HistoryView />
          </HistoryProvider>
        </SelectionProvider>
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Trash audio" })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Trash audio" }));

    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    expect(trashAudioFn).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Trash audio" })).toBeDefined();
  });

  it("Delete asks for confirmation first, then removes the entry from the list", async () => {
    const deleteHistoryEntryFn = vi.fn(async (): Promise<TrashResult> => ({ trashed: false }));
    render(
      <I18nProvider>
        <SelectionProvider>
          <HistoryProvider
            listHistoryFn={async () => [makeEntry({ id: 1 }), makeEntry({ id: 2, sourceFileName: "/audio/b.m4a" })]}
            deleteHistoryEntryFn={deleteHistoryEntryFn}
          >
            <HistoryView />
          </HistoryProvider>
        </SelectionProvider>
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText("a.m4a")).toBeDefined());
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);

    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    expect(confirmDialog.mock.calls[0][1]).toMatchObject({ title: "Delete", kind: "warning" });
    await waitFor(() => expect(screen.queryByText("a.m4a")).toBeNull());
    expect(screen.getByText("b.m4a")).toBeDefined();
    expect(deleteHistoryEntryFn).toHaveBeenCalledWith(1);
  });

  it("cancelling the confirmation dialog does not delete the entry", async () => {
    confirmDialog.mockResolvedValue(false);
    const deleteHistoryEntryFn = vi.fn(async (): Promise<TrashResult> => ({ trashed: false }));
    render(
      <I18nProvider>
        <SelectionProvider>
          <HistoryProvider listHistoryFn={async () => [makeEntry()]} deleteHistoryEntryFn={deleteHistoryEntryFn}>
            <HistoryView />
          </HistoryProvider>
        </SelectionProvider>
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText("a.m4a")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    expect(deleteHistoryEntryFn).not.toHaveBeenCalled();
    expect(screen.getByText("a.m4a")).toBeDefined();
  });

  it("Export picks a save path and writes the transcript directly, without needing View first", async () => {
    save.mockResolvedValue("/tmp/a.m4a.txt");
    invoke.mockResolvedValue(undefined);
    renderView(async () => [makeEntry()]);

    await waitFor(() => expect(screen.getByRole("button", { name: "Export" })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith({ defaultPath: "a.m4a.txt" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("export_transcript", { path: "/tmp/a.m4a.txt", content: "hello world" }),
    );
  });

  // Regression coverage for a real gap found in user testing: if confirm()
  // itself throws (a denied capability on a stale compiled binary, a
  // dialog the OS couldn't show, etc.), the click used to just look like
  // it "did nothing" -- an unhandled rejection with no visible feedback.
  it("a confirm() failure during Trash surfaces an error instead of silently doing nothing", async () => {
    confirmDialog.mockRejectedValue(new Error("window not found"));
    const trashAudioFn = vi.fn(async (): Promise<TrashResult> => ({ trashed: true }));
    render(
      <I18nProvider>
        <SelectionProvider>
          <HistoryProvider listHistoryFn={async () => [makeEntry()]} trashAudioFn={trashAudioFn}>
            <HistoryView />
          </HistoryProvider>
        </SelectionProvider>
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Trash audio" })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Trash audio" }));

    await waitFor(() => expect(screen.getByText("window not found")).toBeDefined());
    expect(trashAudioFn).not.toHaveBeenCalled();
  });

  it("a confirm() failure during Delete surfaces an error instead of silently doing nothing", async () => {
    confirmDialog.mockRejectedValue(new Error("window not found"));
    const deleteHistoryEntryFn = vi.fn(async (): Promise<TrashResult> => ({ trashed: false }));
    render(
      <I18nProvider>
        <SelectionProvider>
          <HistoryProvider listHistoryFn={async () => [makeEntry()]} deleteHistoryEntryFn={deleteHistoryEntryFn}>
            <HistoryView />
          </HistoryProvider>
        </SelectionProvider>
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.getByText("window not found")).toBeDefined());
    expect(deleteHistoryEntryFn).not.toHaveBeenCalled();
  });

  it("an Export failure surfaces an error instead of silently doing nothing", async () => {
    save.mockResolvedValue("/tmp/a.m4a.txt");
    invoke.mockRejectedValue(new Error("permission denied"));
    renderView(async () => [makeEntry()]);

    await waitFor(() => expect(screen.getByRole("button", { name: "Export" })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(screen.getByText("permission denied")).toBeDefined());
  });
});

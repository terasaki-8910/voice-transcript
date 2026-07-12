// F18 (gui-history). Pins HistoryView's rendered states (loading is
// transient and covered indirectly; empty and populated are the
// user-visible steady states) and HistoryRow's View/Trash/Delete actions,
// driven through a real HistoryProvider (injected functions) the same way
// tests/queue/QueueRow.test.tsx drives QueueRow through a real
// QueueProvider.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { HistoryProvider } from "../../src/features/history/HistoryContext";
import { HistoryView } from "../../src/features/history/HistoryView";
import type { HistoryEntry, TrashResult } from "../../src/lib/tauri";

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
      <HistoryProvider listHistoryFn={listHistoryFn}>
        <HistoryView />
      </HistoryProvider>
    </I18nProvider>,
  );
}

describe("HistoryView", () => {
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

  it("Trash audio disables itself once trashed", async () => {
    render(
      <I18nProvider>
        <HistoryProvider
          listHistoryFn={async () => [makeEntry()]}
          trashAudioFn={vi.fn(async (): Promise<TrashResult> => ({ trashed: true }))}
        >
          <HistoryView />
        </HistoryProvider>
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Trash audio" })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Trash audio" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Audio trashed" })).toHaveProperty("disabled", true));
  });

  it("Delete removes the entry from the list", async () => {
    render(
      <I18nProvider>
        <HistoryProvider
          listHistoryFn={async () => [makeEntry({ id: 1 }), makeEntry({ id: 2, sourceFileName: "/audio/b.m4a" })]}
          deleteHistoryEntryFn={vi.fn(async (): Promise<TrashResult> => ({ trashed: false }))}
        >
          <HistoryView />
        </HistoryProvider>
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText("a.m4a")).toBeDefined());
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);

    await waitFor(() => expect(screen.queryByText("a.m4a")).toBeNull());
    expect(screen.getByText("b.m4a")).toBeDefined();
  });
});

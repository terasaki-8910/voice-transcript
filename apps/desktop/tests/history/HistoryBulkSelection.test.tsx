// Bulk selection in the History list (SPEC.md > Transcription history). Pins
// per-row checkboxes, Shift+click range selection, select-all, and the bulk
// copy/delete actions, driven through a real HistoryProvider with injected
// Tauri functions -- the same setup tests/history/HistoryView.test.tsx uses.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { DisplayPreferencesProvider } from "../../src/features/preferences/DisplayPreferencesContext";
import { HistoryProvider } from "../../src/features/history/HistoryContext";
import { HistoryNavProvider } from "../../src/features/history/HistoryNavContext";
import { HistoryView } from "../../src/features/history/HistoryView";
import { NavProvider } from "../../src/features/nav/NavContext";
import { SelectionProvider } from "../../src/features/selection/SelectionContext";
import type { HistoryEntry, TrashResult } from "../../src/lib/tauri";

const confirmDialog = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: (...args: unknown[]) => confirmDialog(...args),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const writeTextMock = vi.fn();
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: (...args: unknown[]) => writeTextMock(...args),
}));

function makeEntry(id: number, name: string): HistoryEntry {
  return {
    id,
    sourceFileName: `/audio/${name}`,
    startedAt: new Date("2026-07-13T00:00:00Z"),
    model: "whisper-large-v3-turbo",
    formats: ["txt"],
    status: "success",
    transcriptText: `hello ${name.replace(".m4a", "")}`,
    noteCount: 0,
  };
}

const entries = [makeEntry(1, "a.m4a"), makeEntry(2, "b.m4a"), makeEntry(3, "c.m4a")];

function renderView(deleteHistoryEntryFn: (id: number) => Promise<TrashResult>) {
  return render(
    <I18nProvider>
      <DisplayPreferencesProvider>
        <NavProvider>
          <HistoryNavProvider>
            <SelectionProvider>
              <HistoryProvider
                listHistoryFn={async () => entries}
                deleteHistoryEntryFn={deleteHistoryEntryFn}
                trashAudioFn={async () => ({ trashed: true })}
              >
                <HistoryView />
              </HistoryProvider>
            </SelectionProvider>
          </HistoryNavProvider>
        </NavProvider>
      </DisplayPreferencesProvider>
    </I18nProvider>,
  );
}

function rowCheckboxes(): HTMLInputElement[] {
  return screen.getAllByRole("checkbox", { name: "Select entry" }) as HTMLInputElement[];
}

function checkedStates(): boolean[] {
  return rowCheckboxes().map((box) => box.checked);
}

describe("HistoryView bulk selection", () => {
  beforeEach(() => {
    confirmDialog.mockReset();
    confirmDialog.mockResolvedValue(true);
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);
  });

  it("Shift+click selects every row between the last clicked row and this one", async () => {
    renderView(async () => ({ trashed: true }));
    await waitFor(() => expect(rowCheckboxes()).toHaveLength(3));

    fireEvent.click(rowCheckboxes()[0]);
    fireEvent.click(rowCheckboxes()[2], { shiftKey: true });

    expect(checkedStates()).toEqual([true, true, true]);
    expect(screen.getByText("3 selected")).toBeDefined();
  });

  it("a plain click toggles just that row, and Shift+click reverses a range", async () => {
    renderView(async () => ({ trashed: true }));
    await waitFor(() => expect(rowCheckboxes()).toHaveLength(3));

    fireEvent.click(rowCheckboxes()[0]);
    fireEvent.click(rowCheckboxes()[2], { shiftKey: true });
    fireEvent.click(rowCheckboxes()[1]);
    expect(checkedStates()).toEqual([true, false, true]);

    fireEvent.click(rowCheckboxes()[2]);
    fireEvent.click(rowCheckboxes()[0], { shiftKey: true });
    expect(checkedStates()).toEqual([false, false, false]);
  });

  it("select-all checks every visible row, and a second click clears them", async () => {
    renderView(async () => ({ trashed: true }));
    await waitFor(() => expect(rowCheckboxes()).toHaveLength(3));

    const selectAll = () => screen.getAllByRole("checkbox")[0];
    fireEvent.click(selectAll());
    expect(checkedStates()).toEqual([true, true, true]);

    fireEvent.click(selectAll());
    expect(checkedStates()).toEqual([false, false, false]);
  });

  it("bulk copy puts every selected transcript on the clipboard in list order", async () => {
    renderView(async () => ({ trashed: true }));
    await waitFor(() => expect(rowCheckboxes()).toHaveLength(3));

    fireEvent.click(rowCheckboxes()[0]);
    fireEvent.click(rowCheckboxes()[2]);
    fireEvent.click(screen.getByRole("button", { name: "Copy selected transcripts" }));

    await waitFor(() =>
      expect(writeTextMock).toHaveBeenCalledWith("a.m4a\n\nhello a\n\n---\n\nc.m4a\n\nhello c"),
    );
  });

  it("bulk delete asks once, then removes each selected entry and keeps the rest", async () => {
    const deleteHistoryEntryFn = vi.fn(async (_id: number): Promise<TrashResult> => ({ trashed: true }));
    renderView(deleteHistoryEntryFn);
    await waitFor(() => expect(rowCheckboxes()).toHaveLength(3));

    fireEvent.click(rowCheckboxes()[0]);
    fireEvent.click(rowCheckboxes()[1]);
    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete selected entries" }));

    await waitFor(() => expect(deleteHistoryEntryFn).toHaveBeenCalledTimes(2));
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(deleteHistoryEntryFn.mock.calls.map((call) => call[0])).toEqual([1, 2]);
    await waitFor(() => expect(rowCheckboxes()).toHaveLength(1));
  });

  it("cancelling the bulk delete confirmation deletes nothing", async () => {
    confirmDialog.mockResolvedValue(false);
    const deleteHistoryEntryFn = vi.fn(async (): Promise<TrashResult> => ({ trashed: true }));
    renderView(deleteHistoryEntryFn);
    await waitFor(() => expect(rowCheckboxes()).toHaveLength(3));

    fireEvent.click(rowCheckboxes()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete selected entries" }));

    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    expect(deleteHistoryEntryFn).not.toHaveBeenCalled();
  });
});

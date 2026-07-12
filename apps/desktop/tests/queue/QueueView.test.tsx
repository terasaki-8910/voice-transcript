// F17 (gui-queue) / F18 (gui-history). QueueView touches two real Tauri
// APIs unconditionally on mount/interaction: useDragDrop's
// getCurrentWebview().onDragDropEvent (no __TAURI_INTERNALS__ bridge exists
// under jsdom) and the "Add files" button's pickFiles ->
// @tauri-apps/plugin-dialog's open(). Both are mocked so this stays a
// hermetic unit test instead of depending on a real Tauri runtime.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { ThemeProvider } from "../../src/theme/ThemeContext";
import { QueueProvider } from "../../src/features/queue/QueueContext";
import { HistoryProvider } from "../../src/features/history/HistoryContext";
import { QueueView } from "../../src/features/queue/QueueView";
import type { TranscribeRequest, TranscribeResponse } from "../../src/lib/tauri";

const onDragDropEvent = vi.fn(() => Promise.resolve(() => {}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent }),
}));

const open = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => open(...args),
}));

function renderView(transcribeFn: (request: TranscribeRequest) => Promise<TranscribeResponse> = () =>
  Promise.resolve({ text: "", rendered: "" }),
) {
  return render(
    <I18nProvider>
      <ThemeProvider>
        <QueueProvider transcribeFn={transcribeFn}>
          <HistoryProvider listHistoryFn={async () => []}>
            <QueueView />
          </HistoryProvider>
        </QueueProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe("QueueView", () => {
  afterEach(() => {
    open.mockReset();
  });

  it("renders the toolbar, tabs, and empty-queue state", () => {
    renderView();
    expect(screen.getByText("Voice Transcript")).toBeDefined();
    expect(screen.getByRole("tab", { name: "Queue" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByText("No files yet")).toBeDefined();
  });

  it("switching to the History tab responds immediately, even with zero history entries", async () => {
    renderView();

    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText("No files yet")).toBeNull();
    await waitFor(() => expect(screen.getByText("No history yet")).toBeDefined());

    fireEvent.click(screen.getByRole("tab", { name: "Queue" }));
    expect(screen.getByText("No files yet")).toBeDefined();
  });

  it("Add files picks paths via the native dialog and queues them", async () => {
    open.mockResolvedValue(["/audio/a.m4a", "/audio/b.m4a"]);
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Add files" }));

    await waitFor(() => expect(screen.getByText("a.m4a")).toBeDefined());
    expect(screen.getByText("b.m4a")).toBeDefined();
    expect(screen.queryByText("No files yet")).toBeNull();
  });

  it("does nothing when the native dialog is cancelled", async () => {
    open.mockResolvedValue(null);
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Add files" }));

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(screen.getByText("No files yet")).toBeDefined();
  });
});

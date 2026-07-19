// Smoke test: proves the Tauri + React + token-styled + provider wiring
// actually renders, not just typechecks. App.tsx grows incrementally across
// F17/F19/F20 (PLAN.md Wave 9); this only pins the toolbar's brand text and
// that the app renders under its real providers (mirroring main.tsx).
// App -> QueueProvider -> QueueView -> useDragDrop mounts
// getCurrentWebview().onDragDropEvent() unconditionally, which has no
// __TAURI_INTERNALS__ bridge under jsdom -- mocked so this stays hermetic.
// App -> HistoryProvider (F18) also calls the real listHistory() -> invoke()
// unconditionally on mount, so @tauri-apps/api/core is mocked too.
// App -> AppShell -> useMenuEvents (F21) calls the real listen()
// unconditionally on mount for four menu events, so @tauri-apps/api/event
// is mocked too.
// Sidebar redesign (2026-07-19): AppShell now renders AppLayout -> Sidebar,
// which needs HistoryNavContext (back/forward through View'd History
// entries) -- that context calls useNav() internally, so HistoryNavProvider
// must sit inside NavProvider in AppShellHarness's tree too. Sidebar itself
// makes no unconditional Tauri calls on mount (pickFiles() only fires on an
// actual "Add files" click, which none of these tests trigger), so no new
// mock is needed for it here.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { App, AppShell } from "../src/App";
import { ThemeProvider } from "../src/theme/ThemeContext";
import { I18nProvider } from "../src/i18n/I18nContext";
import { QueueProvider, useQueue } from "../src/features/queue/QueueContext";
import { HistoryProvider } from "../src/features/history/HistoryContext";
import { HistoryNavProvider } from "../src/features/history/HistoryNavContext";
import { NavProvider } from "../src/features/nav/NavContext";
import { SelectionProvider } from "../src/features/selection/SelectionContext";
import type { HistoryEntry, TranscribeRequest, TranscribeResponse } from "../src/lib/tauri";

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

describe("App", () => {
  it("renders the brand text in the toolbar", () => {
    render(
      <I18nProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </I18nProvider>,
    );
    expect(screen.getByText("Voice Transcript")).toBeDefined();
  });
});

// Real user report, 2026-07-14: a queue item reaching "Done" didn't show up
// in History until the app was restarted -- HistoryProvider only fetched
// once on mount. AppShell now watches queue completions and calls
// history.refresh(); this pins that wiring with injectable
// transcribeFn/listHistoryFn, independent of the real Tauri bridge.
function AddFilesButton() {
  const { addFiles } = useQueue();
  return (
    <button type="button" onClick={() => addFiles(["/audio/a.m4a"])}>
      add
    </button>
  );
}

function AppShellHarness({
  transcribeFn,
  listHistoryFn,
}: {
  transcribeFn: (request: TranscribeRequest) => Promise<TranscribeResponse>;
  listHistoryFn: () => Promise<HistoryEntry[]>;
}) {
  return (
    <I18nProvider>
      <ThemeProvider>
        <QueueProvider transcribeFn={transcribeFn}>
          <HistoryProvider listHistoryFn={listHistoryFn}>
            <NavProvider>
              <HistoryNavProvider>
                <SelectionProvider>
                  <AddFilesButton />
                  <AppShell />
                </SelectionProvider>
              </HistoryNavProvider>
            </NavProvider>
          </HistoryProvider>
        </QueueProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

describe("AppShell - history refreshes on queue completion", () => {
  it("calls listHistoryFn again once a queued file finishes transcribing", async () => {
    const listHistoryFn = vi.fn(async () => []);
    render(
      <AppShellHarness
        transcribeFn={() => Promise.resolve({ text: "hello world", rendered: "hello world" })}
        listHistoryFn={listHistoryFn}
      />,
    );

    await waitFor(() => expect(listHistoryFn).toHaveBeenCalledTimes(1)); // initial mount fetch
    fireEvent.click(screen.getByText("add"));

    await waitFor(() => expect(listHistoryFn.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("also refreshes when a queued file fails (still recorded to history)", async () => {
    const listHistoryFn = vi.fn(async () => []);
    render(
      <AppShellHarness
        transcribeFn={() => Promise.reject(new Error("network down"))}
        listHistoryFn={listHistoryFn}
      />,
    );

    await waitFor(() => expect(listHistoryFn).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("add"));

    await waitFor(() => expect(listHistoryFn.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});

// F17 (gui-queue) / F18 (gui-history). QueueView touches two real Tauri
// APIs unconditionally on mount/interaction: useDragDrop's
// getCurrentWebview().onDragDropEvent (no __TAURI_INTERNALS__ bridge exists
// under jsdom) and Sidebar's "Add files" button -> pickFiles ->
// @tauri-apps/plugin-dialog's open(). Both are mocked so this stays a
// hermetic unit test instead of depending on a real Tauri runtime.
//
// Sidebar redesign (2026-07-19): the toolbar (brand, Queue/History nav,
// "Add files") moved out of QueueView into Sidebar.tsx -- this file now
// renders AppLayout (Sidebar + QueueView together) so that coverage still
// exists, just through the new composition. Nav assertions moved from
// role="tab"/aria-selected to the sidebar's nav buttons + aria-current.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { ThemeProvider } from "../../src/theme/ThemeContext";
import { DisplayPreferencesProvider } from "../../src/features/preferences/DisplayPreferencesContext";
import { VoiceInputSettingsProvider } from "../../src/features/preferences/VoiceInputSettingsContext";
import { QueueProvider } from "../../src/features/queue/QueueContext";
import { RecordingProvider } from "../../src/features/recording/RecordingContext";
import { HistoryProvider } from "../../src/features/history/HistoryContext";
import { HistoryNavProvider } from "../../src/features/history/HistoryNavContext";
import { NavProvider } from "../../src/features/nav/NavContext";
import { SelectionProvider } from "../../src/features/selection/SelectionContext";
import { AppLayout } from "../../src/features/layout/AppLayout";
import type { RecordingResult, StartRecordingOptions, TranscribeRequest, TranscribeResponse } from "../../src/lib/tauri";

const onDragDropEvent = vi.fn(() => Promise.resolve(() => {}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent }),
}));

const open = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => open(...args),
}));

// RecordingWaveform.tsx's own listen(RECORDING_LEVEL_EVENT, ...) subscription
// -- same handler-registry mock convention as useMenuEvents.test.tsx.
type LevelHandler = (event: { payload: number }) => void;
const levelHandlers = new Map<string, LevelHandler>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, handler: LevelHandler) => {
    levelHandlers.set(event, handler);
    return Promise.resolve(() => levelHandlers.delete(event));
  }),
}));

function renderView(
  transcribeFn: (request: TranscribeRequest) => Promise<TranscribeResponse> = () =>
    Promise.resolve({ text: "", rendered: "" }),
  recordingFns: {
    startRecordingFn?: (options: StartRecordingOptions) => Promise<void>;
    stopRecordingFn?: () => Promise<RecordingResult>;
  } = {},
) {
  return render(
    <I18nProvider>
      <ThemeProvider>
        <DisplayPreferencesProvider>
          <VoiceInputSettingsProvider>
            <NavProvider>
              <HistoryNavProvider>
                <SelectionProvider>
                  <QueueProvider transcribeFn={transcribeFn}>
                    <RecordingProvider {...recordingFns}>
                      <HistoryProvider listHistoryFn={async () => []}>
                        <AppLayout preferencesOpen={false} onOpenPreferences={() => {}} onOpenSearch={() => {}} />
                      </HistoryProvider>
                    </RecordingProvider>
                  </QueueProvider>
                </SelectionProvider>
              </HistoryNavProvider>
            </NavProvider>
          </VoiceInputSettingsProvider>
        </DisplayPreferencesProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe("QueueView", () => {
  afterEach(() => {
    open.mockReset();
  });

  it("renders the sidebar nav and the empty-queue state", () => {
    renderView();
    expect(screen.getByText("Voice Transcript")).toBeDefined();
    expect(screen.getByRole("button", { name: "Queue" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "History" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByText("No files yet")).toBeDefined();
  });

  it("switching to the History nav item responds immediately, even with zero history entries", async () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "History" }));

    expect(screen.getByRole("button", { name: "History" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByText("No files yet")).toBeNull();
    await waitFor(() => expect(screen.getByText("No history yet")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Queue" }));
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

  // 2026-09-30, user-requested: the live level meter subscribes only while
  // a recording is actually in progress. Clicks the SAME sidebar toggle
  // button element both times (its accessible name flips between "Start
  // recording"/"Stop recording") rather than re-querying by name the
  // second time -- once recording starts, the recording bar's own Stop
  // link shares that exact same accessible name, so a fresh
  // getByRole("button", { name: "Stop recording" }) would ambiguously
  // match two elements.
  it("the recording bar's level meter subscribes while recording and unsubscribes on stop", async () => {
    levelHandlers.clear();
    renderView(undefined, {
      startRecordingFn: vi.fn(async () => {}),
      stopRecordingFn: vi.fn(async () => ({ path: "/recordings/r.wav", durationSeconds: 1, silentSources: [] })),
    });

    // jsdom has no real canvas; RecordingWaveform's own draw effect
    // otherwise logs "Not implemented: HTMLCanvasElement's getContext()"
    // noise -- this test only cares about the subscription lifecycle.
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);

    const recordToggle = screen.getByRole("button", { name: "Start recording" });
    expect(levelHandlers.has("recording-level")).toBe(false);

    fireEvent.click(recordToggle);
    await waitFor(() => expect(levelHandlers.has("recording-level")).toBe(true));

    fireEvent.click(recordToggle);
    await waitFor(() => expect(levelHandlers.has("recording-level")).toBe(false));

    getContextSpy.mockRestore();
  });
});

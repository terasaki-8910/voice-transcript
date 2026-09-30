// Audio recording (SPEC.md > Audio recording). Pins
// RecordingContext's start/stop lifecycle: a successful stop hands the
// finished file to the existing queue (addFiles) exactly like a picked
// file; a failure at either step surfaces as `error` without leaving the
// UI stuck in a non-idle status; the elapsed-time display ticks once a
// second while recording and has no upper bound.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { RecordingProvider, useRecording } from "../../src/features/recording/RecordingContext";
import { VoiceInputSettingsProvider, useVoiceInputSettings } from "../../src/features/preferences/VoiceInputSettingsContext";
import { QueueProvider, useQueue } from "../../src/features/queue/QueueContext";
import type { RecordingResult, StartRecordingOptions } from "../../src/lib/tauri";

beforeEach(() => {
  // shouldAdvanceTime: real wall-clock time still passes in the background
  // (needed for @testing-library's own waitFor polling, which otherwise
  // hangs forever under fully-faked timers), while vi.advanceTimersByTime
  // below still fast-forwards the 1s setInterval tick deterministically.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // VoiceInputSettingsProvider persists micDeviceId to localStorage --
  // clear it so one test's setSettings() can't leak into the next.
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

interface HarnessProps {
  startRecordingFn: (options: StartRecordingOptions) => Promise<void>;
  stopRecordingFn: () => Promise<RecordingResult>;
}

const finished = (over: Partial<RecordingResult> = {}): RecordingResult => ({
  path: "",
  durationSeconds: 0,
  silentSources: [],
  ...over,
});

function Harness() {
  const recording = useRecording();
  const { items } = useQueue();
  const { setSettings } = useVoiceInputSettings();
  return (
    <div>
      <p data-testid="status">{recording.status}</p>
      <p data-testid="elapsed">{recording.elapsedSeconds}</p>
      <p data-testid="error">{recording.error ?? ""}</p>
      <p data-testid="silent">{(recording.silentSources ?? []).join(",")}</p>
      <p data-testid="queue-count">{items.length}</p>
      <p data-testid="queue-origin">{items[0]?.origin ?? ""}</p>
      <button type="button" onClick={() => void recording.start()}>
        start
      </button>
      <button type="button" onClick={() => void recording.stop()}>
        stop
      </button>
      <button type="button" onClick={() => setSettings({ micDeviceId: "mic-2" })}>
        use-mic-2
      </button>
      <button type="button" onClick={() => setSettings({ audioSource: "both", outputDeviceId: "out-9" })}>
        use-both
      </button>
    </div>
  );
}

function renderHarness(props: HarnessProps) {
  return render(
    <VoiceInputSettingsProvider>
      <QueueProvider transcribeFn={() => Promise.resolve({ text: "", rendered: "" })}>
        <RecordingProvider startRecordingFn={props.startRecordingFn} stopRecordingFn={props.stopRecordingFn}>
          <Harness />
        </RecordingProvider>
      </QueueProvider>
    </VoiceInputSettingsProvider>,
  );
}

describe("RecordingContext", () => {
  it("starts idle", () => {
    renderHarness({ startRecordingFn: vi.fn(async () => {}), stopRecordingFn: vi.fn(async () => finished()) });
    expect(screen.getByTestId("status").textContent).toBe("idle");
  });

  it("start() passes the selected mic device id and transitions to recording", async () => {
    const startRecordingFn = vi.fn(async () => {});
    renderHarness({ startRecordingFn, stopRecordingFn: vi.fn(async () => finished()) });

    fireEvent.click(screen.getByText("use-mic-2"));
    fireEvent.click(screen.getByText("start"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("recording"));
    expect(startRecordingFn).toHaveBeenCalledWith({
      source: "microphone",
      deviceId: "mic-2",
      outputDeviceId: undefined,
    });
  });

  it("start() passes the chosen audio source and output device through", async () => {
    const startRecordingFn = vi.fn(async () => {});
    renderHarness({ startRecordingFn, stopRecordingFn: vi.fn(async () => finished()) });

    fireEvent.click(screen.getByText("use-both"));
    fireEvent.click(screen.getByText("start"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("recording"));
    expect(startRecordingFn).toHaveBeenCalledWith({
      source: "both",
      deviceId: undefined,
      outputDeviceId: "out-9",
    });
  });

  it("defaults to microphone-only when nothing has been chosen", async () => {
    // Upgrading into this version must not start capturing system audio on
    // its own -- that needs a macOS permission grant the user never gave.
    const startRecordingFn = vi.fn(async () => {});
    renderHarness({ startRecordingFn, stopRecordingFn: vi.fn(async () => finished()) });

    fireEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("recording"));
    expect(startRecordingFn).toHaveBeenCalledWith(expect.objectContaining({ source: "microphone" }));
  });

  it("reports a source that recorded nothing but silence, without failing the recording", async () => {
    // macOS denies system-audio capture silently: the stream opens, the file
    // is real, and every frame is zero. The queue still gets the file.
    const stopRecordingFn = vi.fn(async () =>
      finished({ path: "/recordings/r2.wav", silentSources: ["system audio"] }),
    );
    renderHarness({ startRecordingFn: vi.fn(async () => {}), stopRecordingFn });

    fireEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("recording"));
    fireEvent.click(screen.getByText("stop"));

    await waitFor(() => expect(screen.getByTestId("silent").textContent).toBe("system audio"));
    expect(screen.getByTestId("error").textContent).toBe("");
    expect(screen.getByTestId("queue-count").textContent).toBe("1");
  });

  it("clears a previous silent-source warning when a new recording starts", async () => {
    const stopRecordingFn = vi.fn(async () => finished({ silentSources: ["system audio"] }));
    renderHarness({ startRecordingFn: vi.fn(async () => {}), stopRecordingFn });

    fireEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("recording"));
    fireEvent.click(screen.getByText("stop"));
    await waitFor(() => expect(screen.getByTestId("silent").textContent).toBe("system audio"));

    fireEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("silent").textContent).toBe(""));
  });

  it("ticks elapsedSeconds once a second while recording, with no upper bound", async () => {
    renderHarness({
      startRecordingFn: vi.fn(async () => {}),
      stopRecordingFn: vi.fn(async () => finished()),
    });

    fireEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("recording"));

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId("elapsed").textContent).toBe("5");

    // No cap: keeps ticking well past an hour.
    await act(async () => {
      vi.advanceTimersByTime(3600_000);
    });
    expect(Number(screen.getByTestId("elapsed").textContent)).toBe(3605);
  });

  it("start() failure surfaces an error and stays idle", async () => {
    const startRecordingFn = vi.fn(async () => {
      throw new Error("no microphone available");
    });
    renderHarness({ startRecordingFn, stopRecordingFn: vi.fn(async () => finished()) });

    fireEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("no microphone available"));
    expect(screen.getByTestId("status").textContent).toBe("idle");
  });

  it("stop() finalizes the recording, adds it to the queue, and resets to idle", async () => {
    const stopRecordingFn = vi.fn(async () => finished({ path: "/recordings/r1.wav", durationSeconds: 12 }));
    renderHarness({ startRecordingFn: vi.fn(async () => {}), stopRecordingFn });

    fireEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("recording"));

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    fireEvent.click(screen.getByText("stop"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("idle"));
    expect(stopRecordingFn).toHaveBeenCalled();
    expect(screen.getByTestId("queue-count").textContent).toBe("1");
    expect(screen.getByTestId("elapsed").textContent).toBe("0");
    // 2026-09-30: tagged "recording" so App.tsx's AppShell can auto-trash
    // this file once its transcription succeeds, unlike an uploaded file.
    expect(screen.getByTestId("queue-origin").textContent).toBe("recording");
  });

  it("stop() failure surfaces an error and still returns to idle (never stuck stopping)", async () => {
    const stopRecordingFn = vi.fn(async () => {
      throw new Error("failed to finalize WAV file");
    });
    renderHarness({ startRecordingFn: vi.fn(async () => {}), stopRecordingFn });

    fireEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("recording"));

    fireEvent.click(screen.getByText("stop"));
    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("failed to finalize WAV file"));
    expect(screen.getByTestId("status").textContent).toBe("idle");
    expect(screen.getByTestId("queue-count").textContent).toBe("0");
  });
});

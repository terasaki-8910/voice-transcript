// F17 (gui-queue). Pins the sequential, one-at-a-time processing behavior
// and ACCEPTANCE G5 (a failed item does not block the rest of the queue).
// Uses the injectable transcribeFn -- no Tauri runtime involved, so no
// module mocking is needed here (unlike QueueView/App-level tests, which
// also mount useDragDrop).
import { describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueueProvider, useQueue } from "../../src/features/queue/QueueContext";
import { VoiceInputSettingsProvider, useVoiceInputSettings } from "../../src/features/preferences/VoiceInputSettingsContext";
import type { TranscribeProgress, TranscribeRequest, TranscribeResponse } from "../../src/lib/tauri";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function QueueInspector() {
  const { items, addFiles, retry } = useQueue();
  return (
    <div>
      <button type="button" onClick={() => addFiles(["/audio/a.m4a", "/audio/b.m4a"])}>
        add
      </button>
      <button type="button" onClick={() => addFiles(["/recordings/r.wav"], "recording")}>
        add-recording
      </button>
      <ul>
        {items.map((item) => (
          <li key={item.id} data-testid={item.fileName}>
            {item.status}
            {item.origin && `:${item.origin}`}
            {item.error && `:${item.error}`}
            {item.status === "failed" && (
              <button type="button" onClick={() => retry(item.id)}>
                retry-{item.fileName}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderQueue(transcribeFn: (request: TranscribeRequest) => Promise<TranscribeResponse>) {
  return render(
    <VoiceInputSettingsProvider>
      <QueueProvider transcribeFn={transcribeFn}>
        <QueueInspector />
      </QueueProvider>
    </VoiceInputSettingsProvider>,
  );
}

describe("QueueContext", () => {
  it("processes queued items one at a time, in order", async () => {
    const calls: TranscribeRequest[] = [];
    const deferreds: ReturnType<typeof deferred<TranscribeResponse>>[] = [];
    const transcribeFn = vi.fn((request: TranscribeRequest) => {
      calls.push(request);
      const d = deferred<TranscribeResponse>();
      deferreds.push(d);
      return d.promise;
    });

    renderQueue(transcribeFn);
    fireEvent.click(screen.getByText("add"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].filePath).toBe("/audio/a.m4a");
    expect(screen.getByTestId("a.m4a").textContent).toContain("transcribing");
    expect(screen.getByTestId("b.m4a").textContent).toContain("queued");

    deferreds[0].resolve({ text: "hello a", rendered: "hello a" });
    await waitFor(() => expect(screen.getByTestId("a.m4a").textContent).toContain("done"));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].filePath).toBe("/audio/b.m4a");

    deferreds[1].resolve({ text: "hello b", rendered: "hello b" });
    await waitFor(() => expect(screen.getByTestId("b.m4a").textContent).toContain("done"));
  });

  it("a failed item does not block the next queued item (G5)", async () => {
    const deferreds: ReturnType<typeof deferred<TranscribeResponse>>[] = [];
    const transcribeFn = vi.fn(() => {
      const d = deferred<TranscribeResponse>();
      deferreds.push(d);
      return d.promise;
    });

    renderQueue(transcribeFn);
    fireEvent.click(screen.getByText("add"));

    await waitFor(() => expect(deferreds).toHaveLength(1));
    deferreds[0].reject(new Error("boom"));

    await waitFor(() => expect(screen.getByTestId("a.m4a").textContent).toContain("failed"));
    expect(screen.getByTestId("a.m4a").textContent).toContain("boom");

    await waitFor(() => expect(deferreds).toHaveLength(2));
    deferreds[1].resolve({ text: "hello b", rendered: "hello b" });
    await waitFor(() => expect(screen.getByTestId("b.m4a").textContent).toContain("done"));
  });

  it("retry re-queues a failed item and reprocesses it", async () => {
    const deferreds: ReturnType<typeof deferred<TranscribeResponse>>[] = [];
    const transcribeFn = vi.fn(() => {
      const d = deferred<TranscribeResponse>();
      deferreds.push(d);
      return d.promise;
    });

    renderQueue(transcribeFn);
    fireEvent.click(screen.getByText("add"));

    await waitFor(() => expect(deferreds).toHaveLength(1));
    deferreds[0].reject(new Error("boom"));
    await waitFor(() => expect(screen.getByTestId("a.m4a").textContent).toContain("failed"));

    // Let b finish first so a is the only queued item left when retried.
    await waitFor(() => expect(deferreds).toHaveLength(2));
    deferreds[1].resolve({ text: "hello b", rendered: "hello b" });
    await waitFor(() => expect(screen.getByTestId("b.m4a").textContent).toContain("done"));

    fireEvent.click(screen.getByText("retry-a.m4a"));
    await waitFor(() => expect(deferreds).toHaveLength(3));
    expect(screen.getByTestId("a.m4a").textContent).toContain("transcribing");

    deferreds[2].resolve({ text: "hello a retried", rendered: "hello a retried" });
    await waitFor(() => expect(screen.getByTestId("a.m4a").textContent).toContain("done"));
  });

  it("tags files added with an origin, and leaves a plain add() untagged (2026-09-30, auto-trash)", async () => {
    const transcribeFn = vi.fn(() => new Promise<TranscribeResponse>(() => {})); // never resolves; status is all we check
    renderQueue(transcribeFn);

    fireEvent.click(screen.getByText("add"));
    await waitFor(() => expect(screen.getByTestId("a.m4a").textContent).not.toContain(":recording"));

    fireEvent.click(screen.getByText("add-recording"));
    await waitFor(() => expect(screen.getByTestId("r.wav").textContent).toContain(":recording"));
  });

  it("retry keeps a recording's origin tag", async () => {
    const deferreds: ReturnType<typeof deferred<TranscribeResponse>>[] = [];
    const transcribeFn = vi.fn(() => {
      const d = deferred<TranscribeResponse>();
      deferreds.push(d);
      return d.promise;
    });

    renderQueue(transcribeFn);
    fireEvent.click(screen.getByText("add-recording"));

    await waitFor(() => expect(deferreds).toHaveLength(1));
    deferreds[0].reject(new Error("boom"));
    await waitFor(() => expect(screen.getByTestId("r.wav").textContent).toContain("failed"));

    fireEvent.click(screen.getByText("retry-r.wav"));
    await waitFor(() => expect(screen.getByTestId("r.wav").textContent).toContain(":recording"));
  });
});

// ACCEPTANCE G12: QueueContext must read Settings > Voice input's model and
// language instead of a hardcoded default -- this is what makes SPEC.md's
// "model/language exposed as GUI controls" promise true. Exercises the real
// VoiceInputSettingsContext (not a mock) so a regression back to a hardcoded
// constant would actually fail this test.
function SettingsInspector() {
  const { model, autoDetectLanguage, setSettings } = useVoiceInputSettings();
  return (
    <div>
      <p data-testid="model">{model}</p>
      <button type="button" onClick={() => setSettings({ model: "whisper-large-v3" })}>
        use-large-v3
      </button>
      <button
        type="button"
        onClick={() => setSettings({ autoDetectLanguage: false, language: "fr" })}
        disabled={!autoDetectLanguage}
      >
        force-french
      </button>
      <button type="button" onClick={() => setSettings({ trimSilence: true })}>
        trim-on
      </button>
    </div>
  );
}

describe("QueueContext reads Voice input settings (G12)", () => {
  it("sends the Settings-selected model instead of a hardcoded default", async () => {
    const transcribeFn = vi.fn((_request: TranscribeRequest) => Promise.resolve({ text: "", rendered: "" }));
    render(
      <VoiceInputSettingsProvider>
        <SettingsInspector />
        <QueueProvider transcribeFn={transcribeFn}>
          <QueueInspector />
        </QueueProvider>
      </VoiceInputSettingsProvider>,
    );

    fireEvent.click(screen.getByText("use-large-v3"));
    await waitFor(() => expect(screen.getByTestId("model").textContent).toBe("whisper-large-v3"));

    fireEvent.click(screen.getByText("add"));
    await waitFor(() => expect(transcribeFn).toHaveBeenCalled());
    expect(transcribeFn.mock.calls[0][0]).toMatchObject({ model: "whisper-large-v3" });
  });

  it("omits language while auto-detect is on, and sends the override once it's off", async () => {
    const transcribeFn = vi.fn((_request: TranscribeRequest) => Promise.resolve({ text: "", rendered: "" }));
    render(
      <VoiceInputSettingsProvider>
        <SettingsInspector />
        <QueueProvider transcribeFn={transcribeFn}>
          <QueueInspector />
        </QueueProvider>
      </VoiceInputSettingsProvider>,
    );

    fireEvent.click(screen.getByText("add"));
    await waitFor(() => expect(transcribeFn.mock.calls.length).toBeGreaterThanOrEqual(1));
    expect(transcribeFn.mock.calls[0][0].language).toBeUndefined();

    // Let the first batch fully settle (transcribeFn resolves immediately,
    // unlike the deferred() tests above -- both queued items can finish
    // before this point) before switching settings and enqueuing more, so
    // the new calls are unambiguously the ones made under the new setting.
    await waitFor(() => expect(screen.getByTestId("a.m4a").textContent).toContain("done"));
    fireEvent.click(screen.getByText("force-french"));
    const callsBeforeSecondBatch = transcribeFn.mock.calls.length;
    fireEvent.click(screen.getByText("add"));
    await waitFor(() => expect(transcribeFn.mock.calls.length).toBeGreaterThan(callsBeforeSecondBatch));
    expect(transcribeFn.mock.calls[callsBeforeSecondBatch][0].language).toBe("fr");
  });
});

describe("QueueContext sends trimSilence", () => {
  it("is false by default and true once the setting is on", async () => {
    window.localStorage.clear();
    const transcribeFn = vi.fn((_request: TranscribeRequest) => Promise.resolve({ text: "", rendered: "" }));
    render(
      <VoiceInputSettingsProvider>
        <SettingsInspector />
        <QueueProvider transcribeFn={transcribeFn}>
          <QueueInspector />
        </QueueProvider>
      </VoiceInputSettingsProvider>,
    );

    fireEvent.click(screen.getByText("add"));
    await waitFor(() => expect(transcribeFn.mock.calls.length).toBeGreaterThanOrEqual(1));
    expect(transcribeFn.mock.calls[0][0].trimSilence).toBe(false);

    await waitFor(() => expect(screen.getByTestId("a.m4a").textContent).toContain("done"));
    fireEvent.click(screen.getByText("trim-on"));
    const before = transcribeFn.mock.calls.length;
    fireEvent.click(screen.getByText("add"));
    await waitFor(() => expect(transcribeFn.mock.calls.length).toBeGreaterThan(before));
    expect(transcribeFn.mock.calls[before][0].trimSilence).toBe(true);
  });
});

describe("QueueContext progress", () => {
  function ProgressInspector() {
    const { items, addFiles } = useQueue();
    return (
      <div>
        <button type="button" onClick={() => addFiles(["/audio/long.m4a"])}>
          add
        </button>
        {items.map((item) => (
          <div key={item.id} data-testid="item" data-id={item.id}>
            {item.status}:{item.progress ? `${String(item.progress.done)}/${String(item.progress.total)}` : "none"}
          </div>
        ))}
      </div>
    );
  }

  it("attributes progress to the transcribing item by runId and clears it when done", async () => {
    let emit: ((p: TranscribeProgress) => void) | undefined;
    const subscribeProgressFn = vi.fn(async (handler: (p: TranscribeProgress) => void) => {
      emit = handler;
      return () => {};
    });
    const pending = deferred<TranscribeResponse>();
    const requests: TranscribeRequest[] = [];
    render(
      <VoiceInputSettingsProvider>
        <QueueProvider
          transcribeFn={(r) => {
            requests.push(r);
            return pending.promise;
          }}
          subscribeProgressFn={subscribeProgressFn}
        >
          <ProgressInspector />
        </QueueProvider>
      </VoiceInputSettingsProvider>,
    );
    fireEvent.click(screen.getByText("add"));
    await waitFor(() => expect(requests).toHaveLength(1));
    const id = screen.getByTestId("item").getAttribute("data-id");
    expect(requests[0].runId).toBe(id);

    act(() => {
      emit?.({ runId: "someone-else", event: { type: "chunks-planned", total: 9 } });
      emit?.({ runId: id, event: { type: "chunks-planned", total: 5 } });
      emit?.({ runId: id, event: { type: "chunk-done", chunk: 1, done: 1, total: 5 } });
    });
    expect(screen.getByTestId("item").textContent).toBe("transcribing:1/5");

    pending.resolve({ text: "t", rendered: "t" });
    await waitFor(() => expect(screen.getByTestId("item").textContent).toBe("done:none"));

    // A straggler after completion never repaints the finished row.
    act(() => emit?.({ runId: id, event: { type: "chunks-planned", total: 5 } }));
    expect(screen.getByTestId("item").textContent).toBe("done:none");
  });
});


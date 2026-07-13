// F17 (gui-queue). Pins QueueRow's status chip mapping, the "View" expand
// for done items, and the "Retry" action for failed items. Driven through a
// real QueueProvider (injectable transcribeFn) rather than a hand-built
// item prop, so the status transitions match what QueueContext actually
// produces.
//
// Post-integration fix batch (2026-07-13): pins the per-row Export button,
// which calls pickSavePath (-> @tauri-apps/plugin-dialog's save()) and
// exportTranscript (-> invoke()) directly -- both mocked at the module
// level since QueueRow has no injectable seam for them (consistent with
// how other direct Tauri API calls are mocked elsewhere in this suite).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { QueueProvider, useQueue } from "../../src/features/queue/QueueContext";
import { QueueRow } from "../../src/features/queue/QueueRow";
import { SelectionProvider } from "../../src/features/selection/SelectionContext";
import type { TranscribeRequest, TranscribeResponse } from "../../src/lib/tauri";

const save = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => save(...args),
}));

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

function RowHarness({ transcribeFn }: { transcribeFn: (request: TranscribeRequest) => Promise<TranscribeResponse> }) {
  return (
    <I18nProvider>
      <SelectionProvider>
        <QueueProvider transcribeFn={transcribeFn}>
          <RowList />
        </QueueProvider>
      </SelectionProvider>
    </I18nProvider>
  );
}

function RowList() {
  const { items, addFiles } = useQueue();
  return (
    <div>
      <button type="button" onClick={() => addFiles(["/audio/a.m4a"])}>
        add
      </button>
      {items.map((item) => (
        <QueueRow key={item.id} item={item} />
      ))}
    </div>
  );
}

describe("QueueRow", () => {
  it("a done item shows the Done chip and expands its transcript via View", async () => {
    render(<RowHarness transcribeFn={() => Promise.resolve({ text: "hello world", rendered: "hello world" })} />);
    fireEvent.click(screen.getByText("add"));

    await waitFor(() => expect(screen.getByText("Done")).toBeDefined());
    expect(screen.queryByText("hello world")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(screen.getByText("hello world")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("hello world")).toBeNull();
  });

  it("a failed item shows the Failed chip, its error, and can be retried", async () => {
    let attempt = 0;
    render(
      <RowHarness
        transcribeFn={() => {
          attempt += 1;
          return attempt === 1 ? Promise.reject(new Error("network down")) : Promise.resolve({ text: "ok", rendered: "ok" });
        }}
      />,
    );
    fireEvent.click(screen.getByText("add"));

    await waitFor(() => expect(screen.getByText("Failed")).toBeDefined());
    expect(screen.getByText("network down")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Done")).toBeDefined());
  });

  it("Export picks a save path and writes the transcript directly, without needing View first", async () => {
    save.mockResolvedValue("/tmp/a.m4a.txt");
    invoke.mockResolvedValue(undefined);
    render(<RowHarness transcribeFn={() => Promise.resolve({ text: "hello world", rendered: "hello world" })} />);
    fireEvent.click(screen.getByText("add"));

    await waitFor(() => expect(screen.getByText("Done")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith({ defaultPath: "a.m4a.txt" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("export_transcript", { path: "/tmp/a.m4a.txt", content: "hello world" }));
  });

  it("Export does nothing when the save dialog is cancelled", async () => {
    save.mockReset();
    invoke.mockReset();
    save.mockResolvedValue(null);
    render(<RowHarness transcribeFn={() => Promise.resolve({ text: "hello world", rendered: "hello world" })} />);
    fireEvent.click(screen.getByText("add"));

    await waitFor(() => expect(screen.getByText("Done")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("an Export failure surfaces an error instead of silently doing nothing", async () => {
    save.mockReset();
    invoke.mockReset();
    save.mockResolvedValue("/tmp/a.m4a.txt");
    invoke.mockRejectedValue(new Error("permission denied"));
    render(<RowHarness transcribeFn={() => Promise.resolve({ text: "hello world", rendered: "hello world" })} />);
    fireEvent.click(screen.getByText("add"));

    await waitFor(() => expect(screen.getByText("Done")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(screen.getByText("permission denied")).toBeDefined());
  });

  // User testing feedback, 2026-07-14: a queue with no way to clear
  // finished items just grows forever until restart.
  it("Remove from queue removes a done item from the list", async () => {
    render(<RowHarness transcribeFn={() => Promise.resolve({ text: "hello world", rendered: "hello world" })} />);
    fireEvent.click(screen.getByText("add"));

    await waitFor(() => expect(screen.getByText("Done")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Remove from queue" }));

    expect(screen.queryByText("Done")).toBeNull();
  });

  it("Remove from queue removes a failed item from the list", async () => {
    render(<RowHarness transcribeFn={() => Promise.reject(new Error("network down"))} />);
    fireEvent.click(screen.getByText("add"));

    await waitFor(() => expect(screen.getByText("Failed")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Remove from queue" }));

    expect(screen.queryByText("Failed")).toBeNull();
  });

  it("a queued or transcribing item has no Remove from queue button yet", () => {
    render(<RowHarness transcribeFn={() => new Promise(() => {})} />);
    fireEvent.click(screen.getByText("add"));

    expect(screen.queryByRole("button", { name: "Remove from queue" })).toBeNull();
  });
});

// F17 (gui-queue). Pins QueueRow's status chip mapping, the "View" expand
// for done items, and the "Retry" action for failed items. Driven through a
// real QueueProvider (injectable transcribeFn) rather than a hand-built
// item prop, so the status transitions match what QueueContext actually
// produces.
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { QueueProvider, useQueue } from "../../src/features/queue/QueueContext";
import { QueueRow } from "../../src/features/queue/QueueRow";
import type { TranscribeRequest, TranscribeResponse } from "../../src/lib/tauri";

function RowHarness({ transcribeFn }: { transcribeFn: (request: TranscribeRequest) => Promise<TranscribeResponse> }) {
  return (
    <I18nProvider>
      <QueueProvider transcribeFn={transcribeFn}>
        <RowList />
      </QueueProvider>
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

    fireEvent.click(screen.getByRole("button", { name: "−" }));
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
});

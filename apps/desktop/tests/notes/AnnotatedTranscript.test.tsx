// Transcript notes (SPEC.md > Transcript notes). Pins AnnotatedTranscript's
// interactive layer -- drag-select -> "add note" popover -> save/cancel,
// click a highlighted note -> view/edit/delete, and the "add to dictionary"
// mini-form -- against plain injected callbacks (the same DI seam
// HistoryRow/QueueRow use via useTranscriptNotes), so this suite never
// needs to touch Tauri IPC itself. Only @tauri-apps/plugin-dialog's
// confirm() is mocked, for the delete step.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { AnnotatedTranscript } from "../../src/features/notes/AnnotatedTranscript";
import type { TranscriptNote } from "../../src/lib/tauri";

const confirmDialog = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: (...args: unknown[]) => confirmDialog(...args),
}));

function select(startNode: Node, startOffset: number, endNode: Node, endOffset: number) {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function makeNote(overrides: Partial<TranscriptNote> = {}): TranscriptNote {
  return {
    id: 1,
    transcriptionId: 10,
    startOffset: 0,
    endOffset: 6,
    quotedText: "2GOMCP",
    note: "正しくはTogoMCP",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function renderTranscript(props: Partial<React.ComponentProps<typeof AnnotatedTranscript>> = {}) {
  const onAddNote = vi.fn(async () => {});
  const onUpdateNote = vi.fn(async () => {});
  const onDeleteNote = vi.fn(async () => {});
  const onLinkToDictionary = vi.fn(async () => {});
  const utils = render(
    <I18nProvider>
      <AnnotatedTranscript
        text="2GOMCPについて話しました"
        notes={[]}
        breakAtPeriod={false}
        onAddNote={onAddNote}
        onUpdateNote={onUpdateNote}
        onDeleteNote={onDeleteNote}
        onLinkToDictionary={onLinkToDictionary}
        {...props}
      />
    </I18nProvider>,
  );
  return { ...utils, onAddNote, onUpdateNote, onDeleteNote, onLinkToDictionary };
}

describe("AnnotatedTranscript", () => {
  beforeEach(() => {
    confirmDialog.mockReset();
    window.getSelection()?.removeAllRanges();
  });

  it("renders plain text with no popover when nothing is selected", () => {
    const { container } = renderTranscript();
    expect(container.querySelector("p")?.textContent).toBe("2GOMCPについて話しました");
    expect(container.querySelector(".note-popover")).toBeNull();
  });

  it("dragging a selection opens the add-note popover with the quoted text", () => {
    const { container } = renderTranscript();
    const textNode = container.querySelector("p")!.firstChild!;
    select(textNode, 0, textNode, 6); // "2GOMCP"
    fireEvent.mouseUp(document);
    expect(screen.getByText('"2GOMCP"')).toBeDefined();
  });

  it("saving a new note calls onAddNote with the raw offsets and quoted text, then closes the popover", async () => {
    const { container, onAddNote } = renderTranscript();
    const textNode = container.querySelector("p")!.firstChild!;
    select(textNode, 0, textNode, 6);
    fireEvent.mouseUp(document);

    fireEvent.change(screen.getByPlaceholderText(/TogoMCP/), { target: { value: "正しくはTogoMCP" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onAddNote).toHaveBeenCalledWith(0, 6, "2GOMCP", "正しくはTogoMCP"));
    expect(screen.queryByText('"2GOMCP"')).toBeNull();
  });

  it("shows onAddNote's rejection inline and keeps the popover open", async () => {
    const onAddNote = vi.fn(async () => {
      throw new Error("This range overlaps an existing note.");
    });
    const { container } = renderTranscript({ onAddNote });
    const textNode = container.querySelector("p")!.firstChild!;
    select(textNode, 0, textNode, 6);
    fireEvent.mouseUp(document);

    fireEvent.change(screen.getByPlaceholderText(/TogoMCP/), { target: { value: "note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("This range overlaps an existing note.")).toBeDefined());
    expect(screen.getByText('"2GOMCP"')).toBeDefined();
  });

  it("Cancel dismisses the new-note popover without calling onAddNote", () => {
    const { container, onAddNote } = renderTranscript();
    const textNode = container.querySelector("p")!.firstChild!;
    select(textNode, 0, textNode, 6);
    fireEvent.mouseUp(document);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText('"2GOMCP"')).toBeNull();
    expect(onAddNote).not.toHaveBeenCalled();
  });

  it("clicking a highlighted note opens its view popover", () => {
    renderTranscript({ notes: [makeNote()] });
    fireEvent.click(screen.getByText("2GOMCP"));
    expect(screen.getByText("正しくはTogoMCP")).toBeDefined();
  });

  it("Edit switches to a textarea and Save calls onUpdateNote", async () => {
    const { onUpdateNote } = renderTranscript({ notes: [makeNote()] });
    fireEvent.click(screen.getByText("2GOMCP"));
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));

    const textarea = screen.getByDisplayValue("正しくはTogoMCP");
    fireEvent.change(textarea, { target: { value: "更新後" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onUpdateNote).toHaveBeenCalledWith(1, "更新後"));
  });

  it("Delete confirms, then calls onDeleteNote and closes the popover", async () => {
    confirmDialog.mockResolvedValueOnce(true);
    const { onDeleteNote } = renderTranscript({ notes: [makeNote()] });
    fireEvent.click(screen.getByText("2GOMCP"));
    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));

    await waitFor(() => expect(onDeleteNote).toHaveBeenCalledWith(1));
    expect(screen.queryByText("正しくはTogoMCP")).toBeNull();
  });

  it("Delete does nothing if the confirm dialog is declined", async () => {
    confirmDialog.mockResolvedValueOnce(false);
    const { onDeleteNote } = renderTranscript({ notes: [makeNote()] });
    fireEvent.click(screen.getByText("2GOMCP"));
    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));

    await waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    expect(onDeleteNote).not.toHaveBeenCalled();
  });

  it("linking a note to the dictionary calls onLinkToDictionary and shows a success message", async () => {
    const { onLinkToDictionary } = renderTranscript({ notes: [makeNote()] });
    fireEvent.click(screen.getByText("2GOMCP"));

    fireEvent.change(screen.getByLabelText("Correct to"), { target: { value: "TogoMCP" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to dictionary" }));

    await waitFor(() => expect(onLinkToDictionary).toHaveBeenCalledWith("2GOMCP", "TogoMCP"));
    expect(screen.getByText(/future transcripts will auto-correct/)).toBeDefined();
  });

  it("Escape closes an open note popover", () => {
    renderTranscript({ notes: [makeNote()] });
    fireEvent.click(screen.getByText("2GOMCP"));
    expect(screen.getByText("正しくはTogoMCP")).toBeDefined();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("正しくはTogoMCP")).toBeNull();
  });

  // Real user report, 2026-09-25: clicking Save gave no feedback and the
  // popover only closed "after a bit," which read as broken -- the sidecar
  // round trip (a fresh Node subprocess per call, see commands.rs's
  // call_sidecar) is genuinely not instant. These pin the fix: an
  // immediate "Saving..."/disabled state, not just eventual dismissal.
  describe("busy state while a save is in flight", () => {
    function deferred<T>() {
      let resolve!: (v: T) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it("a new note's Save button shows immediate feedback and blocks a second click mid-flight", async () => {
      const gate = deferred<void>();
      const onAddNote = vi.fn(() => gate.promise);
      const { container } = renderTranscript({ onAddNote });
      const textNode = container.querySelector("p")!.firstChild!;
      select(textNode, 0, textNode, 6);
      fireEvent.mouseUp(document);
      fireEvent.change(screen.getByPlaceholderText(/TogoMCP/), { target: { value: "note" } });

      const saveButton = screen.getByRole("button", { name: "Save" });
      fireEvent.click(saveButton);

      // Immediate, synchronous feedback -- no waitFor: this must be true the
      // instant the click handler runs, before the promise ever settles.
      expect(screen.getByRole("button", { name: "Saving..." })).toHaveProperty("disabled", true);

      fireEvent.click(screen.getByRole("button", { name: "Saving..." }));
      expect(onAddNote).toHaveBeenCalledTimes(1); // the second click did nothing

      gate.resolve();
      await waitFor(() => expect(screen.queryByText('"2GOMCP"')).toBeNull());
    });

    it("outside click and Escape are ignored while a new note is saving", async () => {
      const gate = deferred<void>();
      const onAddNote = vi.fn(() => gate.promise);
      const { container } = renderTranscript({ onAddNote });
      const textNode = container.querySelector("p")!.firstChild!;
      select(textNode, 0, textNode, 6);
      fireEvent.mouseUp(document);
      fireEvent.change(screen.getByPlaceholderText(/TogoMCP/), { target: { value: "note" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      fireEvent.mouseDown(document.body);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.getByText('"2GOMCP"')).toBeDefined(); // still open, request still in flight

      gate.resolve();
      await waitFor(() => expect(screen.queryByText('"2GOMCP"')).toBeNull());
    });

    it("a save failure re-enables the form instead of leaving it stuck disabled", async () => {
      const gate = deferred<void>();
      const onAddNote = vi.fn(() => gate.promise);
      const { container } = renderTranscript({ onAddNote });
      const textNode = container.querySelector("p")!.firstChild!;
      select(textNode, 0, textNode, 6);
      fireEvent.mouseUp(document);
      fireEvent.change(screen.getByPlaceholderText(/TogoMCP/), { target: { value: "note" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      gate.reject(new Error("db unreachable"));
      await waitFor(() => expect(screen.getByText("db unreachable")).toBeDefined());
      expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
    });

    it("editing an existing note shows the same immediate busy feedback", async () => {
      const gate = deferred<void>();
      const onUpdateNote = vi.fn(() => gate.promise);
      renderTranscript({ notes: [makeNote()], onUpdateNote });
      fireEvent.click(screen.getByText("2GOMCP"));
      fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
      fireEvent.change(screen.getByDisplayValue("正しくはTogoMCP"), { target: { value: "更新後" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(screen.getByRole("button", { name: "Saving..." })).toHaveProperty("disabled", true);
      gate.resolve();
      await waitFor(() => expect(onUpdateNote).toHaveBeenCalledWith(1, "更新後"));
    });

    it("deleting shows immediate busy feedback after the confirm dialog", async () => {
      confirmDialog.mockResolvedValueOnce(true);
      const gate = deferred<void>();
      const onDeleteNote = vi.fn(() => gate.promise);
      renderTranscript({ notes: [makeNote()], onDeleteNote });
      fireEvent.click(screen.getByText("2GOMCP"));
      fireEvent.click(screen.getByRole("button", { name: "Delete note" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "Deleting..." })).toBeDefined());
      gate.resolve();
      await waitFor(() => expect(screen.queryByText("正しくはTogoMCP")).toBeNull());
    });
  });
});

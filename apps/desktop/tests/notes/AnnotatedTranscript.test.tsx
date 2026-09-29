// Transcript notes (SPEC.md > Transcript notes). Pins AnnotatedTranscript's
// interactive layer -- drag-select -> "add note" popover -> save/cancel,
// click a highlighted note -> view/edit/delete/failed, and the "add to
// dictionary" mini-form -- against plain injected callbacks (the same DI
// seam HistoryRow/QueueRow use via useTranscriptNotes), so this suite
// never needs to touch Tauri IPC itself. Only @tauri-apps/plugin-dialog's
// confirm() is mocked, for the delete step.
//
// add/update/delete/retry/discard are now plain (non-Promise) callbacks --
// AnnotatedTranscript applies them fire-and-forget and closes its popover
// synchronously (2026-09-29, user-reported: optimistic save/cancel). The
// actual optimistic-apply/rollback/failure-recording logic they trigger
// lives in useTranscriptNotes and is pinned in useTranscriptNotes.test.tsx,
// not here -- this file only checks that AnnotatedTranscript calls them
// correctly and renders whatever notes/noteFailures it's given.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { AnnotatedTranscript } from "../../src/features/notes/AnnotatedTranscript";
import type { TranscriptNote } from "../../src/lib/tauri";
import type { NoteFailure } from "../../src/features/notes/useTranscriptNotes";

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
  const onAddNote = vi.fn();
  const onUpdateNote = vi.fn();
  const onDeleteNote = vi.fn();
  const onRetryNote = vi.fn();
  const onDiscardNote = vi.fn();
  const onLinkToDictionary = vi.fn(async () => {});
  const utils = render(
    <I18nProvider>
      <AnnotatedTranscript
        text="2GOMCPについて話しました"
        notes={[]}
        noteFailures={new Map()}
        breakAtPeriod={false}
        onAddNote={onAddNote}
        onUpdateNote={onUpdateNote}
        onDeleteNote={onDeleteNote}
        onRetryNote={onRetryNote}
        onDiscardNote={onDiscardNote}
        onLinkToDictionary={onLinkToDictionary}
        {...props}
      />
    </I18nProvider>,
  );
  return { ...utils, onAddNote, onUpdateNote, onDeleteNote, onRetryNote, onDiscardNote, onLinkToDictionary };
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

  it("keeps the popover inside the window, flipping above when a selection near the bottom-right leaves no room below", () => {
    const rectSpy = vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue({
      top: window.innerHeight - 68,
      bottom: window.innerHeight - 48,
      left: window.innerWidth - 124,
      right: window.innerWidth - 74,
      width: 50,
      height: 20,
      x: window.innerWidth - 124,
      y: window.innerHeight - 68,
      toJSON: () => ({}),
    } as DOMRect);
    // useClampedPopoverPosition measures the popover element itself through
    // this -- jsdom's own default (a zero rect) would report it as
    // zero-sized, so nothing would ever need to flip/clamp.
    const elementSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: 0,
      left: 0,
      right: 260,
      bottom: 200,
      width: 260,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    try {
      const { container } = renderTranscript();
      const textNode = container.querySelector("p")!.firstChild!;
      select(textNode, 0, textNode, 6);
      fireEvent.mouseUp(document);

      const popover = container.querySelector(".note-popover") as HTMLElement;
      expect(popover.style.top).toBe(`${window.innerHeight - 274}px`); // flipped above, not below
      expect(popover.style.left).toBe(`${window.innerWidth - 268}px`); // clamped off the right edge
      expect(popover.style.visibility).toBe("visible");
    } finally {
      rectSpy.mockRestore();
      elementSpy.mockRestore();
    }
  });

  it("Save calls onAddNote with the raw offsets and quoted text and closes the popover instantly", () => {
    const { container, onAddNote } = renderTranscript();
    const textNode = container.querySelector("p")!.firstChild!;
    select(textNode, 0, textNode, 6);
    fireEvent.mouseUp(document);

    fireEvent.change(screen.getByPlaceholderText(/TogoMCP/), { target: { value: "正しくはTogoMCP" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // No waitFor: onAddNote is a plain fire-and-forget callback now, and
    // the popover must be gone the instant the click handler runs.
    expect(onAddNote).toHaveBeenCalledWith(0, 6, "2GOMCP", "正しくはTogoMCP");
    expect(screen.queryByText('"2GOMCP"')).toBeNull();
  });

  it("Cmd+Enter in the new-note textarea saves", () => {
    const { container, onAddNote } = renderTranscript();
    const textNode = container.querySelector("p")!.firstChild!;
    select(textNode, 0, textNode, 6);
    fireEvent.mouseUp(document);

    const textarea = screen.getByPlaceholderText(/TogoMCP/);
    fireEvent.change(textarea, { target: { value: "note" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });

    expect(onAddNote).toHaveBeenCalledWith(0, 6, "2GOMCP", "note");
    expect(screen.queryByText('"2GOMCP"')).toBeNull();
  });

  it("Ctrl+Enter in the new-note textarea saves", () => {
    const { container, onAddNote } = renderTranscript();
    const textNode = container.querySelector("p")!.firstChild!;
    select(textNode, 0, textNode, 6);
    fireEvent.mouseUp(document);

    const textarea = screen.getByPlaceholderText(/TogoMCP/);
    fireEvent.change(textarea, { target: { value: "note" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    expect(onAddNote).toHaveBeenCalledTimes(1);
  });

  it("plain Enter in the new-note textarea does not save", () => {
    const { container, onAddNote } = renderTranscript();
    const textNode = container.querySelector("p")!.firstChild!;
    select(textNode, 0, textNode, 6);
    fireEvent.mouseUp(document);

    const textarea = screen.getByPlaceholderText(/TogoMCP/);
    fireEvent.change(textarea, { target: { value: "note" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onAddNote).not.toHaveBeenCalled();
    expect(screen.getByText('"2GOMCP"')).toBeDefined();
  });

  it.each([
    ["isComposing", { key: "Enter", metaKey: true, isComposing: true }],
    ["keyCode 229 (WebKit, isComposing already false)", { key: "Enter", metaKey: true, keyCode: 229 }],
  ])("Cmd+Enter during an IME composition (%s) does not save", (_label, eventInit) => {
    const { container, onAddNote } = renderTranscript();
    const textNode = container.querySelector("p")!.firstChild!;
    select(textNode, 0, textNode, 6);
    fireEvent.mouseUp(document);

    const textarea = screen.getByPlaceholderText(/TogoMCP/);
    fireEvent.change(textarea, { target: { value: "note" } });
    fireEvent.keyDown(textarea, eventInit);

    expect(onAddNote).not.toHaveBeenCalled();
    expect(screen.getByText('"2GOMCP"')).toBeDefined();
  });

  it("shows onAddNote's synchronous rejection inline and keeps the popover open", () => {
    const onAddNote = vi.fn(() => {
      throw new Error("This range overlaps an existing note.");
    });
    const { container } = renderTranscript({ onAddNote });
    const textNode = container.querySelector("p")!.firstChild!;
    select(textNode, 0, textNode, 6);
    fireEvent.mouseUp(document);

    fireEvent.change(screen.getByPlaceholderText(/TogoMCP/), { target: { value: "note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("This range overlaps an existing note.")).toBeDefined();
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

  it("Escape cancels the new-note popover", () => {
    const { container } = renderTranscript();
    const textNode = container.querySelector("p")!.firstChild!;
    select(textNode, 0, textNode, 6);
    fireEvent.mouseUp(document);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText('"2GOMCP"')).toBeNull();
  });

  it("clicking a highlighted note opens its view popover", () => {
    renderTranscript({ notes: [makeNote()] });
    fireEvent.click(screen.getByText("2GOMCP"));
    expect(screen.getByText("正しくはTogoMCP")).toBeDefined();
  });

  it("Edit switches to a textarea and Save calls onUpdateNote and returns to view mode instantly", () => {
    const { onUpdateNote } = renderTranscript({ notes: [makeNote()] });
    fireEvent.click(screen.getByText("2GOMCP"));
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));

    const textarea = screen.getByDisplayValue("正しくはTogoMCP");
    fireEvent.change(textarea, { target: { value: "更新後" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onUpdateNote).toHaveBeenCalledWith(1, "更新後");
    expect(screen.queryByDisplayValue("更新後")).toBeNull(); // back to view mode, not the textarea
  });

  it("Cmd+Enter in the edit textarea saves", () => {
    const { onUpdateNote } = renderTranscript({ notes: [makeNote()] });
    fireEvent.click(screen.getByText("2GOMCP"));
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));

    const textarea = screen.getByDisplayValue("正しくはTogoMCP");
    fireEvent.change(textarea, { target: { value: "更新後" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });

    expect(onUpdateNote).toHaveBeenCalledWith(1, "更新後");
  });

  it("Escape while editing returns to view mode instead of closing the popover, and a second Escape then closes it", () => {
    renderTranscript({ notes: [makeNote()] });
    fireEvent.click(screen.getByText("2GOMCP"));
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    expect(screen.getByDisplayValue("正しくはTogoMCP")).toBeDefined();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByDisplayValue("正しくはTogoMCP")).toBeNull(); // out of edit mode
    expect(screen.getByText("正しくはTogoMCP")).toBeDefined(); // still open, in view mode

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("正しくはTogoMCP")).toBeNull(); // now fully closed
  });

  it("Escape during an IME composition does not close the open-note popover", () => {
    renderTranscript({ notes: [makeNote()] });
    fireEvent.click(screen.getByText("2GOMCP"));

    fireEvent.keyDown(document, { key: "Escape", isComposing: true });
    expect(screen.getByText("正しくはTogoMCP")).toBeDefined();

    fireEvent.keyDown(document, { key: "Escape", keyCode: 229 });
    expect(screen.getByText("正しくはTogoMCP")).toBeDefined();
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

  it("Edit and Delete are disabled for a note still awaiting its first sync (temp id, no failure yet)", () => {
    renderTranscript({ notes: [makeNote({ id: -1 })] });
    fireEvent.click(screen.getByText("2GOMCP"));
    expect(screen.getByRole("button", { name: "Edit note" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Delete note" })).toHaveProperty("disabled", true);
  });

  it("linking a note to the dictionary calls onLinkToDictionary and shows a success message", async () => {
    const { onLinkToDictionary } = renderTranscript({ notes: [makeNote()] });
    fireEvent.click(screen.getByText("2GOMCP"));

    fireEvent.change(screen.getByLabelText("Correct to"), { target: { value: "TogoMCP" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to dictionary" }));

    await waitFor(() => expect(onLinkToDictionary).toHaveBeenCalledWith("2GOMCP", "TogoMCP"));
    expect(screen.getByText(/future transcripts will auto-correct/)).toBeDefined();
  });

  it("a slow dictionary-link request for a note the user has since closed doesn't write into whatever's open now", async () => {
    let resolveLink!: () => void;
    const onLinkToDictionary = vi.fn(() => new Promise<void>((res) => (resolveLink = res)));
    const noteA = makeNote({ id: 1, startOffset: 0, endOffset: 6, quotedText: "2GOMCP" });
    const noteB = makeNote({ id: 2, startOffset: 6, endOffset: 10, quotedText: "について", note: "second note" });
    renderTranscript({ notes: [noteA, noteB], onLinkToDictionary });

    fireEvent.click(screen.getByText("2GOMCP"));
    fireEvent.change(screen.getByLabelText("Correct to"), { target: { value: "TogoMCP" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to dictionary" }));
    expect(onLinkToDictionary).toHaveBeenCalledTimes(1);

    // Close A's popover (Escape) and open B's instead, THEN let A's
    // request resolve.
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByText("について"));
    resolveLink();

    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByText(/future transcripts will auto-correct/)).toBeNull();
    expect(screen.getByText("second note")).toBeDefined();
  });

  describe("a note with a background sync failure", () => {
    const failedNote = () => makeNote({ id: 1 });
    const failures = (action: NoteFailure["action"], error = "db unreachable") =>
      new Map<number, NoteFailure>([
        [
          1,
          action === "add"
            ? { action, error, args: { startOffset: 0, endOffset: 6, quotedText: "2GOMCP", note: "正しくはTogoMCP" } }
            : action === "update"
              ? { action, error, previousNote: "元の注釈", attemptedNote: "正しくはTogoMCP" }
              : { action, error, snapshot: failedNote() },
        ],
      ]);

    it("renders with the failed style instead of the normal highlight", () => {
      renderTranscript({ notes: [failedNote()], noteFailures: failures("add") });
      expect(screen.getByText("2GOMCP")).toHaveProperty("className", "transcript-note transcript-note-failed");
    });

    it.each([
      ["add", "This note wasn't saved."],
      ["update", "This edit wasn't saved."],
      ["delete", "This note wasn't deleted."],
    ] as const)("clicking a %s-failure shows its heading, the raw error, and Retry/Discard instead of view/edit", (action, heading) => {
      renderTranscript({ notes: [failedNote()], noteFailures: failures(action, "db unreachable") });
      fireEvent.click(screen.getByText("2GOMCP"));

      expect(screen.getByText(`${heading} db unreachable`)).toBeDefined();
      expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Discard" })).toBeDefined();
      expect(screen.queryByRole("button", { name: "Edit note" })).toBeNull();
    });

    it("Retry calls onRetryNote and closes the popover", () => {
      const { onRetryNote } = renderTranscript({ notes: [failedNote()], noteFailures: failures("update") });
      fireEvent.click(screen.getByText("2GOMCP"));
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(onRetryNote).toHaveBeenCalledWith(1);
      expect(screen.queryByText("Retry")).toBeNull();
    });

    it("Discard calls onDiscardNote and closes the popover", () => {
      const { onDiscardNote } = renderTranscript({ notes: [failedNote()], noteFailures: failures("delete") });
      fireEvent.click(screen.getByText("2GOMCP"));
      fireEvent.click(screen.getByRole("button", { name: "Discard" }));

      expect(onDiscardNote).toHaveBeenCalledWith(1);
      expect(screen.queryByText("Discard")).toBeNull();
    });
  });
});

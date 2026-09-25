// Pins the two halves of the offset contract transcript notes depend on
// (features/notes/textOffsets.ts): renderAnnotatedText must always be a
// byte-for-byte round trip back to the raw stored text (never insert or
// drop a character, however it dresses the DOM up with <mark>/<br>), and
// getSelectionOffsets must read that same DOM back out as the exact raw
// offsets a note should be saved with.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { getSelectionOffsets, renderAnnotatedText } from "../../src/features/notes/textOffsets";
import type { TextNoteRange } from "../../src/features/notes/textOffsets";

function renderNotePlain(run: { key: string; text: string; noteId: number }) {
  return createElement("mark", { key: run.key, "data-note-id": run.noteId }, run.text);
}

function renderInto(text: string, notes: TextNoteRange[], breakAtPeriod: boolean) {
  const nodes = renderAnnotatedText(text, notes, { breakAtPeriod, renderNote: renderNotePlain });
  const { container } = render(createElement("p", null, nodes));
  return container;
}

describe("renderAnnotatedText", () => {
  it("renders plain text unchanged with no notes and no period breaks", () => {
    const container = renderInto("hello world", [], false);
    expect(container.textContent).toBe("hello world");
    expect(container.querySelectorAll("br")).toHaveLength(0);
  });

  it("inserts a <br> after each 。 when breakAtPeriod is on, without adding a character", () => {
    const text = "こんにちは。今日は晴れです。";
    const container = renderInto(text, [], true);
    // Round trip: DOM text content, br elements aside, is exactly the raw
    // string -- this is the property the whole offset scheme depends on.
    expect(container.textContent).toBe(text);
    // One 。 is mid-string (break inserted), one is the last character (no
    // break -- mirrors breakAfterJapanesePeriod's own end-of-string rule).
    expect(container.querySelectorAll("br")).toHaveLength(1);
  });

  it("does not double-break a 。 already followed by a real newline", () => {
    const text = "です。\nつぎ。";
    const container = renderInto(text, [], true);
    expect(container.textContent).toBe(text);
    // The first 。 is already followed by \n (no break inserted there); the
    // second is the last character (no break either) -- zero <br>s total.
    expect(container.querySelectorAll("br")).toHaveLength(0);
  });

  it("wraps a note's range in renderNote's output and keeps surrounding text plain", () => {
    const text = "2GOMCPについて話しました";
    const notes: TextNoteRange[] = [{ id: 1, startOffset: 0, endOffset: 6 }];
    const container = renderInto(text, notes, false);
    expect(container.textContent).toBe(text);
    const mark = container.querySelector("mark");
    expect(mark?.textContent).toBe("2GOMCP");
    expect(mark?.getAttribute("data-note-id")).toBe("1");
  });

  it("keeps a <br> that falls inside a note's own range attached to the same note", () => {
    const text = "だめ。です。ここまで";
    // Note spans across the first period break (indices 0-5 cover "だめ。です。").
    const notes: TextNoteRange[] = [{ id: 7, startOffset: 0, endOffset: 6 }];
    const container = renderInto(text, notes, true);
    expect(container.textContent).toBe(text);
    // Both periods inside the note's own range qualify for a break (neither
    // is the last character of the whole string).
    expect(container.querySelectorAll("br")).toHaveLength(2);
    // All three pieces of the split note still render as <mark data-note-id="7">.
    const marks = container.querySelectorAll('mark[data-note-id="7"]');
    expect(marks.length).toBeGreaterThanOrEqual(2);
    expect([...marks].map((m) => m.textContent).join("")).toBe("だめ。です。");
  });

  it("handles two non-overlapping notes plus a period break between them", () => {
    const text = "AAA。BBBCCC";
    const notes: TextNoteRange[] = [
      { id: 1, startOffset: 0, endOffset: 3 },
      { id: 2, startOffset: 4, endOffset: 7 },
    ];
    const container = renderInto(text, notes, true);
    expect(container.textContent).toBe(text);
    expect(container.querySelector('mark[data-note-id="1"]')?.textContent).toBe("AAA");
    expect(container.querySelector('mark[data-note-id="2"]')?.textContent).toBe("BBB");
    expect(container.querySelectorAll("br")).toHaveLength(1);
  });

  it("round-trips an empty string to nothing, without throwing", () => {
    const container = renderInto("", [], true);
    expect(container.textContent).toBe("");
  });
});

describe("getSelectionOffsets", () => {
  function select(startNode: Node, startOffset: number, endNode: Node, endOffset: number) {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  it("returns null when nothing is selected", () => {
    const { container } = render(createElement("p", null, "hello world"));
    window.getSelection()?.removeAllRanges();
    expect(getSelectionOffsets(container)).toBeNull();
  });

  it("returns null for a collapsed (zero-length) selection", () => {
    const { container } = render(createElement("p", null, "hello world"));
    const textNode = container.querySelector("p")!.firstChild!;
    select(textNode, 2, textNode, 2);
    expect(getSelectionOffsets(container)).toBeNull();
  });

  it("returns the raw offsets of a plain-text selection", () => {
    const { container } = render(createElement("p", null, "hello world"));
    const textNode = container.querySelector("p")!.firstChild!;
    select(textNode, 0, textNode, 5); // "hello"
    expect(getSelectionOffsets(container)).toEqual({ start: 0, end: 5 });
  });

  it("normalizes a reversed (right-to-left dragged) selection", () => {
    // Range.setStart/setEnd can't represent "reversed" at all (feeding them
    // an out-of-order pair collapses the range instead of inverting it) --
    // a real right-to-left drag is only representable via anchor/focus,
    // independently orderable through setBaseAndExtent.
    const { container } = render(createElement("p", null, "hello world"));
    const textNode = container.querySelector("p")!.firstChild!;
    const sel = window.getSelection()!;
    sel.setBaseAndExtent(textNode, 5, textNode, 0);
    expect(getSelectionOffsets(container)).toEqual({ start: 0, end: 5 });
  });

  it("counts a selection spanning a <br> without counting the <br> itself as a character", () => {
    const text = "AAA。BBB";
    const notes: TextNoteRange[] = [];
    const container = renderInto(text, notes, true); // inserts one <br> after AAA。
    const p = container.querySelector("p")!;
    const firstText = p.childNodes[0]; // "AAA。"
    const secondText = p.childNodes[2]; // "BBB" (childNodes[1] is the <br>)
    select(firstText, 0, secondText, 2); // "AAA。BB" spanning the <br>
    expect(getSelectionOffsets(container)).toEqual({ start: 0, end: 6 });
  });

  it("counts a selection spanning into a <mark>-wrapped note correctly", () => {
    const text = "2GOMCPについて";
    const notes: TextNoteRange[] = [{ id: 1, startOffset: 0, endOffset: 6 }];
    const container = renderInto(text, notes, false);
    const p = container.querySelector("p")!;
    const markText = p.querySelector("mark")!.firstChild!; // "2GOMCP"
    const afterText = p.childNodes[p.childNodes.length - 1]; // "について"
    select(markText, 3, afterText, 2); // "MCPにつ"
    expect(getSelectionOffsets(container)).toEqual({ start: 3, end: 8 });
  });

  it("returns null for a selection outside the given container", () => {
    const { container } = render(createElement("p", null, "hello world"));
    const outside = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.appendChild(outside);
    select(outside.firstChild!, 0, outside.firstChild!, 3);
    expect(getSelectionOffsets(container)).toBeNull();
    outside.remove();
  });
});

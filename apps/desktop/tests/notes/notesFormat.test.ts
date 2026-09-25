import { describe, it, expect } from "vitest";
import { formatWithNotes } from "../../src/features/notes/notesFormat";
import type { TranscriptNote } from "../../src/lib/tauri";

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

describe("formatWithNotes", () => {
  it("returns the transcript unchanged when there are no notes", () => {
    expect(formatWithNotes("hello world", [], "Notes:")).toBe("hello world");
  });

  it("appends a footer quoting each note's snippet and correction", () => {
    const result = formatWithNotes("hello world", [makeNote()], "Notes:");
    expect(result).toBe("hello world\n\n---\nNotes:\n・「2GOMCP」→ 正しくはTogoMCP");
  });

  it("lists multiple notes in reading order (startOffset), not creation/array order", () => {
    const later = makeNote({ id: 1, startOffset: 20, quotedText: "second", note: "b" });
    const earlier = makeNote({ id: 2, startOffset: 0, quotedText: "first", note: "a" });
    const result = formatWithNotes("text", [later, earlier], "Notes:");
    const footerLines = result.split("\n").slice(-2);
    expect(footerLines).toEqual(["・「first」→ a", "・「second」→ b"]);
  });

  it("never mutates the transcript body itself", () => {
    const text = "the original transcript, unedited";
    const result = formatWithNotes(text, [makeNote()], "Notes:");
    expect(result.startsWith(text)).toBe(true);
  });
});

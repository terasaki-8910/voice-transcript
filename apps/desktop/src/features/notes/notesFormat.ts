// Copy-with-notes (SPEC.md > Transcript notes > Copy). Appends a footer
// listing every note after the transcript body -- the body itself is never
// touched, matching the same "notes are a side comment, not an edit" rule
// the rest of this feature follows. Quoting each note's own snippet instead
// of a numbered/bracketed marker keeps the plain "copy transcript" output
// completely undisturbed when there are no notes (the common case), and
// needs no inline marker in the body to stay unambiguous.
import type { TranscriptNote } from "../../lib/tauri";

export function formatWithNotes(text: string, notes: TranscriptNote[], heading: string): string {
  if (notes.length === 0) return text;
  const sorted = [...notes].sort((a, b) => a.startOffset - b.startOffset);
  const footer = sorted.map((n) => `・「${n.quotedText}」→ ${n.note}`).join("\n");
  return `${text}\n\n---\n${heading}\n${footer}`;
}

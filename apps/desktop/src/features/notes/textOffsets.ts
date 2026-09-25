// Transcript notes (annotations, SPEC.md > Transcript notes) anchor to a
// [startOffset, endOffset) character range of the RAW transcriptText that
// is actually stored in the DB -- never to anything textFormat.ts's
// breakAfterJapanesePeriod() has touched, since that function inserts real
// "\n" characters (SPEC.md's own note on this) and would silently shift
// every offset computed against its output. Both halves of that contract
// live here: turning a DOM selection back into raw-text offsets, and
// rendering raw text + notes as React nodes without ever mutating the
// string itself (period breaks become zero-width <br> elements instead of
// inserted characters, so a highlighted span's rendered textContent is
// always an exact substring of transcriptText).
import type { ReactNode } from "react";
import { createElement, Fragment } from "react";

export interface OffsetRange {
  start: number;
  end: number;
}

// Range.toString() concatenates exactly the Text node data a range
// contains/partially contains -- the same semantics as textContent, but
// robust to a start/end container that's an element (a child-index offset)
// rather than a text node (a character offset), which a manual
// TreeWalker+charIndex loop would have to special-case by hand.
function offsetWithin(container: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(container);
  range.setEnd(node, offset);
  return range.toString().length;
}

// Reads the current window selection and, if it both lies inside
// `container` and is non-empty, returns it as raw-text character offsets.
// null for every other case (nothing selected, a collapsed/zero-length
// selection, or a selection that belongs to some other part of the page) --
// callers treat null as "there is nothing to annotate right now", not an
// error.
export function getSelectionOffsets(container: HTMLElement): OffsetRange | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  // No start>end normalization needed: a Range object is always internally
  // ordered (start <= end in document order) regardless of which direction
  // the user dragged -- that's true of range.setStart/setEnd (which
  // collapse rather than invert when you feed them an out-of-order pair)
  // and equally true of a live Selection's own getRangeAt(0), even though
  // Selection separately exposes an anchor/focus pair that CAN run
  // backwards (a right-to-left drag).
  const start = offsetWithin(container, range.startContainer, range.startOffset);
  const end = offsetWithin(container, range.endContainer, range.endOffset);
  if (start === end) return null;
  return { start, end };
}

export interface TextNoteRange {
  id: number;
  startOffset: number;
  endOffset: number;
}

// Every index i (0-based) where the ORIGINAL breakAfterJapanesePeriod would
// have inserted a "\n" right after text[i] -- i.e. text[i] === "。", i is
// not the last character, and text[i + 1] isn't already "\n". Mirrors that
// function's regex (lib/textFormat.ts) exactly, just as a set of positions
// instead of a string mutation.
function periodBreakIndices(text: string): Set<number> {
  const breaks = new Set<number>();
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === "。" && text[i + 1] !== "\n") breaks.add(i);
  }
  return breaks;
}

// Partitions [0, text.length) into contiguous, non-overlapping runs -- each
// either plain or "inside note N" -- using every note boundary as a cut
// point. Assumes notes don't overlap (enforced at note-creation time, see
// AnnotatedTranscript's handleAddNote): with that guarantee, any run
// between two adjacent cut points is unambiguously inside at most one note.
function partitionByNotes(length: number, notes: TextNoteRange[]): Array<{ start: number; end: number; noteId?: number }> {
  const cuts = new Set<number>([0, length]);
  for (const n of notes) {
    cuts.add(Math.max(0, Math.min(length, n.startOffset)));
    cuts.add(Math.max(0, Math.min(length, n.endOffset)));
  }
  const sorted = [...cuts].sort((a, b) => a - b);

  const runs: Array<{ start: number; end: number; noteId?: number }> = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start === end) continue;
    const owner = notes.find((n) => n.startOffset <= start && n.endOffset >= end);
    runs.push({ start, end, noteId: owner?.id });
  }
  return runs;
}

export interface AnnotatedTextOptions {
  breakAtPeriod: boolean;
  // Rendered for a run inside note `noteId` -- kept generic (the caller
  // supplies the actual <mark>/onClick wiring) so this file stays free of
  // any component-specific event handling.
  renderNote: (run: { key: string; text: string; noteId: number }) => ReactNode;
}

// Renders `text` as React nodes with every note's range wrapped via
// `renderNote`, inserting a <br/> wherever breakAfterJapanesePeriod would
// have inserted "\n" -- <br/> contributes nothing to textContent, so this
// stays byte-for-byte reversible back to raw offsets via
// getSelectionOffsets, unlike the string-mutating original.
export function renderAnnotatedText(text: string, notes: TextNoteRange[], options: AnnotatedTextOptions): ReactNode[] {
  const breaks = options.breakAtPeriod ? periodBreakIndices(text) : new Set<number>();
  const runs = partitionByNotes(text.length, notes);

  const nodes: ReactNode[] = [];
  let key = 0;

  for (const run of runs) {
    // Split this run further at every break index it contains, so a <br/>
    // never ends up nested mid-run -- it always falls exactly between two
    // adjacent pieces, whether or not they belong to the same note.
    let pieceStart = run.start;
    for (let i = run.start; i < run.end; i++) {
      const isBreak = breaks.has(i);
      const isLastCharOfRun = i === run.end - 1;
      if (isBreak || isLastCharOfRun) {
        const pieceEnd = i + 1;
        const pieceText = text.slice(pieceStart, pieceEnd);
        if (pieceText.length > 0) {
          nodes.push(
            run.noteId !== undefined
              ? options.renderNote({ key: `n${key++}`, text: pieceText, noteId: run.noteId })
              : createElement(Fragment, { key: `t${key++}` }, pieceText),
          );
        }
        if (isBreak) nodes.push(createElement("br", { key: `b${key++}` }));
        pieceStart = pieceEnd;
      }
    }
  }

  return nodes;
}

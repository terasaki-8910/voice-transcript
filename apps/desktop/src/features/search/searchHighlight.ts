// Search (SPEC.md > Search). Pure text helpers shared by every result row:
// picking a short window of a long transcript body worth showing (rather
// than dumping the whole thing into a result list), and marking up which
// substrings inside it actually matched a search term. Both are
// case-insensitive, matching searchHistory's own `ilike` matching
// (packages/core/src/db/history.ts) so what's highlighted here is always
// consistent with why the row matched at all.
export interface HighlightSegment {
  text: string;
  matched: boolean;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Longest term first: if one search term is a substring of another
// ("Mac" inside "MacBook"), matching longest-first keeps the whole longer
// run highlighted as one span instead of splitting it around the shorter
// term buried inside it.
function termPattern(terms: string[]): RegExp | null {
  const cleaned = terms.map((t) => t.trim()).filter((t) => t.length > 0);
  if (cleaned.length === 0) return null;
  const sorted = [...cleaned].sort((a, b) => b.length - a.length);
  return new RegExp(`(${sorted.map(escapeRegExp).join("|")})`, "gi");
}

// Splits `text` into segments alternating matched/unmatched for any of
// `terms` -- consecutive segments so `segments.map(s => s.text).join("")`
// always reconstructs `text` exactly (same round-trip guarantee as
// features/notes/textOffsets.ts's renderAnnotatedText, for the same
// reason: a caller renders this straight into React nodes with no other
// source of truth for the text).
export function highlightTerms(text: string, terms: string[]): HighlightSegment[] {
  const pattern = termPattern(terms);
  if (!pattern) return [{ text, matched: false }];

  const segments: HighlightSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > lastIndex) segments.push({ text: text.slice(lastIndex, index), matched: false });
    segments.push({ text: match[0], matched: true });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), matched: false });
  return segments;
}

// A short window of `text` around the first place any term matches, with
// an ellipsis at whichever edges were actually cut. null when no term
// matches inside `text` at all -- the caller (SearchModal) falls back to
// showing why the row matched some OTHER way (title, or a note) instead.
export function extractSnippet(text: string, terms: string[], contextChars = 60): string | null {
  const pattern = termPattern(terms);
  if (!pattern) return null;
  const match = pattern.exec(text);
  if (!match) return null;

  const start = Math.max(0, match.index - contextChars);
  const end = Math.min(text.length, match.index + match[0].length + contextChars);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

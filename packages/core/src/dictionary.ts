import type { TranscriptResult } from "./types.js";

// Applied to every completed transcription, GUI and CLI alike (see
// sidecar.ts's handleTranscribe / cli.ts's main -- both call this right
// after runPipeline() and before render()/recordHistory(), so history,
// exports, and stdout all see the corrected text). Pure and DB-free by
// design: runPipeline() itself stays free of any DB dependency, and this
// function is trivially unit-testable without a database.
export interface DictionaryEntry {
  word: string;
  replacement: string;
}

const ASCII_WORD = /^[A-Za-z0-9 ._-]+$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A pure-ASCII word gets whole-word guards so e.g. "Spark" does not fire
// inside "Sparkling" -- the real Amical export has exactly this pair
// (`Spark` -> SPARQL, `sparkle` -> SPARQL, kept as distinct entries). A word
// containing any non-ASCII character (every Japanese entry) is matched as a
// plain substring: Japanese has no whitespace word boundaries, so `\b`-style
// guards are meaningless there.
function patternFor(word: string): string {
  const escaped = escapeRegExp(word);
  return ASCII_WORD.test(word) ? `(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])` : escaped;
}

// Builds one alternation regex from all entries, sorted longest-word-first,
// and replaces in a single global pass. Two reasons this matters, both
// verified against the real 57-entry Amical export rather than hypothetical:
// - A sequential replace()-per-entry loop would let already-substituted
//   output be re-scanned, risking a cascade (entry A's replacement text
//   accidentally matching entry B's word). A single pass is cascade-proof by
//   construction.
// - Longest-first resolves real substring-containment cases in the export
//   (e.g. "書紙"/"一時書紙", "ずー"/"ずーにー"): scanning left-to-right, the
//   longer alternative is tried first at the same start position, consumes
//   the match, and the scan position advances past it -- the shorter word
//   never gets an independent, wrong match inside what the longer one
//   already covered.
function buildMatcher(entries: DictionaryEntry[]): { regex: RegExp; map: Map<string, string> } | undefined {
  if (entries.length === 0) return undefined;

  const sorted = [...entries].sort((a, b) => b.word.length - a.word.length);
  const map = new Map<string, string>();
  for (const entry of sorted) {
    map.set(entry.word, entry.replacement);
  }

  const pattern = sorted.map((entry) => patternFor(entry.word)).join("|");
  return { regex: new RegExp(pattern, "g"), map };
}

function replaceText(text: string, matcher: { regex: RegExp; map: Map<string, string> }): string {
  return text.replace(matcher.regex, (match) => matcher.map.get(match) ?? match);
}

// Applies to result.text AND every segment's text, so srt/vtt/json output is
// corrected too, not just plain text. Case-sensitive, literal matching --
// the export itself proves Amical works this way ("Spark", "sparkle",
// "Ultra sync", "ultrasync" are stored as four separate entries, not
// normalized to one).
export function applyDictionary(result: TranscriptResult, entries: DictionaryEntry[]): TranscriptResult {
  const matcher = buildMatcher(entries);
  if (!matcher) return result;

  return {
    ...result,
    text: replaceText(result.text, matcher),
    segments: result.segments.map((segment) => ({
      ...segment,
      text: replaceText(segment.text, matcher),
    })),
  };
}

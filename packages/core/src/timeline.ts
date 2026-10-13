import type { TranscriptResult } from "./types.js";

export interface Interval {
  start: number; // seconds
  end: number; // seconds
}

export interface PlanOptions {
  minSilenceSec: number;
  padSec: number;
  sampleRate: number;
}

// Turns detected silences into the parts of the audio to keep. Silences
// shorter than minSilenceSec are ignored; each remaining one gives up padSec
// on both sides (so [a, b] removes [a + pad, b - pad]). Every boundary is
// rounded to a whole sample so the cut is exact and the time map cannot drift
// over many cuts. Returns [{ 0, durationSec }] when nothing is removed.
export function planKeptIntervals(
  silences: Interval[],
  durationSec: number,
  opts: PlanOptions,
): Interval[] {
  const snap = (t: number): number => Math.round(t * opts.sampleRate) / opts.sampleRate;
  const total = snap(durationSec);

  const removals: Interval[] = [];
  for (const silence of [...silences].sort((a, b) => a.start - b.start)) {
    if (silence.end - silence.start < opts.minSilenceSec) continue;
    const start = snap(Math.max(0, silence.start + opts.padSec));
    const end = snap(Math.min(total, silence.end - opts.padSec));
    if (end <= start) continue;
    const last = removals[removals.length - 1];
    if (last && start <= last.end) {
      last.end = Math.max(last.end, end);
    } else {
      removals.push({ start, end });
    }
  }

  if (removals.length === 0) return [{ start: 0, end: durationSec }];

  const kept: Interval[] = [];
  let cursor = 0;
  for (const removal of removals) {
    if (removal.start > cursor) kept.push({ start: cursor, end: removal.start });
    cursor = removal.end;
  }
  if (total > cursor) kept.push({ start: cursor, end: total });
  return kept;
}

export interface TimeMap {
  keptSeconds: number;
  // Maps a time on the compacted timeline back to the original timeline. A
  // time exactly on a junction goes to the start of the next kept part for
  // "start" and to the end of the previous kept part for "end".
  toOriginal(t: number, edge: "start" | "end"): number;
}

export function createTimeMap(kept: Interval[]): TimeMap {
  // offsets[i] = where kept[i] begins on the compacted timeline.
  const offsets: number[] = [];
  let keptSeconds = 0;
  for (const part of kept) {
    offsets.push(keptSeconds);
    keptSeconds += part.end - part.start;
  }
  const last = kept.length - 1;

  return {
    keptSeconds,
    toOriginal(t, edge) {
      if (kept.length === 0) return Math.max(0, t);
      if (t <= 0) return kept[0].start;
      if (t >= keptSeconds) return kept[last].end;
      // "start": last part beginning at or before t. "end": last part
      // beginning strictly before t (so a junction stays on the earlier part).
      let lo = 0;
      let hi = last;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        const begins = offsets[mid];
        if (edge === "start" ? begins <= t : begins < t) lo = mid;
        else hi = mid - 1;
      }
      const original = kept[lo].start + (t - offsets[lo]);
      return Math.min(original, kept[lo].end);
    },
  };
}

// Puts a transcript of the compacted audio back on the original timeline.
export function remapToOriginal(
  result: TranscriptResult,
  map: TimeMap,
  originalDuration: number,
): TranscriptResult {
  return {
    ...result,
    segments: result.segments.map((seg) => {
      const start = map.toOriginal(seg.start, "start");
      const end = Math.max(map.toOriginal(seg.end, "end"), start);
      return { start, end, text: seg.text };
    }),
    duration: originalDuration,
  };
}

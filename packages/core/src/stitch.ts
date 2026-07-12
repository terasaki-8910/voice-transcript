import type { Segment, TranscriptResult } from "./types.js";

// Each chunk's `offset` is the cumulative duration of preceding chunks.
// Adds the offset to each segment's start/end; concatenates text; result is
// monotonic non-decreasing.
export function stitchChunks(
  chunks: Array<{ offset: number; result: TranscriptResult }>,
): TranscriptResult {
  const segments: Segment[] = [];
  const texts: string[] = [];
  let language: string | undefined;
  let duration = 0;

  for (const { offset, result } of chunks) {
    for (const seg of result.segments) {
      segments.push({
        start: seg.start + offset,
        end: seg.end + offset,
        text: seg.text,
      });
    }
    texts.push(result.text);
    if (language === undefined) {
      language = result.language;
    }
    const chunkEnd = offset + (result.duration ?? Math.max(0, ...result.segments.map((s) => s.end)));
    duration = Math.max(duration, chunkEnd);
  }

  return {
    text: texts.join(" ").trim(),
    segments,
    language,
    duration,
  };
}

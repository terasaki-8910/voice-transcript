export interface ChunkPlanInput {
  durationSec: number;
  encodedBytes: number; // size of the normalized 16 kHz-mono encode
  maxBytes: number; // e.g. CHUNK_TARGET_BYTES
  silences: number[]; // detected silence times (seconds), ascending
}

// Interior split points (seconds), ascending, strictly in (0, durationSec).
// [] means a single upload. Boundaries prefer a member of `silences` --
// cuts are at detected silence, not a fixed offset, whenever one is
// available within budget. Fallback: if a stretch has no detected silence
// at all within maxChunkDuration (e.g. continuous speech/music with no
// >=0.5s quiet gap), a fixed-offset cut is forced there so the chunk still
// fits -- staying under maxBytes is chunking's actual purpose (Groq 413s
// otherwise), and a rare mid-word cut there is far better than a hard
// failure. This is the exception, not the default: every other boundary is
// still silence-aligned.
export function planChunks(input: ChunkPlanInput): number[] {
  const { durationSec, encodedBytes, maxBytes, silences } = input;

  if (encodedBytes <= maxBytes) {
    return [];
  }

  const bytesPerSec = encodedBytes / durationSec;
  const maxChunkDuration = maxBytes / bytesPerSec;

  const candidates = [...silences].filter((s) => s > 0 && s < durationSec).sort((a, b) => a - b);

  const boundaries: number[] = [];
  let chunkStart = 0;
  let i = 0;

  // Loop on remaining duration, not "any candidates left" -- a silence-free
  // tail longer than maxChunkDuration must still get cut, even after every
  // detected silence has already been consumed.
  while (durationSec - chunkStart > maxChunkDuration) {
    let cut = -1;
    while (i < candidates.length && candidates[i] - chunkStart <= maxChunkDuration) {
      cut = candidates[i];
      i++;
    }
    if (cut === -1) {
      cut = chunkStart + maxChunkDuration;
    }
    boundaries.push(cut);
    chunkStart = cut;
  }

  return boundaries;
}

export interface ChunkPlanInput {
  durationSec: number;
  encodedBytes: number; // size of the normalized 16 kHz-mono encode
  maxBytes: number; // e.g. CHUNK_TARGET_BYTES
  silences: number[]; // detected silence times (seconds), ascending
}

// Interior split points (seconds), ascending, strictly in (0, durationSec).
// [] means a single upload. Every returned boundary is a member of
// `silences` -- cuts are at detected silence, never fixed offsets.
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

  while (i < candidates.length) {
    let lastFit = -1;
    let j = i;
    while (j < candidates.length && candidates[j] - chunkStart <= maxChunkDuration) {
      lastFit = candidates[j];
      j++;
    }
    if (j >= candidates.length) {
      // Every remaining candidate fits in the current chunk, so the tail end
      // (up to durationSec) fits too -- nothing left to cut.
      break;
    }
    // candidates[j] no longer fits; cut at the last one that did, or force a
    // cut at candidates[j] itself if none has fit since chunkStart.
    const cut = lastFit >= 0 ? lastFit : candidates[j];
    boundaries.push(cut);
    chunkStart = cut;
    i = lastFit >= 0 ? j : j + 1;
  }

  return boundaries;
}

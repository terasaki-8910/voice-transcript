import { basename } from "node:path";
import type { AudioBackend, AudioChunk, NormalizedAudio } from "./audio.js";
import { planChunks } from "./chunk.js";
import { CHUNK_TARGET_BYTES, FREE_TIER_AUDIO_SECONDS_PER_HOUR, MAX_UPLOAD_BYTES } from "./config.js";
import { formatWait } from "./groq.js";
import { stitchChunks } from "./stitch.js";
import type { PipelineEvent, Transcriber, TranscriptResult } from "./types.js";

export interface PipelineDeps {
  audio: AudioBackend;
  transcriber: Transcriber;
  model: string;
  language?: string;
  maxBytes?: number; // default CHUNK_TARGET_BYTES
  onProgress?: (msg: string) => void;
  onEvent?: (event: PipelineEvent) => void;
  now?: () => number;
}

function clockTime(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 5);
}

async function transcribeChunk(
  chunk: AudioChunk,
  index: number,
  total: number,
  deps: PipelineDeps,
  signal: AbortSignal,
): Promise<{ offset: number; result: TranscriptResult }> {
  const label = `${String(index + 1)}/${String(total)}`;
  deps.onProgress?.(`transcribing chunk ${label} at offset ${String(chunk.offset)}s`);
  const audioBytes = await deps.audio.readBytes(chunk);
  const result = await deps.transcriber.transcribe({
    audio: audioBytes,
    filename: basename(chunk.path),
    model: deps.model,
    language: deps.language,
    signal,
    onRateLimitWait: (waitMs) => {
      const resumeAt = (deps.now ?? Date.now)() + waitMs;
      deps.onProgress?.(
        `Groq rate limit reached; waiting ${formatWait(waitMs)} (until about ${clockTime(resumeAt)}) before retrying chunk ${label}`,
      );
      deps.onEvent?.({
        type: "rate-limit-wait",
        chunk: index + 1,
        total,
        waitSeconds: Math.ceil(waitMs / 1000),
        resumeAt: new Date(resumeAt).toISOString(),
      });
    },
  });
  return { offset: chunk.offset, result };
}

const MAX_SPLIT_ATTEMPTS = 3;

// planChunks() budgets with an average bitrate, so a split can overshoot its
// target by a few percent; measure each chunk and re-plan with a smaller budget
// until every chunk actually fits under the upload cap.
async function splitWithinCap(
  normalized: NormalizedAudio,
  silences: number[],
  targetBytes: number,
  audio: AudioBackend,
): Promise<AudioChunk[]> {
  let budget = targetBytes;
  for (let attempt = 1; ; attempt++) {
    const boundaries = planChunks({
      durationSec: normalized.duration,
      encodedBytes: normalized.bytes,
      maxBytes: budget,
      silences,
    });
    const chunks = await audio.splitAt(normalized.path, boundaries);
    const largest = Math.max(...chunks.map((chunk) => chunk.bytes));
    if (largest <= MAX_UPLOAD_BYTES) return chunks;
    if (attempt >= MAX_SPLIT_ATTEMPTS) {
      throw new Error(
        `audio chunk is ${String(largest)} bytes, over the ${String(MAX_UPLOAD_BYTES)}-byte upload cap, after ${String(attempt)} split attempts`,
      );
    }
    // 0.95: shrink slightly past the proportional estimate so the retry lands under the cap.
    budget = Math.floor(budget * (MAX_UPLOAD_BYTES / largest) * 0.95);
  }
}

// assertAvailable -> normalize -> detectSilences -> planChunks -> splitAt ->
// transcribe each chunk (offset = cumulative duration) -> stitchChunks.
// Promise.all rejects on the first chunk failure, so a transient failure
// never silently drops that chunk's text (D2): the whole run fails loudly.
// That first failure also aborts every other chunk still in flight -- a
// sibling may be sleeping out an hour-long rate-limit wait, which would
// otherwise keep the process (and the GUI's sidecar) alive for nothing.
//
// Chunks still go out in parallel. Over Groq's hourly audio budget, the
// ones past it get a 429 with a retry-after and wait inside the client
// (see GroqClient), while the rest finish -- so a file longer than the
// budget completes on its own, about an hour after it started.
//
// Everything after assertAvailable() runs inside try/finally so
// deps.audio.cleanup() -- removing normalize()'s/splitAt()'s temp dirs --
// fires whether the run succeeds or fails partway (a failed run used to
// leak its temp dir just as much as a successful one). The inner
// try/catch around the cleanup call itself is required, not redundant
// with cleanup()'s own internal Promise.allSettled: a `finally` block
// that throws REPLACES whatever the `try` was about to return or throw,
// which would mask a real transcription failure behind an unrelated
// cleanup error -- or worse, turn a genuine success into a reported
// failure.
export async function runPipeline(
  inputFile: string,
  deps: PipelineDeps,
): Promise<TranscriptResult> {
  const maxBytes = deps.maxBytes ?? CHUNK_TARGET_BYTES;

  await deps.audio.assertAvailable();

  try {
    deps.onProgress?.("normalizing audio");
    const normalized = await deps.audio.normalize(inputFile);

    if (normalized.duration > FREE_TIER_AUDIO_SECONDS_PER_HOUR) {
      deps.onProgress?.(
        `audio is ${String(Math.round(normalized.duration / 60))} min, over Groq's free-tier budget of ` +
          `${String(FREE_TIER_AUDIO_SECONDS_PER_HOUR / 60)} min of audio per hour; the rest waits for that budget to free up`,
      );
      deps.onEvent?.({
        type: "over-hourly-budget",
        audioSeconds: Math.round(normalized.duration),
        budgetSeconds: FREE_TIER_AUDIO_SECONDS_PER_HOUR,
      });
    }

    deps.onProgress?.("detecting silence boundaries");
    const silences = await deps.audio.detectSilences(normalized.path);

    const chunks = await splitWithinCap(normalized, silences, maxBytes, deps.audio);
    const total = chunks.length;
    deps.onEvent?.({ type: "chunks-planned", total });

    const controller = new AbortController();
    let done = 0;
    const transcribed = await Promise.all(
      chunks.map((chunk, index) =>
        transcribeChunk(chunk, index, total, deps, controller.signal).then(
          (value) => {
            done++;
            deps.onEvent?.({ type: "chunk-done", done, total });
            return value;
          },
          (error: unknown) => {
            controller.abort(error);
            throw error;
          },
        ),
      ),
    );

    return stitchChunks(transcribed);
  } finally {
    try {
      await deps.audio.cleanup?.();
    } catch {
      // Best-effort: never replace the run's own outcome with a cleanup error.
    }
  }
}

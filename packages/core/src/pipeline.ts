import { basename } from "node:path";
import type { AudioBackend, AudioChunk, NormalizedAudio } from "./audio.js";
import { planChunks } from "./chunk.js";
import {
  CHUNK_TARGET_BYTES,
  FREE_TIER_AUDIO_SECONDS_PER_HOUR,
  MAX_UPLOAD_BYTES,
  NORMALIZED_SAMPLE_RATE,
  TRIM_SILENCE_MIN_SEC,
  TRIM_SILENCE_NOISE_DB,
  TRIM_SILENCE_PAD_SEC,
} from "./config.js";
import { formatWait } from "./groq.js";
import { stitchChunks } from "./stitch.js";
import { createTimeMap, planKeptIntervals, remapToOriginal } from "./timeline.js";
import type { TimeMap } from "./timeline.js";
import type { PipelineEvent, Transcriber, TranscriptResult } from "./types.js";

export interface PipelineDeps {
  audio: AudioBackend;
  transcriber: Transcriber;
  model: string;
  language?: string;
  trimSilence?: boolean; // default false; see trimSilenceStretches()
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

// Cuts stretches of complete silence out of the normalized audio. Returns the
// file to use from here on, plus the map back to the original timeline when
// something was actually cut (undefined = file untouched, nothing to remap).
async function trimSilenceStretches(
  normalized: NormalizedAudio,
  deps: PipelineDeps,
): Promise<{ audio: NormalizedAudio; map?: TimeMap }> {
  deps.onProgress?.("finding silent stretches");
  const { detectSilenceIntervals, keepIntervals } = deps.audio;
  if (!detectSilenceIntervals || !keepIntervals) {
    throw new Error("this audio backend does not support silence trimming");
  }
  const silences = await detectSilenceIntervals.call(
    deps.audio,
    normalized.path,
    TRIM_SILENCE_NOISE_DB,
    TRIM_SILENCE_MIN_SEC,
  );
  const kept = planKeptIntervals(silences, normalized.duration, {
    minSilenceSec: TRIM_SILENCE_MIN_SEC,
    padSec: TRIM_SILENCE_PAD_SEC,
    sampleRate: NORMALIZED_SAMPLE_RATE,
  });
  const map = createTimeMap(kept);
  const removedSec = normalized.duration - map.keptSeconds;
  if (kept.length === 1 && removedSec <= 0) {
    deps.onProgress?.("no silent stretches to trim");
    return { audio: normalized };
  }
  const trimmed = await keepIntervals.call(deps.audio, normalized.path, kept);
  deps.onProgress?.(
    `trimmed ${formatWait(removedSec * 1000)} of silence; sending ` +
      `${formatWait(trimmed.duration * 1000)} of ${formatWait(normalized.duration * 1000)}`,
  );
  return { audio: trimmed, map };
}

// assertAvailable -> normalize -> (optional trimSilenceStretches) ->
// detectSilences -> planChunks -> splitAt ->
// transcribe each chunk (offset = cumulative duration) -> stitchChunks
// -> (if trimmed) remapToOriginal, so timestamps stay on the source's timeline.
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
    const original = await deps.audio.normalize(inputFile);

    let normalized = original;
    let timeMap: TimeMap | undefined;
    if (deps.trimSilence) {
      ({ audio: normalized, map: timeMap } = await trimSilenceStretches(original, deps));
    }

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
            deps.onEvent?.({ type: "chunk-done", chunk: index + 1, done, total });
            return value;
          },
          (error: unknown) => {
            controller.abort(error);
            throw error;
          },
        ),
      ),
    );

    const stitched = stitchChunks(transcribed);
    return timeMap ? remapToOriginal(stitched, timeMap, original.duration) : stitched;
  } finally {
    try {
      await deps.audio.cleanup?.();
    } catch {
      // Best-effort: never replace the run's own outcome with a cleanup error.
    }
  }
}

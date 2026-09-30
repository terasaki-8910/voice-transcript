import { basename } from "node:path";
import type { AudioBackend, AudioChunk } from "./audio.js";
import { planChunks } from "./chunk.js";
import { CHUNK_TARGET_BYTES } from "./config.js";
import { stitchChunks } from "./stitch.js";
import type { Transcriber, TranscriptResult } from "./types.js";

export interface PipelineDeps {
  audio: AudioBackend;
  transcriber: Transcriber;
  model: string;
  language?: string;
  maxBytes?: number; // default CHUNK_TARGET_BYTES
  onProgress?: (msg: string) => void;
}

async function transcribeChunk(
  chunk: AudioChunk,
  deps: PipelineDeps,
): Promise<{ offset: number; result: TranscriptResult }> {
  deps.onProgress?.(`transcribing chunk at offset ${String(chunk.offset)}s`);
  const audioBytes = await deps.audio.readBytes(chunk);
  const result = await deps.transcriber.transcribe({
    audio: audioBytes,
    filename: basename(chunk.path),
    model: deps.model,
    language: deps.language,
  });
  return { offset: chunk.offset, result };
}

// assertAvailable -> normalize -> detectSilences -> planChunks -> splitAt ->
// transcribe each chunk (offset = cumulative duration) -> stitchChunks.
// Promise.all rejects on the first chunk failure, so a transient failure
// never silently drops that chunk's text (D2): the whole run fails loudly.
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

    deps.onProgress?.("detecting silence boundaries");
    const silences = await deps.audio.detectSilences(normalized.path);

    const boundaries = planChunks({
      durationSec: normalized.duration,
      encodedBytes: normalized.bytes,
      maxBytes,
      silences,
    });

    const chunks = await deps.audio.splitAt(normalized.path, boundaries);

    const transcribed = await Promise.all(chunks.map((chunk) => transcribeChunk(chunk, deps)));

    return stitchChunks(transcribed);
  } finally {
    try {
      await deps.audio.cleanup?.();
    } catch {
      // Best-effort: never replace the run's own outcome with a cleanup error.
    }
  }
}

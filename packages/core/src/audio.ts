import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NORMALIZED_SAMPLE_RATE } from "./config.js";
import type { Interval } from "./timeline.js";

export interface AudioChunk {
  path: string;
  offset: number;
  duration: number;
  bytes: number;
}

export interface NormalizedAudio {
  path: string;
  bytes: number;
  duration: number;
}

export interface AudioBackend {
  assertAvailable(): Promise<void>;
  probeDuration(file: string): Promise<number>;
  normalize(file: string): Promise<NormalizedAudio>;
  detectSilences(file: string): Promise<number[]>;
  splitAt(file: string, boundaries: number[]): Promise<AudioChunk[]>;
  readBytes(chunk: AudioChunk): Promise<Uint8Array>;
  // Removes every temp dir this backend instance has created so far
  // (normalize()'s and splitAt()'s own mkdtemp()s -- previously never
  // cleaned up, leaking a directory per transcription into the OS temp
  // dir permanently). Optional so every existing AudioBackend mock in
  // tests keeps compiling unchanged. Safe to call with nothing created
  // (no-op) and safe to call more than once; never rejects.
  cleanup?(): Promise<void>;
  // Silence trimming (opt-in). Optional for the same reason as cleanup?:
  // existing test mocks keep compiling. detectSilenceIntervals returns the
  // silent stretches (seconds) quieter than noiseDb and at least minSec long;
  // keepIntervals writes a new 16 kHz mono FLAC (in a tracked temp dir) that
  // holds only the given parts of `file`, back to back.
  detectSilenceIntervals?(file: string, noiseDb: number, minSec: number): Promise<Interval[]>;
  keepIntervals?(file: string, kept: Interval[]): Promise<NormalizedAudio>;
}

export class FfmpegNotFoundError extends Error {}

const SILENCE_NOISE_DB = "-30dB";
const SILENCE_MIN_DURATION_SEC = 0.5;

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new FfmpegNotFoundError(`${cmd} was not found on PATH; install ffmpeg`));
      } else {
        reject(err);
      }
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${cmd} exited with code ${String(code)}: ${stderr.slice(-2000)}`));
      }
    });
  });
}

function newTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "voice-transcript-"));
}

// A "make a temp dir" function that also records the dir for later cleanup
// -- returning the dir string itself is what lets normalize()/splitAt()
// stay simple call sites (`const dir = await makeTmpDir();`) while
// createFfmpegBackend() (below) is the only place that actually tracks
// anything. Recording happens the INSTANT the dir is created, before
// ffmpeg ever runs -- not after the caller succeeds -- so a dir from a
// normalize()/splitAt() call that fails partway is still cleaned up; that
// is exactly the case a "track on success" version would miss.
type MakeTmpDir = () => Promise<string>;

// ffmpeg reports silence boundaries as "silence_start: <seconds>" lines on
// stderr, in encounter order (i.e. already ascending).
function parseSilenceStarts(stderr: string): number[] {
  const times: number[] = [];
  const re = /silence_start:\s*(-?\d+(?:\.\d+)?)/g;
  for (const match of stderr.matchAll(re)) {
    times.push(Math.max(0, parseFloat(match[1])));
  }
  return times;
}

// silencedetect prints "silence_start: <s>" and later "silence_end: <s> |
// silence_duration: <s>" lines on stderr, in order. A silence_start with no
// matching end means the file ends silent; it closes at durationSec.
export function parseSilenceIntervals(stderr: string, durationSec: number): Interval[] {
  const intervals: Interval[] = [];
  let open: number | undefined;
  const re = /silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g;
  for (const match of stderr.matchAll(re)) {
    const t = Math.max(0, parseFloat(match[2]));
    if (match[1] === "start") {
      open = t;
    } else if (open !== undefined) {
      intervals.push({ start: open, end: Math.max(open, t) });
      open = undefined;
    }
  }
  if (open !== undefined) intervals.push({ start: open, end: Math.max(open, durationSec) });
  return intervals;
}

// Passes through only the given byte ranges ([start, end), ascending and
// non-overlapping) of the stream, whatever the chunk sizes it arrives in.
export function createRangeFilter(byteRanges: Array<{ start: number; end: number }>): Transform {
  let position = 0; // absolute offset of the next incoming byte
  let index = 0; // first range that is not yet fully behind us
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const chunkStart = position;
      const chunkEnd = position + chunk.length;
      position = chunkEnd;
      while (index < byteRanges.length && byteRanges[index].start < chunkEnd) {
        const range = byteRanges[index];
        const from = Math.max(range.start, chunkStart);
        const to = Math.min(range.end, chunkEnd);
        if (to > from) this.push(chunk.subarray(from - chunkStart, to - chunkStart));
        if (range.end > chunkEnd) break; // continues in the next chunk
        index++;
      }
      callback();
    },
  });
}

async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const duration = parseFloat(stdout.trim());
  if (!Number.isFinite(duration)) {
    throw new Error(`ffprobe could not determine duration for ${file}`);
  }
  return duration;
}

// FLAC (lossless) keeps full transcription fidelity while actually shrinking
// payload size relative to the source, unlike raw PCM WAV which would inflate
// an already-compressed input and defeat the point of normalizing for size.
async function normalize(file: string, makeTmpDir: MakeTmpDir): Promise<NormalizedAudio> {
  const dir = await makeTmpDir();
  const outPath = join(dir, "normalized.flac");
  await run("ffmpeg", ["-y", "-i", file, "-ac", "1", "-ar", String(NORMALIZED_SAMPLE_RATE), "-vn", "-c:a", "flac", outPath]);
  const [{ size }, duration] = await Promise.all([stat(outPath), probeDuration(outPath)]);
  return { path: outPath, bytes: size, duration };
}

async function detectSilences(file: string): Promise<number[]> {
  const { stderr } = await run("ffmpeg", [
    "-i", file,
    "-af", `silencedetect=noise=${SILENCE_NOISE_DB}:d=${SILENCE_MIN_DURATION_SEC}`,
    "-f", "null",
    "-",
  ]);
  return parseSilenceStarts(stderr);
}

async function detectSilenceIntervals(file: string, noiseDb: number, minSec: number): Promise<Interval[]> {
  const { stderr } = await run("ffmpeg", [
    "-i", file,
    "-af", `silencedetect=noise=${String(noiseDb)}dB:d=${String(minSec)}`,
    "-f", "null",
    "-",
  ]);
  // Only needed when the file ends silent, but cheap enough to always ask.
  return parseSilenceIntervals(stderr, await probeDuration(file));
}

function spawnError(cmd: string, err: NodeJS.ErrnoException): Error {
  return err.code === "ENOENT" ? new FfmpegNotFoundError(`${cmd} was not found on PATH; install ffmpeg`) : err;
}

// Decodes `file` to raw 16-bit mono PCM, forwards only the kept samples to a
// second ffmpeg that encodes them as FLAC. Done by byte range in Node (not an
// aselect/atrim filter) because aselect works on whole audio frames, so cuts
// would drift, and a filter expression with thousands of cuts can exceed
// Windows' 32,767-character command line limit.
async function keepIntervals(file: string, kept: Interval[], makeTmpDir: MakeTmpDir): Promise<NormalizedAudio> {
  const dir = await makeTmpDir();
  const outPath = join(dir, "trimmed.flac");
  const byteRanges = kept.map((part) => ({
    start: Math.round(part.start * NORMALIZED_SAMPLE_RATE) * 2,
    end: Math.round(part.end * NORMALIZED_SAMPLE_RATE) * 2,
  }));

  const decoder = spawn("ffmpeg", [
    "-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(NORMALIZED_SAMPLE_RATE), "-f", "s16le", "-",
  ]);
  const encoder = spawn("ffmpeg", [
    "-y", "-v", "error", "-f", "s16le", "-ar", String(NORMALIZED_SAMPLE_RATE), "-ac", "1", "-i", "-",
    "-c:a", "flac", outPath,
  ]);

  const exited = (name: string, child: typeof decoder): Promise<void> =>
    new Promise((resolve, reject) => {
      let tail = "";
      child.stderr.on("data", (chunk: Buffer) => {
        tail = (tail + chunk.toString()).slice(-2000);
      });
      child.on("error", (err: NodeJS.ErrnoException) => reject(spawnError("ffmpeg", err)));
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg (${name}) exited with code ${String(code)}: ${tail}`)),
      );
    });
  const decoderExit = exited("decode", decoder);
  const encoderExit = exited("encode", encoder);
  // Settled up front so a rejection while we are still awaiting the pipe is never "unhandled".
  const exits = Promise.allSettled([decoderExit, encoderExit]);

  try {
    // Ignore EPIPE-style stdin errors here; the encoder's exit code carries the real cause.
    encoder.stdin.on("error", () => {});
    await Promise.all([
      // A broken pipe here is a symptom; the failing process's exit code and stderr are the cause.
      pipeline(decoder.stdout, createRangeFilter(byteRanges), encoder.stdin).catch(() => {}),
      decoderExit,
      encoderExit,
    ]);
  } catch (err) {
    decoder.kill();
    encoder.kill();
    await exits;
    throw err;
  }

  const [{ size }, duration] = await Promise.all([stat(outPath), probeDuration(outPath)]);
  return { path: outPath, bytes: size, duration };
}

async function splitAt(file: string, boundaries: number[], makeTmpDir: MakeTmpDir): Promise<AudioChunk[]> {
  const duration = await probeDuration(file);
  const cuts = [0, ...boundaries, duration];
  const dir = await makeTmpDir();
  const chunks: AudioChunk[] = [];
  for (let i = 1; i < cuts.length; i++) {
    const start = cuts[i - 1];
    const chunkDuration = cuts[i] - start;
    const outPath = join(dir, `chunk-${i - 1}.flac`);
    await run("ffmpeg", [
      "-y",
      "-ss", start.toFixed(3),
      "-i", file,
      "-t", chunkDuration.toFixed(3),
      "-ac", "1",
      "-ar", "16000",
      "-c:a", "flac",
      outPath,
    ]);
    const { size } = await stat(outPath);
    chunks.push({ path: outPath, offset: start, duration: chunkDuration, bytes: size });
  }
  return chunks;
}

async function assertAvailable(): Promise<void> {
  try {
    await run("ffmpeg", ["-version"]);
    await run("ffprobe", ["-version"]);
  } catch (err) {
    if (err instanceof FfmpegNotFoundError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new FfmpegNotFoundError(`ffmpeg was not found on PATH; install ffmpeg (${message})`);
  }
}

export function createFfmpegBackend(): AudioBackend {
  // One array per backend instance (one instance per transcription run --
  // see pipeline.ts's single createFfmpegBackend() call per runPipeline()).
  const tmpDirs: string[] = [];
  const trackedTmpDir: MakeTmpDir = async () => {
    const dir = await newTmpDir();
    tmpDirs.push(dir);
    return dir;
  };

  return {
    assertAvailable,
    probeDuration,
    detectSilences,
    detectSilenceIntervals,
    keepIntervals: (file: string, kept: Interval[]) => keepIntervals(file, kept, trackedTmpDir),
    normalize: (file: string) => normalize(file, trackedTmpDir),
    splitAt: (file: string, boundaries: number[]) => splitAt(file, boundaries, trackedTmpDir),
    async readBytes(chunk: AudioChunk): Promise<Uint8Array> {
      return readFile(chunk.path);
    },
    async cleanup(): Promise<void> {
      const dirs = tmpDirs.splice(0);
      await Promise.allSettled(dirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 3 })));
    },
  };
}

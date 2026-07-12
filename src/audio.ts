import { spawn } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
async function normalize(file: string): Promise<NormalizedAudio> {
  const dir = await newTmpDir();
  const outPath = join(dir, "normalized.flac");
  await run("ffmpeg", ["-y", "-i", file, "-ac", "1", "-ar", "16000", "-vn", "-c:a", "flac", outPath]);
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

async function splitAt(file: string, boundaries: number[]): Promise<AudioChunk[]> {
  const duration = await probeDuration(file);
  const cuts = [0, ...boundaries, duration];
  const dir = await newTmpDir();
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
  return {
    assertAvailable,
    probeDuration,
    normalize,
    detectSilences,
    splitAt,
    async readBytes(chunk: AudioChunk): Promise<Uint8Array> {
      return readFile(chunk.path);
    },
  };
}

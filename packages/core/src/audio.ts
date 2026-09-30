import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
  // Removes every temp dir this backend instance has created so far
  // (normalize()'s and splitAt()'s own mkdtemp()s -- previously never
  // cleaned up, leaking a directory per transcription into the OS temp
  // dir permanently). Optional so every existing AudioBackend mock in
  // tests keeps compiling unchanged. Safe to call with nothing created
  // (no-op) and safe to call more than once; never rejects.
  cleanup?(): Promise<void>;
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

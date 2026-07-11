# Module contract (pinned by the Stage 1 tests)

The acceptance tests import the public API below. The build stage (Stage 4)
implements `src/**` to satisfy it. Changing a signature means changing the
tests too, so keep this in sync with `tests/**`.

Ports-and-adapters shape: `ffmpeg` and the HTTP API are behind injectable
interfaces so units run without a real binary or network. `main` wires the real
adapters by default.

## `src/types.ts`
```ts
export type OutputFormat = "txt" | "srt" | "vtt" | "json";
export interface Segment { start: number; end: number; text: string; }        // seconds
export interface TranscriptResult {
  text: string;
  segments: Segment[];
  language?: string;
  duration?: number;
}
export interface TranscribeParams {
  audio: Uint8Array;
  filename: string;
  model: string;
  language?: string;
}
export interface Transcriber {
  transcribe(params: TranscribeParams): Promise<TranscriptResult>;
}
```

## `src/config.ts`
```ts
export const DEFAULT_MODEL = "whisper-large-v3-turbo";
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;   // hard Groq cap (per request)
export const CHUNK_TARGET_BYTES = 24 * 1024 * 1024; // stay under the cap
export const MAX_RETRIES = 4;
// Groq speech-to-text endpoint + valid format list also live here.
```

## `src/args.ts`
```ts
export interface CliOptions {
  input: string;
  output?: string;
  format: OutputFormat;   // default "txt"
  model: string;          // default DEFAULT_MODEL
  language?: string;      // default: auto-detect
}
export class UsageError extends Error {}
export function parseArgs(argv: string[]): CliOptions; // throws UsageError on bad/absent args
```

## `src/formats.ts`
```ts
export function render(result: TranscriptResult, format: OutputFormat): string;
// srt: 1-based integer indices, "HH:MM:SS,mmm --> HH:MM:SS,mmm"
// vtt: starts "WEBVTT", "HH:MM:SS.mmm --> HH:MM:SS.mmm"
// json: { text, segments:[{start,end,text}], language?, duration? }
// txt: plain text, no timestamps, no emoji
```

## `src/chunk.ts` (pure)
```ts
export interface ChunkPlanInput {
  durationSec: number;
  encodedBytes: number;   // size of the normalized 16 kHz-mono encode
  maxBytes: number;       // e.g. CHUNK_TARGET_BYTES
  silences: number[];     // detected silence times (seconds), ascending
}
// Interior split points (seconds), ascending, strictly in (0, durationSec).
// [] means a single upload. Every returned boundary MUST be a member of
// `silences` -- cuts are at detected silence, never fixed offsets.
export function planChunks(input: ChunkPlanInput): number[];
```

## `src/stitch.ts` (pure)
```ts
// Each chunk's `offset` is the cumulative duration of preceding chunks.
// Adds the offset to each segment's start/end; concatenates text; result is
// monotonic non-decreasing.
export function stitchChunks(
  chunks: Array<{ offset: number; result: TranscriptResult }>,
): TranscriptResult;
```

## `src/audio.ts` (ffmpeg adapter)
```ts
export interface AudioChunk { path: string; offset: number; duration: number; bytes: number; }
export interface NormalizedAudio { path: string; bytes: number; duration: number; }
export interface AudioBackend {
  assertAvailable(): Promise<void>;                 // rejects FfmpegNotFoundError if ffmpeg not on PATH
  probeDuration(file: string): Promise<number>;
  normalize(file: string): Promise<NormalizedAudio>; // -> 16 kHz mono
  detectSilences(file: string): Promise<number[]>;
  splitAt(file: string, boundaries: number[]): Promise<AudioChunk[]>; // [] -> one whole-file chunk
  readBytes(chunk: AudioChunk): Promise<Uint8Array>;
}
export class FfmpegNotFoundError extends Error {}
export function createFfmpegBackend(): AudioBackend;
```

## `src/groq.ts` (HTTP adapter, implements Transcriber)
```ts
export class GroqApiError extends Error { status?: number; }
export class GroqClient implements Transcriber {
  constructor(opts: {
    apiKey: string;                 // ONLY source: process.env.GROQ_API_KEY (read by caller)
    fetchImpl?: typeof fetch;       // injectable for tests
    maxRetries?: number;            // default MAX_RETRIES
    sleep?: (ms: number) => Promise<void>;
  });
  transcribe(params: TranscribeParams): Promise<TranscriptResult>;
}
// Retries 429 and 5xx with growing backoff up to maxRetries, then throws
// GroqApiError (message includes the status). 4xx other than 429 is not retried.
```

## `src/pipeline.ts`
```ts
export interface PipelineDeps {
  audio: AudioBackend;
  transcriber: Transcriber;
  model: string;
  language?: string;
  maxBytes?: number;               // default CHUNK_TARGET_BYTES
  onProgress?: (msg: string) => void;
}
// assertAvailable -> normalize -> detectSilences -> planChunks -> splitAt ->
// transcribe each chunk (offset = cumulative duration) -> stitchChunks.
// If any chunk transcription rejects, the whole run rejects (no silent drop).
export function runPipeline(inputFile: string, deps: PipelineDeps): Promise<TranscriptResult>;
```

## `src/cli.ts`
```ts
export interface CliDeps {
  env?: Record<string, string | undefined>;         // default process.env
  stdout?: (s: string) => void;                      // default process.stdout
  stderr?: (s: string) => void;                      // default process.stderr (logs + errors only)
  audio?: AudioBackend;                              // default createFfmpegBackend()
  makeTranscriber?: (apiKey: string) => Transcriber; // default new GroqClient(...)
  writeFile?: (path: string, data: string) => Promise<void>;
  fileExists?: (path: string) => Promise<boolean>;
}
// Order: parseArgs -> fileExists(input) -> GROQ_API_KEY present ->
//        audio.assertAvailable -> runPipeline -> render -> stdout | writeFile.
// Resolves to the process exit code (0 success, non-zero on any error).
export function main(argv: string[], deps?: CliDeps): Promise<number>;
```

## `src/index.ts`
Thin bin entry: `process.exit(await main(process.argv.slice(2)))`.

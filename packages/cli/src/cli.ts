import { access, writeFile as fsWriteFile } from "node:fs/promises";
import type { AudioBackend, Transcriber, HistoryRecordInput } from "@voice-transcript/core";
import {
  createFfmpegBackend,
  render,
  GroqClient,
  runPipeline,
  createDb,
  recordHistorySafe,
  defaultMigrationsFolder,
} from "@voice-transcript/core";
import { parseArgs, UsageError } from "./args.js";

export interface CliDeps {
  env?: Record<string, string | undefined>;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  audio?: AudioBackend;
  makeTranscriber?: (apiKey: string) => Transcriber;
  writeFile?: (path: string, data: string) => Promise<void>;
  fileExists?: (path: string) => Promise<boolean>;
  // ACCEPTANCE H1/H5: records one history entry per completed run (success
  // or failure). Must never throw -- the default wires createDb() +
  // recordHistorySafe() (packages/core/src/db), which already guarantees
  // that: no DATABASE_URL or an unreachable DB never blocks or corrupts the
  // transcription result, it only logs and returns.
  recordHistory?: (input: HistoryRecordInput) => Promise<void>;
}

async function defaultFileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ACCEPTANCE H5, enforced here (not just trusted from the injected
// recordHistory): a history-recording failure must never surface as a
// thrown error out of main() -- it can only ever affect the exit code via
// the transcription's OWN success/failure, never via history bookkeeping.
async function safeRecordHistory(
  recordHistory: (input: HistoryRecordInput) => Promise<void>,
  input: HistoryRecordInput,
  stderr: (s: string) => void,
): Promise<void> {
  try {
    await recordHistory(input);
  } catch (err) {
    stderr(`[history] failed to record history (non-blocking): ${errorMessage(err)}\n`);
  }
}

// Order: parseArgs -> fileExists(input) -> GROQ_API_KEY present ->
//        audio.assertAvailable -> runPipeline -> render -> stdout | writeFile.
// This ordering is what makes A2 (no API/ffmpeg call on missing file) and A3
// (no ffmpeg/API call on missing key) pass.
export async function main(argv: string[], deps: CliDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s));
  const audio = deps.audio ?? createFfmpegBackend();
  const makeTranscriber = deps.makeTranscriber ?? ((apiKey: string) => new GroqClient({ apiKey }));
  const writeFile = deps.writeFile ?? ((path: string, data: string) => fsWriteFile(path, data));
  const fileExists = deps.fileExists ?? defaultFileExists;
  const recordHistory =
    deps.recordHistory ??
    ((input: HistoryRecordInput) => recordHistorySafe(createDb(), input, defaultMigrationsFolder()));

  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      stderr(`${err.message}\n`);
      return 1;
    }
    throw err;
  }

  if (!(await fileExists(options.input))) {
    stderr(`Input file not found: ${options.input}\n`);
    return 1;
  }

  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) {
    stderr("GROQ_API_KEY environment variable is not set.\n");
    return 1;
  }

  try {
    await audio.assertAvailable();
  } catch (err) {
    stderr(`${errorMessage(err)}\n`);
    return 1;
  }

  try {
    const transcriber = makeTranscriber(apiKey);
    const result = await runPipeline(options.input, {
      audio,
      transcriber,
      model: options.model,
      language: options.language,
      onProgress: (msg) => stderr(`${msg}\n`),
    });
    const rendered = render(result, options.format);
    if (options.output) {
      await writeFile(options.output, rendered);
    } else {
      stdout(rendered);
    }
    await safeRecordHistory(
      recordHistory,
      {
        sourceFileName: options.input,
        model: options.model,
        language: options.language,
        formats: [options.format],
        status: "success",
        result,
      },
      stderr,
    );
    return 0;
  } catch (err) {
    await safeRecordHistory(
      recordHistory,
      {
        sourceFileName: options.input,
        model: options.model,
        language: options.language,
        formats: [options.format],
        status: "failed",
      },
      stderr,
    );
    stderr(`${errorMessage(err)}\n`);
    return 1;
  }
}

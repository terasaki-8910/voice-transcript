import { access, writeFile as fsWriteFile } from "node:fs/promises";
import type { AudioBackend } from "./audio.js";
import { createFfmpegBackend } from "./audio.js";
import { parseArgs, UsageError } from "./args.js";
import { render } from "./formats.js";
import { GroqClient } from "./groq.js";
import { runPipeline } from "./pipeline.js";
import type { Transcriber } from "./types.js";

export interface CliDeps {
  env?: Record<string, string | undefined>;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  audio?: AudioBackend;
  makeTranscriber?: (apiKey: string) => Transcriber;
  writeFile?: (path: string, data: string) => Promise<void>;
  fileExists?: (path: string) => Promise<boolean>;
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
    return 0;
  } catch (err) {
    stderr(`${errorMessage(err)}\n`);
    return 1;
  }
}

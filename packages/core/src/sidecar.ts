#!/usr/bin/env node
// Node sidecar entry point, spawned by the Rust shell
// (apps/desktop/src-tauri/src/commands.rs) via tauri-plugin-shell. Runs
// this package's pipeline + history layer on the desktop app's behalf --
// the webview never gets fs/network/DB access directly (SPEC.md >
// Architecture; .claude/agents/tauri-capability-reviewer.md).
//
// Protocol: argv[2] = command name, argv[3] = JSON-encoded args. Writes
// exactly ONE JSON line to stdout: { ok: true, data } on success,
// { ok: false, error } on a domain failure. Never lets an error escape
// main() uncaught -- a non-JSON stdout line or a nonzero exit is a
// transport-level failure (the process itself broke), not a domain error;
// keeping those distinct gives the Rust side a single, reliable parse path.
import { createFfmpegBackend } from "./audio.js";
import type { AudioBackend } from "./audio.js";
import { GroqClient } from "./groq.js";
import type { Transcriber } from "./types.js";
import { runPipeline } from "./pipeline.js";
import { render } from "./formats.js";
import { createDb } from "./db/client.js";
import { recordHistorySafe } from "./db/history.js";
import type { HistoryRecordInput } from "./db/history.js";
import type { OutputFormat } from "./types.js";

export interface TranscribeArgs {
  filePath: string;
  model: string;
  language?: string;
  format: OutputFormat;
}

export interface TranscribeResponse {
  text: string;
  rendered: string;
  language?: string;
  duration?: number;
}

// Same injection shape as packages/cli/src/cli.ts's CliDeps -- lets tests
// exercise handleTranscribe without real ffmpeg, network, or a DB.
export interface SidecarDeps {
  env?: Record<string, string | undefined>;
  audio?: AudioBackend;
  makeTranscriber?: (apiKey: string) => Transcriber;
  recordHistory?: (input: HistoryRecordInput) => Promise<void>;
}

export async function handlePing(): Promise<string> {
  return "pong";
}

export async function handleTranscribe(
  args: TranscribeArgs,
  deps: SidecarDeps = {},
): Promise<TranscribeResponse> {
  const env = deps.env ?? process.env;
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY environment variable is not set.");
  }

  const audio = deps.audio ?? createFfmpegBackend();
  const makeTranscriber = deps.makeTranscriber ?? ((key: string) => new GroqClient({ apiKey: key }));
  const recordHistory = deps.recordHistory ?? ((input: HistoryRecordInput) => recordHistorySafe(createDb(), input));

  await audio.assertAvailable();

  const historyBase = {
    sourceFileName: args.filePath,
    model: args.model,
    language: args.language,
    formats: [args.format],
  };

  try {
    const transcriber = makeTranscriber(apiKey);
    const result = await runPipeline(args.filePath, {
      audio,
      transcriber,
      model: args.model,
      language: args.language,
      onProgress: (msg) => process.stderr.write(`${msg}\n`),
    });
    const rendered = render(result, args.format);
    await recordHistory({ ...historyBase, status: "success", result });
    return { text: result.text, rendered, language: result.language, duration: result.duration };
  } catch (err) {
    await recordHistory({ ...historyBase, status: "failed" });
    throw err;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const command = argv[2];
  const argJson = argv[3];

  try {
    let data: unknown;
    switch (command) {
      case "ping":
        data = await handlePing();
        break;
      case "transcribe": {
        const args = JSON.parse(argJson ?? "{}") as TranscribeArgs;
        data = await handleTranscribe(args);
        break;
      }
      default:
        throw new Error(`Unknown sidecar command "${String(command)}"`);
    }
    process.stdout.write(`${JSON.stringify({ ok: true, data })}\n`);
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage(err) })}\n`);
  }
}


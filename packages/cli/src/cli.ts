import { access, writeFile as fsWriteFile } from "node:fs/promises";
import type { AudioBackend, Transcriber, HistoryRecordInput, DictionaryEntry } from "@voice-transcript/core";
import {
  createFfmpegBackend,
  render,
  GroqClient,
  runPipeline,
  createDb,
  recordHistoryOrDefer,
  pendingHistoryDir,
  defaultMigrationsFolder,
  ensureSchema,
  listDictionary,
  applyDictionary,
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
  // recordHistoryOrDefer() (packages/core/src/db), which already guarantees
  // that: no DATABASE_URL or an unreachable DB never blocks or corrupts the
  // transcription result, it only logs and returns.
  // `pending` is true when the database was unreachable and the record was
  // parked in the durable outbox (packages/core/src/db/pending.ts) instead.
  recordHistory?: (
    input: HistoryRecordInput,
    opts: { dictionaryApplied: boolean },
  ) => Promise<{ id?: number; pending: boolean }>;
  // Where the outbox lives; only used for the "saved to" message.
  pendingDir?: string;
  // Custom dictionary (word replacement), applied to every run same as the
  // GUI (packages/core/src/sidecar.ts's handleTranscribe) so CLI/GUI parity
  // (ACCEPTANCE G4) holds. Must never throw -- the default logs and returns
  // [] on any failure, same non-blocking rule as history.
  // `loaded: false` means the dictionary could not be read (DB down), which
  // is different from an empty dictionary: a deferred history record is then
  // flagged so the dictionary is applied when it is flushed.
  fetchDictionary?: () => Promise<{ entries: DictionaryEntry[]; loaded: boolean }>;
}

async function defaultFetchDictionary(
  stderr: (s: string) => void,
): Promise<{ entries: DictionaryEntry[]; loaded: boolean }> {
  try {
    const db = createDb();
    if (!db) return { entries: [], loaded: true };
    await ensureSchema(db, defaultMigrationsFolder());
    return { entries: await listDictionary(db), loaded: true };
  } catch (err) {
    stderr(`[dictionary] failed to load dictionary (non-blocking): ${errorMessage(err)}\n`);
    return { entries: [], loaded: false };
  }
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
  recordHistory: NonNullable<CliDeps["recordHistory"]>,
  input: HistoryRecordInput,
  dictionaryApplied: boolean,
  pendingDir: string,
  stderr: (s: string) => void,
): Promise<void> {
  try {
    const { pending } = await recordHistory(input, { dictionaryApplied });
    if (pending) {
      stderr(
        `[history] database unreachable; saved to ${pendingDir} and it will be added to history the next time the CLI or the app reaches the database\n`,
      );
    }
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
  const pendingDir = deps.pendingDir ?? pendingHistoryDir(env);
  const recordHistory =
    deps.recordHistory ??
    ((input: HistoryRecordInput, opts: { dictionaryApplied: boolean }) =>
      recordHistoryOrDefer(createDb(), input, {
        migrationsFolder: defaultMigrationsFolder(),
        pendingDir,
        dictionaryApplied: opts.dictionaryApplied,
      }));
  const fetchDictionary = deps.fetchDictionary ?? (() => defaultFetchDictionary(stderr));

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

  const startedAt = new Date();
  try {
    const transcriber = makeTranscriber(apiKey);
    const rawResult = await runPipeline(options.input, {
      audio,
      transcriber,
      model: options.model,
      language: options.language,
      trimSilence: options.trimSilence,
      onProgress: (msg) => stderr(`${msg}\n`),
    });
    // Custom dictionary (word replacement) -- same hook point as the GUI's
    // sidecar.ts: after runPipeline, before render()/history, so stdout/the
    // written file and the recorded history text are both corrected.
    const dictionary = await fetchDictionary();
    const result = applyDictionary(rawResult, dictionary.entries);
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
        startedAt,
      },
      dictionary.loaded,
      pendingDir,
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
        startedAt,
      },
      true,
      pendingDir,
      stderr,
    );
    stderr(`${errorMessage(err)}\n`);
    return 1;
  }
}

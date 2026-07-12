import type { OutputFormat } from "./types.js";
import { DEFAULT_MODEL, OUTPUT_FORMATS } from "./config.js";

export interface CliOptions {
  input: string;
  output?: string;
  format: OutputFormat; // default "txt"
  model: string; // default DEFAULT_MODEL
  language?: string; // default: auto-detect
}

export class UsageError extends Error {}

const USAGE =
  "Usage: transcribe <audio-file> [-o, --output <file>] [--format txt|srt|vtt|json] [--model <name>] [--language <code>]";

function isOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value);
}

export function parseArgs(argv: string[]): CliOptions {
  let input: string | undefined;
  let output: string | undefined;
  let format: OutputFormat = "txt";
  let model: string = DEFAULT_MODEL;
  let language: string | undefined;

  const valueFor = (flag: string, i: number): string => {
    const value = argv[i + 1];
    if (value === undefined) {
      throw new UsageError(`${flag} requires a value.\n${USAGE}`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-o":
      case "--output":
        output = valueFor(arg, i);
        i++;
        break;
      case "--format": {
        const value = valueFor(arg, i);
        i++;
        if (!isOutputFormat(value)) {
          throw new UsageError(
            `Invalid --format "${value}"; expected one of: ${OUTPUT_FORMATS.join(", ")}.`,
          );
        }
        format = value;
        break;
      }
      case "--model":
        model = valueFor(arg, i);
        i++;
        break;
      case "--language":
        language = valueFor(arg, i);
        i++;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new UsageError(`Unknown option "${arg}".\n${USAGE}`);
        }
        if (input !== undefined) {
          throw new UsageError(`Unexpected extra argument "${arg}".\n${USAGE}`);
        }
        input = arg;
    }
  }

  if (input === undefined) {
    throw new UsageError(USAGE);
  }

  return { input, output, format, model, language };
}

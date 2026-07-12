import { GROQ_TRANSCRIPTION_ENDPOINT, MAX_RETRIES } from "./config.js";
import type { Segment, TranscribeParams, Transcriber, TranscriptResult } from "./types.js";

const BASE_BACKOFF_MS = 500;

export class GroqApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GroqApiError";
    this.status = status;
  }
}

interface GroqClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface GroqVerboseJsonResponse {
  text: string;
  language?: string;
  duration?: number;
  segments?: Segment[];
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function buildFormData(params: TranscribeParams): FormData {
  const form = new FormData();
  form.append("file", new Blob([params.audio]), params.filename);
  form.append("model", params.model);
  form.append("response_format", "verbose_json");
  if (params.language) {
    form.append("language", params.language);
  }
  return form;
}

function parseTranscriptResult(body: GroqVerboseJsonResponse): TranscriptResult {
  return {
    text: body.text,
    segments: (body.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text })),
    language: body.language,
    duration: body.duration,
  };
}

export class GroqClient implements Transcriber {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: GroqClientOptions) {
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? MAX_RETRIES;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async transcribe(params: TranscribeParams): Promise<TranscriptResult> {
    const totalAttempts = this.maxRetries + 1;

    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      if (attempt > 0) {
        await this.sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      }

      const response = await this.fetchImpl(GROQ_TRANSCRIPTION_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: buildFormData(params),
      });

      if (response.ok) {
        return parseTranscriptResult((await response.json()) as GroqVerboseJsonResponse);
      }

      const detail = await response.text();
      const error = new GroqApiError(
        `Groq API request failed with status ${response.status}: ${detail}`,
        response.status,
      );

      const isLastAttempt = attempt === totalAttempts - 1;
      if (!isRetryableStatus(response.status) || isLastAttempt) {
        throw error;
      }
    }

    // Unreachable: the loop above always returns or throws.
    throw new GroqApiError("Groq API request failed: exhausted retries");
  }
}

import {
  GROQ_TRANSCRIPTION_ENDPOINT,
  MAX_RATE_LIMIT_WAIT_MS,
  MAX_RATE_LIMIT_WAITS,
  MAX_RETRIES,
} from "./config.js";
import type { Segment, TranscribeParams, Transcriber, TranscriptResult } from "./types.js";

const BASE_BACKOFF_MS = 500;
// Added on top of Groq's own retry-after, so the retry lands after the
// rolling window has actually freed up rather than a hair before it.
const RATE_LIMIT_MARGIN_MS = 2_000;

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
  maxRateLimitWaits?: number;
  maxRateLimitWaitMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
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

// How long a 429 asks the caller to wait, in ms, or null when it doesn't
// say. Groq sets a `retry-after` header in seconds on every 429; the body's
// own "Please try again in 16m30.5s" is the fallback for a response that
// lost the header on the way (a proxy, say).
export function parseRetryAfterMs(headers: Headers, body: string, now: number = Date.now()): number | null {
  const header = headers.get("retry-after")?.trim();
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    // The other form RFC 9110 allows: an HTTP date.
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, at - now);
  }
  const match = /try again in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i.exec(body);
  if (match && (match[1] || match[2] || match[3])) {
    const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
    return Math.ceil(seconds * 1000);
  }
  return null;
}

// "45s", "16m32s", "1h05m" -- for English progress and error text.
export function formatWait(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${String(h)}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${String(m)}m${String(s).padStart(2, "0")}s`;
  return `${String(s)}s`;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
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
  private readonly maxRateLimitWaits: number;
  private readonly maxRateLimitWaitMs: number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly now: () => number;

  constructor(opts: GroqClientOptions) {
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? MAX_RETRIES;
    this.maxRateLimitWaits = opts.maxRateLimitWaits ?? MAX_RATE_LIMIT_WAITS;
    this.maxRateLimitWaitMs = opts.maxRateLimitWaitMs ?? MAX_RATE_LIMIT_WAIT_MS;
    this.sleep = opts.sleep ?? abortableSleep;
    this.now = opts.now ?? Date.now;
  }

  // Two separate retry budgets:
  // - a 429 that says how long to wait (Groq's free tier: audio-seconds per
  //   hour) is slept out exactly, up to maxRateLimitWaits times -- a few
  //   seconds of exponential backoff can never outlast a window that frees
  //   up in 16 minutes, which is how a 2.5-hour file used to fail outright.
  // - a 429 without a wait, or a 5xx, gets the short exponential backoff,
  //   up to maxRetries times (ACCEPTANCE D1).
  async transcribe(params: TranscribeParams): Promise<TranscriptResult> {
    const { signal } = params;
    let transientRetries = 0;
    let rateLimitWaits = 0;

    for (;;) {
      signal?.throwIfAborted();
      const response = await this.fetchImpl(GROQ_TRANSCRIPTION_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: buildFormData(params),
        signal,
      });

      if (response.ok) {
        return parseTranscriptResult((await response.json()) as GroqVerboseJsonResponse);
      }

      const detail = await response.text();
      const message = `Groq API request failed with status ${String(response.status)}: ${detail}`;

      const waitMs = response.status === 429 ? parseRetryAfterMs(response.headers, detail, this.now()) : null;
      if (waitMs !== null) {
        if (waitMs > this.maxRateLimitWaitMs) {
          throw new GroqApiError(
            `${message} (Groq asks to wait ${formatWait(waitMs)}, longer than the ${formatWait(this.maxRateLimitWaitMs)} ` +
              "this app waits on its own -- usually the free tier's daily audio limit. Try again later.)",
            response.status,
          );
        }
        if (rateLimitWaits >= this.maxRateLimitWaits) {
          throw new GroqApiError(message, response.status);
        }
        rateLimitWaits++;
        const sleepMs = waitMs + RATE_LIMIT_MARGIN_MS;
        params.onRateLimitWait?.(sleepMs);
        await this.sleep(sleepMs, signal);
        continue;
      }

      if (!isRetryableStatus(response.status) || transientRetries >= this.maxRetries) {
        throw new GroqApiError(message, response.status);
      }
      transientRetries++;
      await this.sleep(BASE_BACKOFF_MS * 2 ** (transientRetries - 1), signal);
    }
  }
}

// ACCEPTANCE D1: the API client retries 429/5xx with backoff up to a bounded
// attempt count, then fails with a clear error. Pins `GroqClient` in src/groq.ts.
import { describe, it, expect, vi } from "vitest";
import { GroqClient, GroqApiError, parseRetryAfterMs, formatWait } from "../src/groq.js";
import type { TranscribeParams } from "../src/types.js";

const params: TranscribeParams = {
  audio: new Uint8Array([0, 1, 2, 3]),
  filename: "chunk-000.wav",
  model: "whisper-large-v3-turbo",
};

// Groq verbose_json response shape (subset the client depends on).
const okBody = JSON.stringify({
  task: "transcribe",
  language: "en",
  duration: 3.0,
  text: "hello there",
  segments: [{ start: 0, end: 3, text: "hello there" }],
});

function jsonResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("D1 - bounded retry with backoff", () => {
  it("retries 429 up to maxRetries, then throws a clear error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(429, "rate limited"));
    const sleeps: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleeps.push(ms);
    });

    const client = new GroqClient({
      apiKey: "gsk_dummy",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 3,
      sleep,
    });

    await expect(client.transcribe(params)).rejects.toBeInstanceOf(GroqApiError);

    // Bounded: 1 initial attempt + 3 retries = 4 calls, and no more.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    // Backoff: one sleep before each retry, delays non-decreasing.
    expect(sleeps).toHaveLength(3);
    for (let i = 1; i < sleeps.length; i++) {
      expect(sleeps[i]).toBeGreaterThanOrEqual(sleeps[i - 1]);
    }
    // The delays actually grow (not a flat retry).
    expect(sleeps[sleeps.length - 1]).toBeGreaterThan(sleeps[0]);
  });

  it("retries 5xx and then succeeds, returning the parsed transcript", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, "unavailable"))
      .mockResolvedValueOnce(jsonResponse(200, okBody));
    const sleep = vi.fn(async () => {});

    const client = new GroqClient({
      apiKey: "gsk_dummy",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 3,
      sleep,
    });

    const result = await client.transcribe(params);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(result.text).toContain("hello there");
    expect(result.segments[0]).toMatchObject({ start: 0, end: 3 });
  });

  it("includes the failing status in the error message", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(429, "rate limited"));
    const client = new GroqClient({
      apiKey: "gsk_dummy",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 1,
      sleep: async () => {},
    });
    await expect(client.transcribe(params)).rejects.toThrow(/429/);
  });

  it("does not retry a non-retryable 4xx (e.g. 401) and fails immediately", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, "invalid api key"));
    const sleep = vi.fn(async () => {});
    const client = new GroqClient({
      apiKey: "gsk_dummy",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 3,
      sleep,
    });

    await expect(client.transcribe(params)).rejects.toBeInstanceOf(GroqApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

function rateLimited(body: string, retryAfter?: string): Response {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (retryAfter !== undefined) headers["retry-after"] = retryAfter;
  return new Response(body, { status: 429, headers });
}

// Groq's real free-tier body (seconds of audio per hour), as reported
// 2026-10-12 for a 2.5-hour file.
const ASPH_BODY = JSON.stringify({
  error: {
    message:
      "Rate limit reached for model `whisper-large-v3-turbo` in organization `org_x` service tier `on_demand` on seconds of audio per hour (ASPH): Limit 7200, Used 7103, Requested 2078. Please try again in 16m30.5s.",
    type: "seconds",
    code: "rate_limit_exceeded",
  },
});

describe("rate-limit waits honour Groq's retry-after", () => {
  it("sleeps out the retry-after (plus a margin) and then succeeds, reporting the wait", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(rateLimited(ASPH_BODY, "990"))
      .mockResolvedValueOnce(jsonResponse(200, okBody));
    const sleeps: number[] = [];
    const waits: number[] = [];
    const client = new GroqClient({
      apiKey: "gsk_dummy",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      // A rate-limit wait must not spend the transient-retry budget.
      maxRetries: 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const result = await client.transcribe({ ...params, onRateLimitWait: (ms) => waits.push(ms) });

    expect(result.text).toContain("hello there");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(990_000);
    expect(sleeps[0]).toBeLessThan(1_000_000);
    expect(waits).toEqual(sleeps);
  });

  it("falls back to the body's 'try again in 16m30.5s' when the header is missing", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(rateLimited(ASPH_BODY))
      .mockResolvedValueOnce(jsonResponse(200, okBody));
    const sleeps: number[] = [];
    const client = new GroqClient({
      apiKey: "gsk_dummy",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await client.transcribe(params);
    expect(sleeps[0]).toBeGreaterThanOrEqual(990_500);
  });

  it("fails at once, saying why, when the wait is longer than it will sit through", async () => {
    const fetchImpl = vi.fn(async () => rateLimited("daily limit", String(5 * 3600)));
    const sleep = vi.fn(async () => {});
    const client = new GroqClient({
      apiKey: "gsk_dummy",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
    });

    await expect(client.transcribe(params)).rejects.toThrow(/429.*5h00m.*daily audio limit/s);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after maxRateLimitWaits waits", async () => {
    const fetchImpl = vi.fn(async () => rateLimited(ASPH_BODY, "60"));
    const sleep = vi.fn(async () => {});
    const client = new GroqClient({
      apiKey: "gsk_dummy",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRateLimitWaits: 2,
      sleep,
    });

    await expect(client.transcribe(params)).rejects.toBeInstanceOf(GroqApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("stops waiting as soon as the signal aborts", async () => {
    const fetchImpl = vi.fn(async () => rateLimited(ASPH_BODY, "990"));
    const controller = new AbortController();
    const client = new GroqClient({ apiKey: "gsk_dummy", fetchImpl: fetchImpl as unknown as typeof fetch });

    const run = client.transcribe({
      ...params,
      signal: controller.signal,
      // Abort mid-sleep, not before it starts.
      onRateLimitWait: () => setTimeout(() => controller.abort(new Error("sibling chunk failed")), 20),
    });

    // The real (timer-based) sleep: without the abort this would hang ~16 minutes.
    await expect(run).rejects.toThrow("sibling chunk failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("parseRetryAfterMs", () => {
  const none = new Headers();
  it("reads the retry-after header in seconds, decimals included", () => {
    expect(parseRetryAfterMs(new Headers({ "retry-after": "2" }), "")).toBe(2000);
    expect(parseRetryAfterMs(new Headers({ "retry-after": "1.5" }), "")).toBe(1500);
  });
  it("reads an HTTP-date retry-after relative to now", () => {
    const now = Date.parse("2026-10-12T00:00:00Z");
    expect(parseRetryAfterMs(new Headers({ "retry-after": "Mon, 12 Oct 2026 00:01:00 GMT" }), "", now)).toBe(60_000);
  });
  it("reads Groq's body text when there is no header", () => {
    expect(parseRetryAfterMs(none, "Please try again in 16m30.5s.")).toBe(990_500);
    expect(parseRetryAfterMs(none, "Please try again in 45s")).toBe(45_000);
    expect(parseRetryAfterMs(none, "Please try again in 1h2m3s")).toBe(3_723_000);
  });
  it("returns null when the response doesn't say", () => {
    expect(parseRetryAfterMs(none, "rate limited")).toBeNull();
  });
});

describe("formatWait", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatWait(45_000)).toBe("45s");
    expect(formatWait(992_500)).toBe("16m33s");
    expect(formatWait(65 * 60_000)).toBe("1h05m");
  });
});

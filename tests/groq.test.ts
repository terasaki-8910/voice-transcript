// ACCEPTANCE D1: the API client retries 429/5xx with backoff up to a bounded
// attempt count, then fails with a clear error. Pins `GroqClient` in src/groq.ts.
import { describe, it, expect, vi } from "vitest";
import { GroqClient, GroqApiError } from "../src/groq.js";
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

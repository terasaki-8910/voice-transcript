// ACCEPTANCE E1-E3: end-to-end against the real Groq API and the real
// ~78-min test file. This suite SELF-SKIPS unless GROQ_API_KEY is set, so the
// default `npm test` run stays offline and fast. It must pass before
// integration acceptance.
//
// The whole file is transcribed ONCE (it is slow and costs API budget); E1/E2/E3
// then assert against that single run. A transcriber wrapper records each upload
// payload size so E2 can prove no chunk exceeds the 25 MB cap.
import { describe, it, expect, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../packages/cli/src/cli.js";
import { GroqClient, createFfmpegBackend, MAX_UPLOAD_BYTES } from "../../packages/core/src/index.js";
import type { TranscriptResult } from "../../packages/core/src/index.js";

const AUDIO = fileURLToPath(new URL("../test.m4a", import.meta.url));
const TIMEOUT_MS = 30 * 60 * 1000; // transcribing ~78 min of audio is slow.

const run = describe.skipIf(!process.env.GROQ_API_KEY);

run("E - end-to-end (real Groq API)", () => {
  let exitCode = -1;
  let transcript: TranscriptResult;
  let payloadSizes: number[] = [];
  let sourceDuration = 0;
  const outFile = join(tmpdir(), `vt-e2e-${Date.now()}.json`);

  beforeAll(async () => {
    payloadSizes = [];
    sourceDuration = await createFfmpegBackend().probeDuration(AUDIO);

    exitCode = await main(["--format", "json", "-o", outFile, AUDIO], {
      env: process.env,
      // Wrap the real client to record each uploaded payload size (for E2).
      makeTranscriber: (apiKey: string) => {
        const real = new GroqClient({ apiKey });
        return {
          transcribe: async (params) => {
            payloadSizes.push(params.audio.byteLength);
            return real.transcribe(params);
          },
        };
      },
    });

    transcript = JSON.parse(readFileSync(outFile, "utf8")) as TranscriptResult;
  }, TIMEOUT_MS);

  it("E1 - exits 0 and produces a non-empty transcript", () => {
    expect(exitCode).toBe(0);
    expect(transcript.segments.length).toBeGreaterThan(0);
    expect(transcript.text.trim().length).toBeGreaterThan(0);
  });

  it("E2 - no single uploaded chunk exceeds 25 MB", () => {
    expect(payloadSizes.length).toBeGreaterThanOrEqual(1);
    for (const bytes of payloadSizes) {
      expect(bytes).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
    }
  });

  it("E3 - transcribes the full file without truncation (>=95% coverage)", () => {
    const lastEnd = transcript.segments[transcript.segments.length - 1].end;
    expect(sourceDuration).toBeGreaterThan(3600); // sanity: it really is >1h
    expect(lastEnd).toBeGreaterThanOrEqual(0.95 * sourceDuration);
  });
});

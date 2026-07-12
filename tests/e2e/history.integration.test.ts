// ACCEPTANCE H1, H2, H5 -- cross-cutting transcription-history behaviour
// (packages/core's DB layer + both the CLI and desktop callers). Per
// prompts/04-build.md, "cross-cutting / e2e tests belong to integration
// acceptance, not to any one feature": this file is NOT a per-feature build
// gate, and, unlike tests/e2e/integration.test.ts, it does NOT
// describe.skipIf(...) -- it must fail deterministically and offline.
//
// H1/H2/H5 depend on an interface that doesn't exist yet (the history
// writer/reader). Each item below is a deliberate, zero-guessing
// expect.unreachable(...) placeholder rather than a guessed-at real
// assertion -- genuinely red, to be replaced once the core-db feature
// exists. H1 and H5 in particular will likely become real
// injected-dependency unit tests (mirroring the AudioBackend/Transcriber
// dependency-injection pattern already used in tests/cli.test.ts and
// tests/pipeline.test.ts) once that interface is designed, and may then
// move out of tests/e2e/ into packages/core/tests/.
import { describe, it, expect } from "vitest";

describe("H1 - every completed run persists one history record", () => {
  it("records file name, started-at, model, language, format(s), status, and text/segments", () => {
    expect.unreachable(
      "H1 not implemented: assert that a completed CLI or GUI run writes " +
        "exactly one history record containing the source file name, " +
        "started-at timestamp, model, language, requested format(s), status, " +
        "and the resulting transcript text (+ segments if the format included them).",
    );
  });
});

describe("H2 - history view reads stored transcripts without re-calling Groq", () => {
  it("opening a past run displays its stored text with zero transcriber invocations", () => {
    expect.unreachable(
      "H2 not implemented: assert that opening a stored run in the GUI's " +
        "history view returns its persisted transcript text while making " +
        "zero calls to the Groq transcriber.",
    );
  });
});

describe("H5 - transcription is never blocked by a DB failure", () => {
  it("still completes and returns output when DATABASE_URL is unset or unreachable", () => {
    expect.unreachable(
      "H5 not implemented: assert that a transcription request (CLI or GUI) " +
        "still completes and returns/writes its output when DATABASE_URL is " +
        "unset or the DB is unreachable -- only the history write fails, and " +
        "it fails loudly (logged), never silently and never blocking the " +
        "transcription itself.",
    );
  });
});

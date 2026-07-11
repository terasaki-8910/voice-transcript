# ACCEPTANCE — Voice Transcript

Every criterion is **pass/fail** and checkable by an automated test (`vitest`),
a typecheck (`tsc`), or lint (`eslint`). Integration criteria (section E) hit the
real Groq API and run only when `GROQ_API_KEY` is set; they must pass before
integration acceptance.

## A. CLI contract (unit)
- **A1** — `transcribe` with no arguments exits non-zero and prints usage to stderr.
- **A2** — `transcribe <missing-file>` exits non-zero with an error naming the file, and makes no API call.
- **A3** — With `GROQ_API_KEY` unset, running against a valid file exits non-zero with an error mentioning the missing key; no ffmpeg or API call is made.
- **A4** — `--format` accepts exactly `txt|srt|vtt|json`; any other value exits non-zero with an error.
- **A5** — Default output goes to stdout; `-o <file>` writes to that file (stdout carries no transcript, only logs go to stderr).

## B. Audio handling (unit, mocked ffmpeg/API)
- **B1** — When the 16 kHz-mono encode is ≤ 24 MB, the pipeline makes exactly **one** transcription request (no chunking).
- **B2** — When the encode exceeds 24 MB, the pipeline splits into **N > 1** chunks and makes N requests; boundaries are chosen at **detected silence**, not fixed offsets.
- **B3** — When stitching M chunks, each chunk's timestamps are offset by the cumulative duration of preceding chunks; merged timestamps are monotonic non-decreasing.
- **B4** — If ffmpeg is not on `PATH`, the CLI exits non-zero with an actionable error naming ffmpeg.

## C. Output format correctness (unit)
- **C1** — `--format srt` output parses as valid SRT (sequential integer indices; `HH:MM:SS,mmm --> HH:MM:SS,mmm` timing lines).
- **C2** — `--format vtt` output begins with `WEBVTT` and uses `HH:MM:SS.mmm` timings.
- **C3** — `--format json` output is valid JSON whose segments each contain `start`, `end`, and `text`.
- **C4** — `--format txt` output contains no timestamps and no emoji.

## D. Resilience (unit, mocked API)
- **D1** — On HTTP 429 / 5xx, the client retries with backoff up to a bounded attempt count, then fails with a clear error.
- **D2** — A transient failure on one chunk never silently drops that chunk's text: it is either retried to success or the whole run fails loudly.

## E. End-to-end (integration; real Groq API + `tests/test.m4a`)
- **E1** — `transcribe tests/test.m4a` exits `0` and produces a non-empty transcript.
- **E2** — No single uploaded chunk exceeds 25 MB (asserts each request payload size).
- **E3** — The full ~78-min file is transcribed without truncation: the merged transcript's final segment end time is ≥ 95% of the source duration (~4,674 s).

## F. Project hygiene (lint / typecheck / test)
- **F1** — `npm run lint` passes: ESLint clean **and** no emoji anywhere in `src/**` or CLI output strings.
- **F2** — `npm test` (vitest) passes with all non-integration tests green.
- **F3** — `npm run typecheck` (`tsc --noEmit`) reports no errors.
- **F4** — No hardcoded API key in the repo; the key is read only from `process.env.GROQ_API_KEY` (grep/test-enforced).

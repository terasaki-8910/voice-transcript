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
- **F1** — `pnpm -r lint` passes across every workspace package: ESLint clean
  **and** no emoji anywhere in source, CLI output, or GUI copy.
- **F2** — `pnpm -r test` (vitest) passes with all non-integration tests green,
  across `packages/core`, `packages/cli`, and `apps/desktop`.
- **F3** — `pnpm -r typecheck` (`tsc --noEmit`) reports no errors in any package.
- **F4** — No hardcoded API key in the repo; the key is read only from `process.env.GROQ_API_KEY` (grep/test-enforced, `packages/core` + `apps/desktop/src-tauri`).

## G. Desktop GUI (Tauri, Windows/Linux/macOS)
- **G1** — The desktop app builds and produces a runnable bundle on all three
  targets in CI (`windows-latest`, `ubuntu-latest`, `macos-latest`).
- **G2** — Static scan of the webview source tree (`apps/desktop/src/**`,
  excluding `src-tauri/`) finds no `GROQ_API_KEY`, no `DATABASE_URL`/DB
  credential literal, and no direct network call to `api.groq.com` —
  mirrors F4's grep-enforced pattern, extended to the GUI's trust boundary.
- **G3** — Every permission declared in `apps/desktop/src-tauri/capabilities/*.json`
  is exercised by at least one registered `#[tauri::command]` in the same
  changeset (no unused/broader-than-needed grants) — checked by
  `tauri-capability-reviewer` at feature acceptance, not a standalone unit test.
- **G4** — Transcribing the same file with the same options via the GUI and via
  the CLI produces byte-identical transcript text (both call the same
  `packages/core`, so this is a parity check against logic duplication).
- **G5** — Queuing N files where one fails (e.g. an unsupported format) still
  transcribes the other N−1 to completion; the failed item is reported, not
  silently dropped and not fatal to the queue (extends D2 to the GUI queue).
- **G6** — GUI copy renders in both Japanese and English; switching the
  language setting updates all visible UI text immediately, without an app
  restart. (Confirmed at the design gate, 2026-07-12; not a vitest-checkable
  item on its own — verified by exercising the setting in the built app,
  same as G1/G3.)
- **G7** — Sending a history item's source audio file to the OS trash moves
  it to the OS trash/recycle bin (recoverable there, per OS convention; never
  a permanent unrecoverable delete) and does NOT remove the history record —
  the stored transcript remains readable afterward (H2). (Confirmed 2026-07-12.)
- **G8** — The app's native OS menu (macOS global menu bar / Windows app
  menu, via Tauri's Menu API) exposes at minimum: Add files, Open history,
  Export (the current transcript, in an existing format — txt/srt/vtt/json),
  and View on GitHub. These are reachable from the native menu, not only
  from in-webview controls. (Confirmed 2026-07-12.)
- **G9** — Deleting a history entry removes its history record (it no
  longer appears in the history list, and an H2-style lookup for it returns
  nothing); if the source audio file still exists on disk, it is also moved
  to the OS trash (same recoverable guarantee as G7, never a permanent
  delete). (Confirmed 2026-07-12.)

## H. Transcription history (Postgres)
- **H1** — Every completed run (CLI or GUI) writes one history record:
  source file name, started-at timestamp, model, language, requested
  format(s), status, and the resulting transcript text (+ segments if the
  format included them).
- **H2** — The GUI's history view lists past runs and, on opening one, displays
  the stored transcript text without making a new Groq API call.
- **H3** — `DATABASE_URL` is read only from the environment; no DB host,
  credential, or connection string is hardcoded in the repo (grep/test-enforced,
  same pattern as F4).
- **H4** — The data-access layer contains no raw vendor-specific SQL strings
  outside migration files — all queries go through the chosen ORM/query-builder
  (grep/test-enforced: no `sql\`...\`` / raw query calls in
  `packages/core/src/db/**` except the migrations directory). Keeps a future
  Postgres → MySQL move a config change, not a rewrite.
- **H5** — If `DATABASE_URL` is unset or the DB is unreachable, a transcription
  request (CLI or GUI) still completes and returns/writes its output; only the
  history write fails, and it fails loudly (logged), never silently and never
  blocking the transcription itself.

## I. Release automation (GitHub Actions)
- **I1** — `.github/workflows/release.yml` exists, triggers only on
  `workflow_dispatch` (never on push/tag automatically), and declares at
  least `title` and `version`/`tag` string inputs — no other inputs.
- **I2** — The workflow's build matrix covers `windows-latest`,
  `ubuntu-latest`, and `macos-latest`, building only `apps/desktop` (not
  `packages/cli`) — mirrors G1's CI build matrix.
- **I3** — Each platform's native installer bundle (macOS `.dmg`, Windows
  `.exe`, Linux `.AppImage`/`.deb`) is uploaded as an asset to a GitHub
  Release identified by the given version/tag input, titled with the given
  title input.
- Like G1, I1–I3 are **not vitest-checkable** (workflow YAML correctness and
  actual multi-platform build success can only be verified by running it) —
  verified by actually running the workflow once as a manual smoke test, at
  or after integration acceptance, not by a unit test.

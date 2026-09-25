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
- **B2** — When the encode exceeds 24 MB, the pipeline splits into **N > 1** chunks and makes N requests. Every chunk stays under the byte budget -- boundaries prefer **detected silence** whenever one falls within budget, falling back to a fixed offset only across a silence-free stretch that alone would otherwise exceed it (2026-07-20: a real 413 from Groq was traced to this gap -- a chunk with no fallback could exceed the cap when its stretch had no detected silence at all).
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
- **F4** — No hardcoded API key in the repo; the key is read only from `process.env.GROQ_API_KEY` (grep/test-enforced, `packages/cli` -- where the CLI entry point reads it from `process.env` -- and `apps/desktop/src-tauri`; corrected 2026-07-12 during the `cli-package` build, since the env-read lives in the CLI entry point, not `packages/core`).

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
  View on GitHub, and Preferences.... These are reachable from the native
  menu, not only from in-webview controls. (Confirmed 2026-07-12; Preferences
  item added 2026-07-13.)
- **G9** — Deleting a history entry removes its history record (it no
  longer appears in the history list, and an H2-style lookup for it returns
  nothing); if the source audio file still exists on disk, it is also moved
  to the OS trash (same recoverable guarantee as G7, never a permanent
  delete). (Confirmed 2026-07-12.)
- **G10** — Preferences opens via the native menu's Preferences... item and
  via its platform shortcut (Cmd+, macOS / Ctrl+, Windows/Linux); both reach
  the same view. (Confirmed 2026-07-13.)
- **G11** — Saving an API key in Preferences writes it to a local config
  file in the OS's per-user app-config directory (never inside the git
  repo, never committed — grep/test-enforced, same pattern as F4/H3); the
  webview never reads or writes that file directly, only a Rust command
  does (G3-style capability review applies). The sidecar uses this file's
  key only when the `GROQ_API_KEY` environment variable is unset; the
  environment variable always takes priority when both are present.
  (Confirmed 2026-07-13.)
- **G12** — The Settings dialog exposes General / Voice input / Custom
  dictionary / Connection sections from the existing entry points (sidebar
  item, native menu, Cmd+,/Ctrl+,), defaulting to Voice input; changing
  model/language in Voice input changes what the next queued transcription
  actually sends (closes the previous gap where the GUI hardcoded
  `whisper-large-v3-turbo` and never sent a language at all). Not a
  standalone vitest item beyond the unit tests already covering
  QueueContext's read of the setting — the dialog's rendering is verified by
  exercising it in the built app, same as G1/G6.

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

## J. Audio recording
- **J1** — Starting a recording shows an elapsed-time indicator with no
  auto-stop; nothing in the code imposes a duration cap (no
  timer/interval that calls stop after a fixed duration).
- **J2** — Stopping a recording finalizes it to one audio file on disk and
  adds it to the Queue through the same path a picked file uses;
  transcribing it produces a non-empty transcript. Manual/exploratory — CI
  runners have no microphone, same class of gap as G1's real-build
  verification.
- **J3** — Recorded audio is written to disk sample-by-sample during
  capture via a `cpal` input-stream callback into an open
  `hound::WavWriter`, never buffered whole in memory (Rust unit test:
  `apps/desktop/src-tauri/src/recording.rs`'s `#[cfg(test)]` module).
- **J4** — Recording builds cleanly for Linux (`ubuntu-latest`, with
  `libasound2-dev` present) — the target a webview-`getUserMedia` recorder
  could not reach at all (verified during implementation: WebKitGTK has no
  released Tauri version that enables media-stream capture). Same class of
  check as G1.
- **J5** — macOS: both `NSMicrophoneUsageDescription` (Info.plist) and the
  `com.apple.security.device.audio-input` entitlement are present in the
  built bundle — verified against a real `tauri build` bundle, not
  `tauri dev` (the dev binary has no Info.plist at all, so a dev-only check
  cannot catch a missing entitlement).
- **J6** — The audio source (microphone / system audio / both) chosen in
  Settings > Voice input is what `start_recording` is actually called with,
  and an install that has never chosen one records the microphone only
  (`apps/desktop/tests/recording/RecordingContext.test.tsx`,
  `apps/desktop/tests/preferences/VoiceInputSection.test.tsx`, plus
  `recording.rs`'s `audio_source_defaults_to_microphone_only`).
- **J7** — Mixing two sources is sample-correct and stays continuous across
  mixer ticks: resampling between differing device rates interpolates rather
  than dropping frames, a starved source contributes silence while holding
  its read position, and a source whose clock runs fast has its backlog
  bounded instead of growing for the whole session (Rust unit tests in
  `recording.rs`'s `#[cfg(test)]` module).
- **J8** — A source that captured nothing but digital silence is reported
  back and surfaced in the GUI without failing the recording — the file is
  still finalized and still queued. This is the only detectable form of a
  denied macOS system-audio permission, which TCC enforces silently (Rust
  peak-tracking tests + `RecordingContext.test.tsx`).
- **J9** — Linux refuses system-audio capture with an explicit message
  naming the monitor-source workaround, and the GUI disables the option
  there rather than offering a picker that could only return silence
  (`recording.rs`'s `linux_reports_system_capture_as_unavailable`, and
  `VoiceInputSection.test.tsx`'s empty-output-device case). Manual on Linux
  itself; the platform split is unit-pinned.
- **J10** — macOS: `NSAudioCaptureUsageDescription` is present in the built
  bundle — system capture is its own TCC category, so the microphone keys
  in J5 do not cover it. Same real-`tauri build` check as J5.

## K. Custom dictionary (word replacement)
- **K1** — `applyDictionary()` replaces every occurrence of a stored word
  with its replacement in both `TranscriptResult.text` and every segment's
  `text` (unit test, pure function, `packages/core/tests/dictionary.test.ts`).
- **K2** — A word made only of ASCII characters matches whole-word only
  (does not fire inside a larger token); a word containing any non-ASCII
  character matches as a plain substring (unit test, using real
  substring-containment and boundary cases from the Amical export).
- **K3** — Importing the same JSON file twice leaves the same row count and
  the same replacement values (idempotent upsert by word).
- **K4** — Dictionary CRUD (`packages/core/src/db/dictionary.ts`) uses only
  the Drizzle query builder, no raw SQL outside migrations (grep/test-
  enforced: `tests/db-hygiene.test.ts`'s H4 regex already scans all of
  `packages/core/src/db/**`, so this is covered by the existing test with no
  changes needed there).
- **K5** — The custom dictionary is applied identically on the CLI and GUI
  paths (`packages/cli/src/cli.ts` and `packages/core/src/sidecar.ts` both
  call `applyDictionary()` right after `runPipeline()`, before
  `render()`/history) — GUI/CLI parity, same principle as G4.
- **K6** — A missing/unreachable `DATABASE_URL` never blocks or fails a
  transcription because of the dictionary fetch — it silently applies zero
  replacements, same non-blocking rule as H5.

## L. Transcript notes (annotations)
- **L1** — Turning a DOM selection into `[startOffset, endOffset)` and
  rendering notes/period-breaks back onto raw text round-trip exactly:
  concatenating the rendered DOM's text content always reproduces the
  original `transcriptText` byte-for-byte, independent of the
  break-at-period display setting (unit tests,
  `apps/desktop/tests/notes/textOffsets.test.ts`, including selections
  that span a `<br>` or a highlighted `<mark>`).
- **L2** — The transcript body is never mutated by any note action:
  `AnnotatedTranscript`'s props expose no way to change `text` at all (add/
  update/delete only ever touch the separate `transcript_notes` table).
  Verified against a real Postgres instance, not just mocks: adding,
  reading, updating (anchor untouched, only `note` changes), and deleting
  notes, plus `ON DELETE CASCADE` removing a transcript's notes when the
  transcript itself is deleted (manual run against `DATABASE_URL`,
  `packages/core/src/db/notes.ts` + `history.ts`).
- **L3** — A new note whose range overlaps an existing one is rejected
  before any backend call is made (`apps/desktop/tests/notes/
  useTranscriptNotes.test.tsx`); a range that only touches at a boundary is
  allowed.
- **L4** — "Add to dictionary" from a note creates a normal custom-
  dictionary entry (K above) and nothing else — it cannot retroactively
  alter the transcript the note is attached to, because no code path from
  a note ever writes to `transcriptText` (structural guarantee per L2, plus
  `AnnotatedTranscript.test.tsx`'s dictionary-link test asserting the exact
  call and the shown confirmation copy).
- **L5** — "Copy with notes" is a second, distinct action from the existing
  "copy transcript" (unchanged), reachable only once a row actually has
  notes — with no notes, `CopyMenu` renders as the same single instant-copy
  icon it always was, never a menu offering one meaningless choice
  (`apps/desktop/tests/notes/CopyMenu.test.tsx`'s `hasNotes: false` cases).
  Its output appends a footer quoting each note's own snippet and text in
  reading order (`startOffset`), never edits or marks up the body
  (`apps/desktop/tests/notes/notesFormat.test.ts`).
- **L6** — Notes work from the Queue screen, not only History: a `transcribe`
  response now carries the new `transcriptions.id`
  (`recordHistory`'s `.returning()` threaded through
  `TranscribeResponse`/`TranscribeResponseDto` end-to-end — Rust
  camelCase-decode regression tests plus `packages/core/tests/sidecar.test.ts`),
  present whenever a history row was actually written and absent
  (never a crash) when it wasn't. A Queue item's `useTranscriptNotes` call
  never issues its own `list_notes` sidecar call, since a transcription
  `transcribe` just inserted provably has zero notes yet
  (`useTranscriptNotes.test.tsx`'s `knownNoteCount` cases).
- **L7** — `listHistory()` reports each row's note count via a single
  leftJoin+count alongside the rows themselves, not a follow-up query per
  row — so opening a History list of N entries spawns at most one extra
  sidecar subprocess per row that actually HAS notes, not N (this app's IPC
  has no persistent connection; every command is its own process, see
  `commands.rs`'s `call_sidecar`). Verified against a real Postgres: a row
  with notes and a row without both report the correct count in the same
  query (manual run, `packages/core/src/db/history.ts`).
- **L8** — The four note commands (`list_notes`/`add_note`/`update_note`/
  `delete_note`) mirror the dictionary commands' sidecar-proxy pattern
  exactly (thin Rust DTO → sidecar `switch` case → `db/notes.ts`), with the
  same camelCase-decode regression coverage the history/dictionary DTOs
  already have (`commands.rs`'s `#[cfg(test)]` module).
- **L9** — Clicking Save/Delete on a note popover shows disabled/"Saving..."
  (or "Deleting...") feedback the instant the click registers — synchronously,
  before the underlying request resolves — and a second click, an outside
  click, or Escape during that window is a no-op rather than a duplicate
  submission or a yanked-away popover (`apps/desktop/tests/notes/
  AnnotatedTranscript.test.tsx`'s "busy state while a save is in flight"
  suite). A failed request re-enables the form instead of leaving it stuck.
- **L10** — `CopyMenu`'s "copied" checkmark only appears once the copy has
  actually resolved — a rejected `onCopy`/`onCopyWithNotes` never flashes
  it (`apps/desktop/tests/notes/CopyMenu.test.tsx`).

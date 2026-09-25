# SPEC — Voice Transcript

## Purpose
A transcription tool built on a cloud API (Groq hosted Whisper), reliably
handling audio files longer than one hour, usable two ways from the same
core engine: a terminal CLI (original interface, unchanged) and a desktop
GUI for Windows, Linux, and macOS that adds a file queue and a persisted
history of past runs.

## Core approach
- **Provider:** Groq hosted Whisper via the speech-to-text HTTP API.
  Default model `whisper-large-v3-turbo` (fast, multilingual); selectable
  `whisper-large-v3` (max accuracy).
- **Runtime:** TypeScript, run on Node 24. Package management: **pnpm**
  (workspace/monorepo — see Architecture below).
- **Long-audio strategy (hybrid):** normalize with ffmpeg to 16 kHz mono; if the
  encoded file is still larger than the free-tier limit (threshold ~24 MB, under
  the 25 MB cap), split into chunks at **silence boundaries**, transcribe each,
  then stitch results with per-chunk time offsets applied to timestamps.
- **Auth:** `GROQ_API_KEY` read from the environment only.

## Architecture (monorepo)
- `packages/core` — no UI. Two parts: the **engine** (ffmpeg normalize,
  silence-based chunking, Groq client + retry, stitching, format renderers)
  and the **history/DB layer** (`src/db/**` — Drizzle ORM over `pg`,
  read/write/delete for the `transcriptions` table). Both the CLI and the
  desktop app depend on this package directly and must never re-implement
  either part.
- `packages/cli` — the existing `transcribe` command; a thin wrapper over
  `packages/core`'s engine, and (since the history feature) also calls
  `packages/core`'s DB layer directly to record each run — the CLI is a
  plain Node process with no Rust/Tauri involved, so there is no shell to
  proxy through on this path.
- `apps/desktop` — the Tauri app (`src-tauri/` Rust shell + a React + Vite
  webview). The Rust shell owns every privileged operation the GUI needs
  (ffmpeg, Groq calls, DB access) and exposes narrow `#[tauri::command]`s;
  the webview never touches secrets, the filesystem, or the database
  directly (see `.claude/agents/tauri-capability-reviewer.md`). Concretely,
  Rust never runs SQL itself — it spawns and supervises the sidecar (below),
  which is the only process that actually calls into `packages/core`'s
  engine and DB layer on the GUI's behalf.
- **Reuse strategy:** `packages/core` is TypeScript and already tested; it is
  **not** rewritten in Rust. `apps/desktop` runs it as a Tauri **sidecar**
  process (a bundled Node executable running `packages/core`'s logic —
  engine and DB layer both — spawned and supervised by the Rust shell over
  stdio/local IPC — never reachable from the webview). Rust proxies exactly
  the commands the UI needs.
- **Scaffolding tools added for this:** `.claude/skills/tauri-command-scaffold/`
  (keeps a Rust command and its TS `invoke()` wrapper in sync) and
  `.claude/agents/tauri-capability-reviewer.md` (reviews capability scope and
  checks secrets never reach the webview).

## CLI
- Command: `transcribe <audio-file> [options]`
- Options:
  - `-o, --output <file>` — write transcript to file (default: stdout)
  - `--format <txt|srt|vtt|json>` — output format (default: `txt`)
  - `--model <name>` — Whisper model (default: `whisper-large-v3-turbo`)
  - `--language <code>` — force language (default: auto-detect)
- Exit code `0` on success; non-zero on error, with a message on stderr.
- Unchanged by the GUI addition; still single-file. It does read the same
  history/dictionary DB layer as the GUI (records one history entry per run,
  applies the custom dictionary -- see below), just with no queue/multi-file
  concept of its own.

## GUI (desktop, Tauri)
- **Targets:** Windows, Linux, macOS — all three are formal targets (built and
  smoke-tested in CI on all three; not "Linux/Windows only, macOS best-effort").
- **File queue:** unlike the CLI, the GUI accepts multiple files at once; each
  is transcribed independently and tracked separately (one failure does not
  abort the others — see ACCEPTANCE D2's principle, extended to the queue).
- **Progress:** per-file (and per-chunk, when a file is split) progress is
  shown; no indeterminate spinner for a multi-minute operation.
- **History:** every run (CLI or GUI) is persisted — see Transcription history
  below — and the GUI's history view lists past runs and opens one to read its
  stored transcript without re-calling the API.
- Same output formats/model/language options as the CLI, exposed as GUI
  controls rather than flags.
- **Interface language:** GUI copy is available in Japanese and English,
  switchable via a simple in-app setting (no restart required). This is
  separate from `--language`/transcription-language handling above, which is
  about the audio's spoken language, not the UI's display language. Covers
  the native OS menu bar too (fixed 2026-07-13; previously English-only
  regardless of this setting) — the webview tells Rust to rebuild the menu
  whenever the language changes, including once at startup to sync a
  persisted preference (a brief English flash on a Japanese-preference cold
  start is an accepted tradeoff, not worth added startup-ordering
  complexity to avoid).
- **Theme:** explicit light/dark toggle in the GUI itself (not just following
  the OS setting) — confirmed at the design gate (2026-07-12).
- **Deleting a history item — two distinct actions** (confirmed 2026-07-12):
  1. **Send source audio to trash**: moves only the source audio file to the
     OS trash/recycle bin (never a permanent, unrecoverable delete); the
     history record and stored transcript text are kept and remain viewable
     (H2) — frees disk space without losing the transcript.
  2. **Delete history entry**: removes the history record itself (the entry
     disappears from history). If the source audio file still exists on
     disk, it is also moved to the OS trash (same recoverable guarantee as
     action 1) as part of the same action.
- **Native OS menu integration** (confirmed 2026-07-12; Preferences item
  added 2026-07-13): the app exposes real OS-level menus (macOS global menu
  bar / Windows app menu, via Tauri's Menu API), not just controls inside
  the webview. App-specific items: **Add files**, **Open history**,
  **Export** (the currently-open/selected transcript, in one of the
  existing formats — txt/srt/vtt/json, no new format), **View on GitHub**
  (opens the project repo in the default browser; likely under a Help
  menu), and **Preferences...** (opens the Settings dialog — see
  "Settings" below), bound to the
  platform-conventional shortcut: Cmd+, on macOS, Ctrl+, on Windows/Linux.
  Standard OS/Tauri menu conventions (About, Quit, Edit commands, Window
  menu on macOS, etc.) are included by platform convention and aren't
  itemized here.

## Audio recording
- The GUI can record directly from the microphone as a second way to get
  audio into the queue, alongside picking a file — a "Record" control sits
  beside "Add files" in the sidebar, and a persistent bar (visible
  regardless of which tab is active) shows elapsed time and a Stop control
  while recording. A finished recording is finalized to a WAV file and
  queued exactly like a picked file — no special-casing in the
  transcription pipeline downstream.
- **No duration cap**: the app imposes no timer/stop-after-N-minutes logic.
  Capture happens natively in Rust (not the webview) and streams samples
  straight to disk as they arrive, never buffering the whole recording in
  memory — duration is bounded only by available disk space, not by a
  software limit. (A standard WAV file's own RIFF size field is 32-bit,
  which physically caps a single file around 3–4 hours at typical capture
  rates — well past Groq's own free-tier hourly audio budget below, so not
  the practical constraint on a useful single session; stated here as an
  accepted, honest limit rather than hidden.)
- **Implementation choice (decided after research): native capture via
  `cpal`, not the webview's `getUserMedia`/`MediaRecorder`.** Verified
  against this app's actual Tauri/wry versions: WebKitGTK (Linux) has no
  released Tauri version that enables webview media-stream capture or wires
  a permission-request handler, so a webview-based recorder would silently
  not work on one of this app's three formal targets. `cpal`
  (CoreAudio/WASAPI/ALSA) is the one implementation that is uniformly
  correct across macOS, Windows, and Linux, at no extra setup cost on macOS
  versus the webview route (microphone access is gated by the same
  TCC/hardened-runtime mechanism either way).
- **macOS permission**: requires both `NSMicrophoneUsageDescription`
  (Info.plist) and the `com.apple.security.device.audio-input` entitlement
  (Tauri enables hardened runtime by default, which enforces the
  entitlement even with the Info.plist key present) — both ship with the
  app, not left to a future build step.
- Microphone selection is a Settings > Voice input control (see below);
  listing devices needs no prior permission grant, only actually opening a
  capture stream does.
- **Audio source (added 2026-09-10): microphone, system audio, or both.**
  "System audio" records what the computer itself is playing — the other
  side of a call, a video — and "both" mixes it with the microphone into a
  single track, which is the meeting/interview case. Microphone-only stays
  the default: system capture needs a permission grant on macOS and does not
  exist at all on Linux, so it is chosen, never inherited on upgrade.
- **Implementation: the same `cpal` capture path, pointed at an output
  device.** cpal turns an output device into a capture device when you open
  an input stream on it — WASAPI loopback on Windows, a Core Audio process
  tap feeding a private aggregate device on macOS 14.6+. No second audio
  library, no virtual-device install (BlackHole/VB-Cable) asked of the user.
- **Linux is microphone-only, stated up front.** ALSA has no loopback path,
  and PulseAudio/PipeWire monitor sources are not visible to cpal's ALSA
  host, so the GUI disables the system-audio options there and
  `start_recording` refuses them with a message naming the workaround (route
  playback through a monitor source and select it as the microphone) rather
  than opening a stream that would return silence.
- **macOS permission**: system capture is its own TCC category, separate
  from the microphone — it needs `NSAudioCaptureUsageDescription` in
  Info.plist, and it prompts on the first stream *start*, not when the tap
  is created. A denial is enforced **silently**: every Core Audio call still
  returns `noErr` and the tap simply delivers zeroes. Because no API reports
  this, the recorder tracks each source's peak level and reports any source
  that produced nothing but digital silence back to the GUI, which shows a
  "check the permission" note next to the Record control. The recording
  itself still succeeds and is still queued.
- **Output format: 16-bit mono PCM at the capture rate**, for every source
  including microphone-only — one mixing path, no branch for the two-source
  build. Two capture devices cannot be summed without first agreeing on a
  rate and a channel count, and the pipeline downstream re-encodes every
  input to 16 kHz mono before upload anyway (`packages/core/src/audio.ts`),
  so nothing that reaches Groq is lost. Accepted tradeoffs, stated rather
  than hidden: recordings are no longer archival stereo, and summing two
  sources is hard-clamped at full scale rather than each being attenuated by
  half — a quiet microphone keeps its level, at the cost of clipping in the
  rare instant where both sources peak together.
- **Alignment between the two sources is driven by the wall clock**, not by
  sample counts: two devices run on two independent clocks, so a source that
  falls behind contributes silence for that stretch instead of pushing
  everything after it out of sync for the rest of an hour-long session.

## Settings
- A sectioned Settings dialog (renamed in substance from the original
  single-panel Preferences view, same entry points) — sections: **Voice
  input** (spoken-language auto-detect + override, Whisper model, audio
  source, recording microphone, captured output device), **Custom
  dictionary** (see below), **General** (display
  preferences), **Connection** (`GROQ_API_KEY` / `DATABASE_URL`, described
  next). Reachable via the sidebar's Settings item, the native menu's
  **Preferences...** item, and its platform shortcut (Cmd+,/Ctrl+,) — all
  three open the same dialog, defaulting to the Voice input section.
- **Voice input's model/language become the GUI's actual transcription
  defaults** (previously the GUI silently hardcoded
  `whisper-large-v3-turbo` and never sent a language at all, despite this
  spec's own promise below that these are "exposed as GUI controls") —
  changing them here changes what the next queued transcription (including
  a finished recording) actually sends.

## Connection (API key, database URL)
- The Connection settings section lets the user set `GROQ_API_KEY` and
  `DATABASE_URL` from the GUI instead of only via environment variables.
- **Storage (decided 2026-07-13): a local config file**, not the OS
  keychain. Written by the Rust shell to a file in the OS's per-user
  app-config directory (e.g. via Tauri's `path` API — platform-appropriate:
  `~/Library/Application Support/...` on macOS, `%APPDATA%\...` on Windows,
  `~/.config/...` on Linux), outside the git repo, never committed. The
  Node sidecar reads this file at startup as a fallback when the matching
  environment variable isn't set (environment variable still wins if both
  are present, for CLI/scripting use).
- **DATABASE_URL Preferences field (added 2026-07-13):** same
  storage/precedence pattern as the API key, in its own config file. Never
  read back to the webview — only a set/unset status is shown, same as the
  API key, since a Postgres connection string embeds a password.
- **Tradeoff, stated plainly:** this is plaintext-on-disk, not
  encrypted-at-rest the way an OS keychain entry would be. Mitigated only
  by OS file permissions (owner-read/write only, e.g. `0600` on
  macOS/Linux) and the file living outside the repo. Acceptable for this
  app's current scope (a single-user personal tool); would need revisiting
  (e.g. moving to OS keychain storage) before any multi-user or
  shared-machine use.
- The webview never reads or writes these files directly — the Connection
  section sends the entered key/URL to a Rust command, which alone touches
  the filesystem, same trust-boundary pattern as every other secret/fs/DB
  operation in this app (see Architecture above).

## Custom dictionary (word replacement)
- A user-maintained list of word → replacement pairs, applied to every
  completed transcription (CLI and GUI alike, so both interfaces produce
  identical corrected text — see Architecture's shared-engine principle)
  before the result is rendered, recorded to history, or returned. Managed
  from Settings > Custom dictionary: add, edit, delete entries, and
  **Import** a JSON file of entries.
- **Storage**: a `dictionary_entries` table in the same Postgres database as
  transcription history, via the same Drizzle ORM layer (portability rule
  below applies equally). `word` is unique, making import an idempotent
  upsert. Like history, this means the dictionary is unavailable when
  `DATABASE_URL` is unset/unreachable — consistent with H5's existing
  non-blocking rule: a missing dictionary never fails or blocks a
  transcription, it just means no replacements are applied that run.
- **Matching**: case-sensitive and literal. A word made only of ASCII
  characters matches whole-word only (won't fire inside a larger token); a
  word containing any non-ASCII character (i.e. any Japanese entry) matches
  as a plain substring, since Japanese has no whitespace word boundaries.
  Replacement is a single pass over the text (entries sorted longest-word-
  first), not a sequential per-entry pass — this is what keeps the result
  correct and non-cascading as the dictionary grows, and what makes a
  longer entry take precedence over a shorter one it contains.
- **Import formats accepted**: this app's own `{ word, replacement }[]`
  shape, and Amical's vocabulary export shape (`{ entries: [{ word,
  replacement_word, is_replacement, ... }] }` — entries with `is_replacement`
  falsy are skipped, since those are Amical's plain vocabulary hints with no
  replacement, a concept this app doesn't have a use for). Re-importing the
  same file is idempotent: row count and replacement values don't change on
  a repeat import.

## Transcript notes (annotations, added 2026-09-25)
- A side comment anchored to a specific word/phrase in a transcript — e.g.
  flagging that "2GOMCP" was misheard and should read "TogoMCP" — without
  touching the transcript body itself. Available on any row that has a
  saved history entry, in both **Queue** (a just-finished item, before it's
  even been looked at in History) and **History**: select a run of text in
  the row's expanded preview, a small popover opens for the note; a saved
  note renders as a highlighted span, click it to view/edit/delete.
- **The transcript body is never edited.** This was a deliberate choice
  between "correct the text in place" and "leave a side comment," made in
  favor of the latter — a note is a comment ABOUT the transcript, not a
  correction TO it. (A future "correct in place" mode, if ever wanted, is a
  separate feature, not an extension of this one.)
- **Anchoring: a raw character-offset range into `transcriptText`, not a
  timestamp.** Two reasons: Whisper segment data (the only timing this app
  keeps) is sentence/clause-granularity, far coarser than a single
  misheard word; and `transcriptText` is never edited after it's written
  (no edit-in-place feature exists), so a plain `[startOffset, endOffset)`
  pair stays valid indefinitely with no re-anchoring logic needed. Overlapping
  notes are rejected — kept simple for v1, editing an existing note covers
  the same-spot case.
- **Display formatting must not shift the offsets it's measured against.**
  The existing "line break after each 。" display option
  (`breakAfterJapanesePeriod`) inserts real `\n` characters into the string
  it returns — fine for plain display, but it would silently desynchronize
  any offset measured against its output from the raw stored text. The
  annotated view instead renders the SAME break points as zero-width
  `<br>` elements around the raw, unmodified text, so a browser selection's
  measured offsets always match `transcriptText` exactly, independent of
  whether that display option is on.
- **Dictionary link, explicitly not automatic**: a saved note offers an
  "Add to dictionary" action (prefilled with the note's own quoted
  snippet). This creates a normal custom-dictionary entry (above) — nothing
  more. Because the dictionary only applies at transcribe time, doing this
  does **not** retroactively correct the transcript the note is attached
  to; it only affects transcriptions made afterward. This is the intended
  behavior (matches "the body is never edited," above), not a limitation
  to paper over — the GUI says so in the confirmation message rather than
  leaving it to be discovered.
- **Copy, two modes**: the existing "copy transcript" action is unchanged
  (transcript text only, exactly as before — most transcripts have no
  notes at all, so nothing about the common case should change). A second
  "copy with notes" action appears ONLY once a row actually has notes
  (never as a second, redundant button when it would behave identically to
  the first) and appends a footer after the transcript body — quoting each
  note's own snippet and text, in reading order — rather than editing the
  body or inserting inline markers.
- **Storage**: a `transcript_notes` table (Postgres, same DB/ORM as history
  and the dictionary), foreign-keyed to `transcriptions.id` with an
  `ON DELETE CASCADE` — deleting a history entry also removes its notes,
  so they can never outlive the transcript they're about. Listing a
  transcript's notes is a single query keyed by that id; a bulk
  note-count is computed alongside `listHistory()`'s own query (a
  leftJoin+count, not a per-row follow-up call) so the History list can
  decide whether a given row has anything to fetch without a separate
  round trip per row.

## Transcription history (persistence)
- Every completed run (CLI and GUI both write to the same store) records:
  source file name, started-at timestamp, model, language, requested
  format(s), status, and the resulting transcript text (+ segments, if any).
- **Database, chosen for this v1: PostgreSQL**, reachable via a single
  `DATABASE_URL`-style connection string read from the environment (mirrors
  how `GROQ_API_KEY` is handled — never hardcoded). Run locally for now
  (your own local Postgres instance); intended to point at a self-hosted
  server later purely by changing `DATABASE_URL` — no app changes.
- **Portability requirement:** since a later move to MySQL (or a different
  Postgres host) is explicitly anticipated, the data-access layer must go
  through an ORM/query-builder that abstracts dialect differences — no
  vendor-specific raw SQL outside migration files. (Library choice — e.g.
  Drizzle, which supports Postgres/MySQL/SQLite from one API — is a build-time
  decision; verify current dialect-portability behavior against its docs
  before committing to it.)
- The app does not provision or manage the DB server — you run your own
  Postgres (or later MySQL) instance; the app only connects to it.
- **Schema auto-creation (added 2026-07-13):** on connecting, the app
  creates its own tables automatically if they don't already exist yet (an
  idempotent, tracked migration via the ORM's own migration runner — safe
  to run on every connect, not just once). This is schema initialization
  within a database you already stood up, not DB *provisioning* — it still
  never creates the database itself, installs Postgres, or manages the
  server.

## Release automation
- A manually triggered GitHub Actions workflow, `.github/workflows/release.yml`
  — `workflow_dispatch` only, run from a button in the GitHub UI. It never
  fires automatically on push or tag.
- Inputs: release **title** and **version/tag** (e.g. `v0.2.0`). No other
  inputs (no release-notes body, no draft/prerelease toggle, no build-target
  picker) — kept minimal by explicit choice.
- Builds **`apps/desktop` (the Tauri app) only** — `packages/cli` is not
  included in release artifacts; it continues to be used from source
  (`pnpm --filter cli`), not published or bundled here.
- Matrix: `windows-latest`, `ubuntu-latest`, `macos-latest` (mirrors the G1 CI
  build matrix). Each platform's native installer bundle is uploaded to a
  GitHub Release tagged with the given version: macOS → `.dmg`, Windows →
  `.exe` installer, Linux → Tauri's default bundle (`.AppImage`/`.deb`).
- README regeneration (`run.sh readme`, from `SPEC.md`) and adding this
  workflow both happen automatically once all implementation is done — at or
  after `integration_accept`, not mid-build (see `CLAUDE.md` > Release).

## Scope — IN
- Single **local** audio file input (m4a, mp3, wav, flac, and other ffmpeg-decodable formats).
- Files **> 1 hour** (validated against `tests/test.m4a` ≈ 78 min / 73 MB).
- Output formats: `txt` (default), `srt`, `vtt`, `json` (segment/word timestamps).
- Automatic language detection with optional override.
- ffmpeg-based normalization + silence-based chunking + stitching.
- Actionable errors for: missing API key, missing/invalid file, ffmpeg not
  installed, and API failures (with bounded retry on transient errors / 429 / 5xx).
- **Desktop GUI** (Tauri, Windows/Linux/macOS): multi-file queue, progress
  display, transcription history browsing.
- **Persisted transcription history** in a relational DB (Postgres now,
  portable to MySQL/another host later), covering both CLI and GUI runs.
- **In-app microphone recording**, no duration cap, via native (`cpal`)
  capture — a second way to get audio into the GUI's queue, alongside
  picking a file.
- **Custom dictionary** (word → replacement pairs) applied to every
  transcript, CLI and GUI alike, manageable from the GUI (add/edit/delete).
- **Dictionary import** from a JSON file, including Amical's vocabulary
  export shape specifically, as an idempotent upsert.
- **Manually triggered release workflow** building `apps/desktop` installers
  for Windows/Linux/macOS and publishing them to a GitHub Release.

## Scope — OUT (explicit)
- **Speaker diarization** — Groq/Whisper does not support it; would require a paid
  API (Deepgram/AssemblyAI/ElevenLabs) or heavy local `pyannote.audio`. Out.
- **Translation** to other languages.
- **Summarization** / any LLM post-processing — explicitly includes
  Amical-style automated re-punctuation/reformatting of the transcript via a
  cloud LLM (considered and declined during the recording/settings/
  dictionary work): it would need a paid LLM call beyond Groq's
  transcription endpoint, contradicting the "free tier only" constraint
  below, and falls under this same exclusion by name so it doesn't get
  reconsidered piecemeal later.
- **Batch / directory / multi-file processing in the CLI** — `transcribe` stays
  single-file. (The GUI's multi-file queue, above, is a GUI-only capability —
  it does not add a CLI batch flag.)
- **Real-time / streaming** transcription.
- **Remote URL input** (local file only, in both CLI and GUI).
- **Multi-user accounts / auth** — the DB holds one local user's history; no
  login, no per-user access control, for v1.
- **DB provisioning/hosting automation** — the app connects to a Postgres/MySQL
  instance you already have; it does not stand one up, migrate data between
  hosts automatically, or manage backups.
- **Cross-device sync beyond "point every install at the same DB server"** — no
  offline queue, conflict resolution, or merge logic; if two installs write
  concurrently, last-write-wins at the DB level is acceptable for v1.

## Constraints
- **Free tier only (Groq).** Must respect Groq free limits: 25 MB per request,
  7,200 audio-seconds/hour, 2,000 requests/day. The hybrid strategy exists to
  honor the 25 MB cap. The ~78-min test file (4,674 s) fits within the hourly
  audio budget.
- **No emoji** in source, CLI output, or GUI copy (see `~/.claude/rules/ui.md`
  and `design_brief.md` for the full GUI direction).
- **Colors only via design tokens** in the GUI; no hardcoded hex (design-gate
  enforced).
- A reachable Postgres instance (`DATABASE_URL` set) is required for history
  features; the transcription itself (CLI or GUI) must still work if the DB is
  unreachable — history recording fails loudly (logged) but never blocks or
  corrupts the transcription result itself.
- Local-only git; no push unless asked. Generated artifacts in English.

## Notes / unverified
- Groq free-tier numbers (25 MB, 7,200 s/hr, 2,000/day) are from public docs as of
  2026-07; re-verify against `console.groq.com/docs/speech-to-text` at build time.
- m4a is directly accepted by Groq; ffmpeg normalization still runs to guarantee
  16 kHz mono and to control payload size.
- Tauri sidecar packaging (bundling a Node executable + `packages/core` per
  platform, including Windows code-signing and macOS notarization
  requirements) is unverified against Tauri's current docs; re-verify at
  build time before committing to exact bundling config.
- The ORM/query-builder choice for Postgres-now/MySQL-later portability is
  unverified beyond the general claim that such libraries exist; confirm the
  specific library's dialect-portability guarantees before relying on them at
  build time.

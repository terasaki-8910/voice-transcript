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
- `packages/core` — the engine (ffmpeg normalize, silence-based chunking,
  Groq client + retry, stitching, format renderers). No UI, no DB. Both the
  CLI and the desktop app depend on this and must never re-implement it.
- `packages/cli` — the existing `transcribe` command; a thin wrapper over
  `packages/core`. Behavior unchanged from today.
- `apps/desktop` — the Tauri app (`src-tauri/` Rust shell + a React + Vite
  webview). The Rust shell owns every privileged operation (ffmpeg, Groq
  calls, DB access) and exposes narrow `#[tauri::command]`s; the webview
  never touches secrets, the filesystem, or the database directly (see
  `.claude/agents/tauri-capability-reviewer.md`).
- **Reuse strategy:** `packages/core` is TypeScript and already tested; it is
  **not** rewritten in Rust. `apps/desktop` runs it as a Tauri **sidecar**
  process (a bundled Node executable running `packages/core`'s logic, spawned
  and supervised by the Rust shell over stdio/local IPC — never reachable
  from the webview). Rust proxies exactly the commands the UI needs.
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
- Unchanged by the GUI addition; still single-file, no history/DB dependency.

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
  about the audio's spoken language, not the UI's display language.
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
  menu), and **Preferences...** (opens the Preferences view — see
  "Preferences (API key)" below), bound to the platform-conventional
  shortcut: Cmd+, on macOS, Ctrl+, on Windows/Linux. Standard OS/Tauri menu
  conventions (About, Quit, Edit commands, Window menu on macOS, etc.) are
  included by platform convention and aren't itemized here.

## Preferences (API key)
- A Preferences view lets the user set `GROQ_API_KEY` from the GUI instead
  of only via an environment variable. Reachable via the native menu's
  **Preferences...** item and its platform shortcut (Cmd+,/Ctrl+,).
- **Storage (decided 2026-07-13): a local config file**, not the OS
  keychain. Written by the Rust shell to a file in the OS's per-user
  app-config directory (e.g. via Tauri's `path` API — platform-appropriate:
  `~/Library/Application Support/...` on macOS, `%APPDATA%\...` on Windows,
  `~/.config/...` on Linux), outside the git repo, never committed. The
  Node sidecar reads this file at startup as a fallback when the
  `GROQ_API_KEY` environment variable isn't set (environment variable still
  wins if both are present, for CLI/scripting use).
- **Tradeoff, stated plainly:** this is plaintext-on-disk, not
  encrypted-at-rest the way an OS keychain entry would be. Mitigated only
  by OS file permissions (owner-read/write only, e.g. `0600` on
  macOS/Linux) and the file living outside the repo. Acceptable for this
  app's current scope (a single-user personal tool); would need revisiting
  (e.g. moving to OS keychain storage) before any multi-user or
  shared-machine use.
- The webview never reads or writes this file directly — the Preferences
  view sends the entered key to a Rust command, which alone touches the
  filesystem, same trust-boundary pattern as every other secret/fs/DB
  operation in this app (see Architecture above).

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
- **Manually triggered release workflow** building `apps/desktop` installers
  for Windows/Linux/macOS and publishing them to a GitHub Release.

## Scope — OUT (explicit)
- **Speaker diarization** — Groq/Whisper does not support it; would require a paid
  API (Deepgram/AssemblyAI/ElevenLabs) or heavy local `pyannote.audio`. Out.
- **Translation** to other languages.
- **Summarization** / any LLM post-processing.
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

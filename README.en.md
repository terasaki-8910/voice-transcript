<div align="right">

[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-bc002d?style=flat-square)](./README.md)

</div>

# Voice Transcript

Transcribe audio to text with Groq's hosted Whisper API — from a terminal CLI or a
cross-platform desktop app — reliably handling **audio longer than one hour** via
silence-based chunking and stitching. One shared engine, two front ends, and a persisted
history of every run.

## Requirements
- **Node.js 24**
- **pnpm** (this is a workspace monorepo: `packages/core`, `packages/cli`, `apps/desktop`)
- **ffmpeg** on `PATH` (used to normalize and split audio)
- **`GROQ_API_KEY`** — read from the environment. In the desktop app it can instead be set
  via Preferences (see below); the environment variable always wins when both are present.
- **PostgreSQL**, reachable via a `DATABASE_URL` connection string in the environment —
  required only for the transcription-history features. Transcription itself works without
  it (see Constraints). You run your own Postgres instance; the app only connects to it.
- Building/running the desktop app additionally needs the Tauri toolchain (Rust); the
  app's Rust shell owns all privileged operations (ffmpeg, Groq calls, DB access).

## Setup
```sh
pnpm install                       # install all workspace packages
```

## CLI usage
The `transcribe` command is single-file and unchanged by the desktop addition. It is run
from source out of the workspace (not published or bundled):

```sh
transcribe <audio-file> [options]
```

| Option | Description | Default |
|---|---|---|
| `-o, --output <file>` | Write the transcript to a file | stdout |
| `--format <txt\|srt\|vtt\|json>` | Output format | `txt` |
| `--model <name>` | Whisper model (`whisper-large-v3-turbo` / `whisper-large-v3`) | `whisper-large-v3-turbo` |
| `--language <code>` | Force the spoken language | auto-detect |

```sh
export GROQ_API_KEY=...                                # required
transcribe meeting.m4a                                 # txt to stdout
transcribe meeting.m4a --format srt -o out.srt
transcribe long.m4a --model whisper-large-v3 --language ja
```

Exit code `0` on success; non-zero on error with a message on stderr (missing key,
missing/invalid file, ffmpeg not installed, or API failure). With `-o`, the transcript
goes to the file and only logs go to stderr — stdout stays clean.

## Desktop app (Windows, Linux, macOS)
```sh
pnpm --filter desktop tauri dev                        # development loop
```

- **File queue:** transcribe multiple files at once (a CLI-only-vs-GUI difference — the CLI
  stays single-file). Each file is tracked independently; one failure does not abort the rest.
- **Progress:** per-file, and per-chunk when a long file is split — no indeterminate spinner.
- **History:** every run (CLI and GUI) is persisted; the history view lists past runs and
  opens one to read its stored transcript without re-calling the API.
- **Same options as the CLI** (format, model, language) exposed as controls, not flags.
- **Interface language:** Japanese and English, switchable in-app with no restart. This is
  separate from `--language`, which is the audio's spoken language.
- **Theme:** explicit light/dark toggle (not only OS-following).
- **Deleting a history item — two distinct actions:** *Send source audio to trash* moves
  only the source file to the OS trash (recoverable) while keeping the record and
  transcript; *Delete history entry* removes the record itself and, if the source file
  still exists, also sends it to the OS trash. Neither is a permanent unrecoverable delete.
- **Native OS menu:** real OS-level menus (not just in-webview controls) exposing **Add
  files**, **Open history**, **Export** (the current transcript in an existing format —
  txt/srt/vtt/json), **View on GitHub**, and **Preferences...** — the last bound to the
  platform shortcut (Cmd+, on macOS, Ctrl+, on Windows/Linux).

### Preferences (API key)
The Preferences view sets `GROQ_API_KEY` from the GUI instead of only via an environment
variable. The key is written by the Rust shell to a **local config file** in the OS's
per-user app-config directory (`~/Library/Application Support/…` on macOS, `%APPDATA%\…`
on Windows, `~/.config/…` on Linux), outside the repo and never committed. The webview
never touches this file directly. The sidecar uses this key only when `GROQ_API_KEY` is
unset in the environment.

Tradeoff, stated plainly: this is plaintext-on-disk, not an encrypted OS-keychain entry —
protected only by owner-only file permissions and living outside the repo. Acceptable for
this single-user personal tool; it would need revisiting (e.g. moving to the OS keychain)
before any multi-user or shared-machine use.

## Output and long-audio behavior
- Formats: `txt` (default, no timestamps), `srt`, `vtt`, `json` (segment/word timestamps).
- Long audio: ffmpeg normalizes to 16 kHz mono; if the encode still exceeds the threshold
  (~24 MB, under Groq's 25 MB/request cap) it is **split at silence boundaries**, each
  chunk transcribed, then results **stitched** with per-chunk time offsets applied so
  merged timestamps stay monotonic. Validated against `tests/test.m4a` (~78 min / 73 MB).
- Transcribing the same file with the same options via CLI and GUI yields byte-identical
  text — both call the same `packages/core` engine.

## Transcription history (Postgres)
Every completed run — CLI or GUI — writes one record: source file name, started-at
timestamp, model, language, requested format(s), status, and the transcript text (plus
segments when the format has them). `DATABASE_URL` is read only from the environment;
nothing DB-related is hardcoded. The data-access layer goes through an ORM/query-builder
(no vendor-specific raw SQL outside migrations) so a later move to MySQL or another host is
a config change, not a rewrite. The app connects to your Postgres; it does not provision,
migrate, or back it up.

## Release automation
A manually triggered GitHub Actions workflow (`.github/workflows/release.yml`,
`workflow_dispatch` only — never on push/tag) takes exactly two inputs, **title** and
**version/tag**. It builds **`apps/desktop` only** across `windows-latest`,
`ubuntu-latest`, and `macos-latest`, and uploads each platform's native installer to a
GitHub Release (macOS `.dmg`, Windows `.exe`, Linux `.AppImage`/`.deb`). `packages/cli` is
not built or published by the release — it is used from source.

## Constraints
- **Groq free tier only:** 25 MB per request, 7,200 audio-seconds/hour, 2,000 requests/day.
  The chunking strategy exists to honor the 25 MB cap.
- **No emoji** in source, CLI output, or GUI copy; **colors only via design tokens** in the
  GUI (no hardcoded hex, design-gate enforced).
- History needs a reachable Postgres, but transcription must still complete if the DB is
  unset or unreachable — only the history write fails, and it fails loudly (logged), never
  silently and never blocking or corrupting the transcript.
- Local-only git; nothing is pushed unless asked. Generated artifacts are in English.

## Out of scope (explicit)
Speaker diarization; translation; summarization / any LLM post-processing; CLI
batch/directory/multi-file processing (the GUI queue is GUI-only); real-time/streaming;
remote-URL input (local files only); multi-user accounts or auth (one local user's history,
no login); DB provisioning/hosting/backup automation; cross-device sync beyond pointing
installs at the same DB (last-write-wins, no conflict resolution). See `SPEC.md` for detail.

## Developed via the gated pipeline
This repo is built by the gated pipeline in `scripts/run.sh` (spec → failing tests →
design gate → plan → per-feature build → acceptance). Resume from any stage:
```sh
sh scripts/run.sh from build                 # run this stage through the end
INTERACTIVE=1 sh scripts/run.sh from build   # watch it in a visible TUI / with notifications
```
Pass/fail criteria are in `ACCEPTANCE.md`; the stage definitions are in `pipeline.yaml`.
These README files are generated from `SPEC.md` (via `sh scripts/run.sh readme`), not
hand-authored.

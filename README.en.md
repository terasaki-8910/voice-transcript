<div align="right">

[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-bc002d?style=flat-square)](./README.md)

</div>

# Voice Transcript

A terminal CLI that transcribes an audio file to text using Groq's hosted Whisper API,
reliably handling **audio longer than one hour** via silence-based chunking and stitching.

## Requirements
- **Node.js >= 24**
- **ffmpeg** (must be on `PATH`; used to normalize and split audio)
- **`GROQ_API_KEY`** (environment variable; the key is read only from here)

## Setup
```sh
npm install
npm run build          # build with tsc to dist/ (binary: transcribe -> dist/index.js)
# Dev without building:  npm run transcribe -- <audio> [options]   (runs via tsx)
```

## Usage
```sh
transcribe <audio-file> [options]
```

| Option | Description | Default |
|---|---|---|
| `-o, --output <file>` | Write transcript to a file | stdout |
| `--format <txt\|srt\|vtt\|json>` | Output format | `txt` |
| `--model <name>` | Whisper model (`whisper-large-v3-turbo` / `whisper-large-v3`) | `whisper-large-v3-turbo` |
| `--language <code>` | Force a language | auto-detect |

Examples:
```sh
export GROQ_API_KEY=...             # required
transcribe meeting.m4a                       # txt to stdout
transcribe meeting.m4a --format srt -o out.srt
transcribe long.m4a --model whisper-large-v3 --language ja
```
Exit code `0` on success; non-zero on error with a message on stderr (missing key,
missing file, ffmpeg not installed, API failure, etc.).

## Output formats
`txt` (default, no timestamps), `srt`, `vtt`, `json` (segment/word timestamps).

## Long-audio handling
Normalize to 16 kHz mono with ffmpeg -> if the encoded file exceeds the threshold
(~24 MB, under Groq's 25 MB/request cap), **split at silence boundaries** -> transcribe
each chunk -> **stitch** with per-chunk time offsets applied to timestamps. Validated
against the ~78-minute test file `tests/test.m4a`.

**Out of scope** (explicit): speaker diarization, translation, summarization, batch/
multi-file, real-time/streaming, remote URL input, GUI. See `SPEC.md`.

## Constraints
- **Groq free tier only** (25 MB/request, 7,200 audio-seconds/hour, 2,000 requests/day).
- **No emoji** in source or output (the only UI rule applicable to this no-UI tool).
- Generated artifacts are in English (`CLAUDE.md` > Language). Git is local; no push.

## Development (gated pipeline)
This repo is built by the gated pipeline in `scripts/run.sh` (freeze spec -> failing
tests -> plan -> parallel per-feature build -> acceptance). Run stage by stage:
```sh
sh scripts/run.sh from build                 # resume from a stage (build onward)
INTERACTIVE=1 sh scripts/run.sh from build   # watch progress / with notifications
```
Pass/fail criteria live in `ACCEPTANCE.md`, the decomposition in `PLAN.md`, stage
details in `pipeline.yaml`.

## Tests
```sh
npm test          # vitest (unit; e2e self-skips without GROQ_API_KEY)
npm run lint      # eslint + no-emoji check
npm run typecheck # tsc --noEmit
```
The e2e suite (`tests/e2e/`) runs against the real Groq API and `tests/test.m4a`, only
when `GROQ_API_KEY` is set. Full acceptance criteria (A-F) are in `ACCEPTANCE.md`.

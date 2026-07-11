# SPEC — Voice Transcript

## Purpose
A terminal CLI that transcribes an audio file to text using a cloud API
(Groq hosted Whisper), reliably handling files longer than one hour.

## Core approach
- **Provider:** Groq hosted Whisper via the speech-to-text HTTP API.
  Default model `whisper-large-v3-turbo` (fast, multilingual); selectable
  `whisper-large-v3` (max accuracy).
- **Runtime:** TypeScript, compiled with `tsc`, run on Node 24 (dev via `tsx`).
- **Long-audio strategy (hybrid):** normalize with ffmpeg to 16 kHz mono; if the
  encoded file is still larger than the free-tier limit (threshold ~24 MB, under
  the 25 MB cap), split into chunks at **silence boundaries**, transcribe each,
  then stitch results with per-chunk time offsets applied to timestamps.
- **Auth:** `GROQ_API_KEY` read from the environment only.

## CLI
- Command: `transcribe <audio-file> [options]`
- Options:
  - `-o, --output <file>` — write transcript to file (default: stdout)
  - `--format <txt|srt|vtt|json>` — output format (default: `txt`)
  - `--model <name>` — Whisper model (default: `whisper-large-v3-turbo`)
  - `--language <code>` — force language (default: auto-detect)
- Exit code `0` on success; non-zero on error, with a message on stderr.

## Scope — IN
- Single **local** audio file input (m4a, mp3, wav, flac, and other ffmpeg-decodable formats).
- Files **> 1 hour** (validated against `tests/test.m4a` ≈ 78 min / 73 MB).
- Output formats: `txt` (default), `srt`, `vtt`, `json` (segment/word timestamps).
- Automatic language detection with optional override.
- ffmpeg-based normalization + silence-based chunking + stitching.
- Actionable errors for: missing API key, missing/invalid file, ffmpeg not
  installed, and API failures (with bounded retry on transient errors / 429 / 5xx).

## Scope — OUT (explicit)
- **Speaker diarization** — Groq/Whisper does not support it; would require a paid
  API (Deepgram/AssemblyAI/ElevenLabs) or heavy local `pyannote.audio`. Out.
- **Translation** to other languages.
- **Summarization** / any LLM post-processing.
- **Batch / directory / multi-file** processing.
- **Real-time / streaming** transcription.
- **Remote URL input** (local file only).
- Any **GUI / web UI** — this is a terminal tool; no design-token or a11y surface.

## Constraints
- **Free tier only.** Must respect Groq free limits: 25 MB per request, 7,200
  audio-seconds/hour, 2,000 requests/day. The hybrid strategy exists to honor the
  25 MB cap. The ~78-min test file (4,674 s) fits within the hourly audio budget.
- **No emoji** in source or output (the only project UI rule applicable to this no-UI tool).
- Local-only git; no push unless asked. Generated artifacts in English.

## Notes / unverified
- Groq free-tier numbers (25 MB, 7,200 s/hr, 2,000/day) are from public docs as of
  2026-07; re-verify against `console.groq.com/docs/speech-to-text` at build time.
- m4a is directly accepted by Groq; ffmpeg normalization still runs to guarantee
  16 kHz mono and to control payload size.

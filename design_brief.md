# Design Brief — Voice Transcript Desktop

Import global direction: @~/.claude/rules/ui.md

## Do
- Keep one primary action visible at all times: drop/pick file(s) -> transcribe.
  Queue and history are secondary surfaces, reachable but not competing with
  the primary action for attention.
- Show real progress: per-file, and per-chunk when a file is split into
  silence-boundary chunks — the engine already knows the chunk count, so
  there is no excuse for an indeterminate spinner on a multi-minute run.
- History list: newest-first, file name + timestamp + status visible without
  opening a row; opening a row shows the stored transcript text immediately
  (no re-call to Groq).
- Use native window chrome and native file-picker dialogs per OS. Windows,
  Linux, and macOS all differ here — do not paper over it with a custom
  in-webview file browser.
- Surface failures per-item in the queue (which file failed, why) rather than
  a single generic "something went wrong."

## Avoid
- No onboarding wizard or multi-step setup flow. The tool is "drop a file, get
  text" — one drop zone, one queue, one history list, nothing else competing
  on the main screen.
- No dashboard-style stat tiles, gradients, or decorative chrome — this is a
  utility, not a marketing surface (see global rule: no AI-generated look).
- Never block the UI thread while ffmpeg/Groq/DB work runs in the sidecar —
  every long operation is async with visible progress; a frozen window is a
  bug, not a loading state.
- Do not invent GUI-only settings that don't map to a CLI flag (model,
  language, format) — the two interfaces should feel like the same tool.

## Platform note
Targets: Windows, Linux, macOS — all three are formal targets, not
best-effort. Verify window controls, native file-picker behavior, and
notification/toast behavior on each; Tauri abstracts most of this but native
dialog appearance and keyboard conventions still differ per OS.

## Confirmed direction (design gate, 2026-07-12)
- Neutrals: pure, clearly-grey (cool-leaning is fine) — not a hue-tinted
  near-black. See `design/tokens.css`.
- Theme: explicit Light/Dark toggle in the UI itself, not only OS-detected.
- Language: explicit EN/日本語 toggle, switches all UI copy without a
  restart (ACCEPTANCE G6). Product name ("Voice Transcript") does not
  translate.
- Layout direction (toolbar with an always-visible primary action, pill
  tabs for Queue/History, card-style queue rows, a waveform-styled progress
  indicator instead of a generic bar) was reviewed and approved as-is.
- Type: dropped the literal "Ubuntu"/"Ubuntu Mono" font names from the
  stacks -- they read as visually out of place (esp. for filenames in mono
  context). Rely on generic `system-ui`/`monospace` fallback instead of
  naming a specific Linux-default face.
- Two distinct delete-adjacent actions per history row: "Send audio to
  trash" (keeps the record/transcript -- same visual weight as the existing
  View/Retry text-links, not styled as alarming) vs. "Delete entry" (removes
  the record too -- this one should read as more deliberate, e.g. a
  confirm step, since the transcript itself is what's being lost this time).
- Core actions should also be reachable via a real native OS menu (macOS
  menu bar / Windows app menu), not only in-webview controls -- extends the
  existing "respect native window chrome" rule to the app's whole command
  surface, not just its window frame. Confirmed items: Add files, Open
  history, Export, View on GitHub.

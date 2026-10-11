// Diagram specs. Coordinates are canvas pixels (1x). Nodes are positioned by
// their icon tile's center; steps, groups, lists and rows by their top-left.
// Edge endpoints are element ids (anchored on a side) or literal [x, y] points;
// `via` points may leave x or y null to inherit it from the previous point.
// Facts here must match the code -- see the comments next to the numbers.

const architecture = {
  name: "architecture",
  width: 1200,
  height: 822,
  groups: [
    { id: "g-pc", x: 16, y: 16, w: 784, h: 790, title: "Your computer", sub: "macOS · Windows · Linux", icons: ["fe:monitor"] },
    { id: "g-app", x: 36, y: 60, w: 744, h: 300, title: "Desktop app", sub: "Tauri 2", icons: ["si:Tauri"], style: "inner" },
    { id: "g-web", x: 56, y: 106, w: 250, h: 234, title: "Webview", sub: "no secrets · no fs · no DB", style: "dashed" },
    { id: "g-rust", x: 326, y: 106, w: 434, h: 234, title: "Rust shell", sub: "the only privileged side", icons: ["si:Rust"], style: "plain" },
    { id: "g-core", x: 36, y: 404, w: 744, h: 256, title: "packages/core", sub: "one engine, two entry points · TypeScript", icons: ["si:Nodedotjs"], style: "inner" },
    { id: "g-home", x: 860, y: 16, w: 324, h: 236, title: "Home server", sub: "Ubuntu · Docker", icons: ["si:Ubuntu", "si:Docker"] },
    { id: "g-groq", x: 860, y: 292, w: 324, h: 196, title: "Groq Cloud", icons: ["fe:cloud"] },
    { id: "g-gh", x: 860, y: 548, w: 324, h: 258, title: "GitHub", icons: ["si:Github"] },
  ],
  nodes: [
    { id: "n-ui", x: 181, y: 182, icon: "si:React", title: "React 19 UI", sub: ["TypeScript · Vite", "Queue · History · Notes", "Search · Settings"] },
    { id: "n-cmd", x: 436, y: 182, icon: "si:Tauri", title: "Tauri commands", sub: ["API key · DB URL in a local", "config file (owner-only)", "native menu · file dialogs"] },
    { id: "n-rec", x: 650, y: 182, icon: "fe:mic", title: "Recorder", sub: ["cpal: mic + system audio", "50 ms mixer thread", "streams WAV to disk"] },
    { id: "n-cli", x: 181, y: 474, icon: "fe:terminal", title: "CLI", sub: ["packages/cli", "transcribe <file> --format srt"] },
    { id: "n-side", x: 436, y: 474, icon: "si:Nodedotjs", title: "Sidecar binary", sub: ["esbuild + pkg", "one process per command"] },
    { id: "n-orm", x: 650, y: 474, icon: "si:Drizzle", title: "Drizzle ORM", sub: ["history · dictionary", "notes · search"] },
    { id: "n-ff", x: 436, y: 728, icon: "si:Ffmpeg", title: "ffmpeg", sub: ["on PATH"] },
    { id: "n-pg", x: 1022, y: 110, icon: "si:Postgresql", title: "PostgreSQL", sub: ["least-privilege role per app", "schema auto-migrated on connect"] },
    { id: "n-groq", x: 1022, y: 372, icon: "fe:cloud", accent: true, title: "Whisper API", sub: ["whisper-large-v3 / -turbo", "25 MB per request"] },
    { id: "n-act", x: 944, y: 650, icon: "si:Githubactions", title: "Actions", sub: ["release.yml", "manual dispatch", "3-OS build matrix"] },
    { id: "n-rel", x: 1100, y: 650, icon: "fe:download", title: "Releases", sub: [".dmg · .exe · .msi", ".AppImage · .deb"] },
  ],
  steps: [
    { id: "s-engine", x: 56, y: 588, w: 704, kind: "bar", icon: "fe:layers", title: "Shared engine", sub: ["normalize  →  split at silence  →  Groq client + retry  →  stitch  →  dictionary  →  render txt / srt / vtt / json"] },
  ],
  edges: [
    { from: "n-ui", fromSide: "right", to: "n-cmd", toSide: "left", fromOff: -9, toOff: -9, label: "invoke()", labelAt: [308, 160], style: "accent" },
    { from: "n-cmd", fromSide: "left", to: "n-ui", toSide: "right", fromOff: 9, toOff: 9, label: "emit() events", labelAt: [308, 206] },
    { from: "n-cmd", fromSide: "bottom", to: "n-side", toSide: "top", label: "spawn · JSON over stdio", labelAt: [436, 382], style: "accent" },
    { from: "n-cli", fromSide: "bottom", to: "s-engine", toSide: "top", toOff: -227 },
    { from: "n-side", fromSide: "bottom", to: "s-engine", toSide: "top", toOff: 28, style: "accent" },
    { from: [650, 588], to: "n-orm", toSide: "bottom" },
    { from: [436, 640], to: "n-ff", toSide: "top", label: "spawn ffmpeg", labelAt: [436, 676] },
    { from: "n-orm", fromSide: "right", to: "n-pg", toSide: "left", via: [[822, null], [null, 110]], label: "pg over Tailscale", labelIcon: "si:Tailscale", labelAt: [822, 272] },
    { from: [760, 614], to: "n-groq", toSide: "left", via: [[842, null], [null, 372]], label: "HTTPS · chunks in parallel", labelAt: [842, 520], style: "accent" },
    { from: "n-act", fromSide: "right", to: "n-rel", toSide: "left" },
  ],
};

// pipeline.ts: normalize -> detectSilences -> planChunks (CHUNK_TARGET_BYTES =
// 20 MB) -> splitAt -> measure vs MAX_UPLOAD_BYTES (25,000,000), re-plan at
// budget * cap/largest * 0.95, max 3 attempts -> Promise.all(transcribe) ->
// stitch. audio.ts: 16 kHz mono FLAC, silencedetect noise=-30dB d=0.5.
// groq.ts: MAX_RETRIES 4 on 429/5xx, backoff 500 ms * 2^n (0.5, 1, 2, 4 s).
const pipeline = {
  name: "pipeline",
  width: 1200,
  height: 516,
  steps: [
    { id: "p1", x: 24, y: 56, w: 196, h: 124, num: "1 ", title: "Audio in", icon: "fe:file", sub: ["any length", "m4a · mp3 · wav", "or a recording"], kind: "terminal" },
    { id: "p2", x: 262, y: 56, w: 196, h: 124, num: "2 ", title: "Normalize", icon: "si:Ffmpeg", sub: ["ffmpeg to", "16 kHz mono FLAC"] },
    { id: "p3", x: 500, y: 56, w: 196, h: 124, num: "3 ", title: "Find silences", icon: "fe:activity", sub: ["ffmpeg silencedetect", "−30 dB for ≥ 0.5 s"] },
    { id: "p4", x: 738, y: 56, w: 196, h: 124, num: "4 ", title: "Plan cuts", icon: "fe:scissors", sub: ["≤ 20 MB: one chunk", "else the last silence", "inside the budget"] },
    { id: "p5", x: 976, y: 56, w: 200, h: 124, title: "Each chunk ≤\u00a025\u00a0MB?", icon: "fe:help-circle", sub: ["split, then measure", "the real file sizes"], kind: "decision" },
    { id: "p6", x: 976, y: 238, w: 200, h: 124, num: "5 ", title: "Transcribe", icon: "fe:cloud", accent: true, sub: ["all chunks in parallel", "retry 429 / 5xx,", "backoff 0.5 → 4 s"] },
    { id: "p7", x: 738, y: 238, w: 196, h: 124, num: "6 ", title: "Stitch", icon: "fe:git-merge", sub: ["shift segments by", "each chunk's offset;", "timestamps monotonic"] },
    { id: "p8", x: 500, y: 238, w: 196, h: 124, num: "7 ", title: "Dictionary", icon: "fe:book-open", sub: ["your word fixes,", "one pass, longest", "word first"] },
    { id: "p9", x: 262, y: 238, w: 196, h: 124, num: "8 ", title: "Render", icon: "fe:file-text", sub: ["txt · srt · vtt · json"] },
    { id: "p10", x: 24, y: 238, w: 196, h: 124, num: "9 ", title: "Save", icon: "si:Postgresql", sub: ["history row; a DB", "outage is logged and", "never fails the run"], kind: "terminal" },
    { id: "q1", x: 24, y: 410, w: 274, icon: "fe:alert-triangle", title: "Fails loudly", sub: ["one failed chunk fails the run;", "never silently missing text"] },
    { id: "q2", x: 318, y: 410, w: 274, icon: "fe:trash-2", title: "No leftovers", sub: ["ffmpeg temp files removed in", "finally, on success or failure"] },
    { id: "q3", x: 612, y: 410, w: 274, icon: "fe:copy", title: "Same text everywhere", sub: ["CLI and desktop call this same", "engine: identical output"] },
    { id: "q4", x: 906, y: 410, w: 270, icon: "fe:check-circle", accent: true, title: "Measured", sub: ["78-min, 76 MB test file: 7 chunks,", "largest 20.3 MB (cap 25 MB)"] },
  ],
  edges: [
    { from: "p1", fromSide: "right", to: "p2", toSide: "left" },
    { from: "p2", fromSide: "right", to: "p3", toSide: "left" },
    { from: "p3", fromSide: "right", to: "p4", toSide: "left" },
    { from: "p4", fromSide: "right", to: "p5", toSide: "left" },
    { from: "p5", fromSide: "top", to: "p4", toSide: "top", via: [[null, 30], [836, null]], label: "no: shrink the budget and re-split (max 3 tries)", labelAt: [956, 12], style: "dashed" },
    { from: "p5", fromSide: "bottom", to: "p6", toSide: "top", label: "yes", style: "accent" },
    { from: "p6", fromSide: "left", to: "p7", toSide: "right", style: "accent" },
    { from: "p7", fromSide: "left", to: "p8", toSide: "right" },
    { from: "p8", fromSide: "left", to: "p9", toSide: "right" },
    { from: "p9", fromSide: "left", to: "p10", toSide: "right" },
  ],
};

// recording.rs: MIX_TICK 50 ms, wall-clock-driven output (late source padded
// with silence), hound WavWriter 16-bit mono, EVENT_RECORDING_LEVEL per tick,
// AUDIBLE_LEVEL 0.003162 (-50 dBFS) for auto-stop, DEFAULT_OUTPUT_POLL 1 s,
// SOURCE_SILENCE_WARN_AFTER 10 s, set_recording_source opens the new stream
// before dropping the old one.
const recording = {
  name: "recording",
  width: 1200,
  height: 560,
  nodes: [
    { id: "r-mic", x: 110, y: 96, icon: "fe:mic", title: "Microphone", sub: ["cpal input stream"] },
    { id: "r-sys", x: 110, y: 300, icon: "fe:volume-2", title: "System audio", sub: ["WASAPI loopback (Windows)", "Core Audio tap (macOS 14.6+)"] },
    { id: "r-mix", x: 420, y: 198, icon: "fe:sliders", accent: true, title: "Mixer thread", sub: ["50 ms tick, wall-clock driven", "a late device is padded with", "silence, so sources never drift"] },
    { id: "r-wav", x: 690, y: 198, icon: "fe:hard-drive", title: "WAV on disk", sub: ["hound · 16-bit mono", "streamed, never held in RAM", "length bound only by disk"] },
    { id: "r-q", x: 900, y: 198, icon: "fe:list", title: "Queue", sub: ["same path as", "a picked file"] },
    { id: "r-tr", x: 1090, y: 198, icon: "fe:trash-2", title: "Auto-trash", sub: ["after a successful", "transcription", "(OS trash, on by default)"] },
    { id: "r-lvl", x: 420, y: 448, icon: "si:React", title: "Live level meter", sub: ["canvas + requestAnimationFrame", "dBFS scale, no React re-render"] },
  ],
  lists: [
    { id: "r-watch", x: 612, y: 330, w: 564, cols: 2, title: "The mixer also watches for", items: [
      { icon: "fe:moon", title: "Long silence", sub: "optional auto-stop after 5–60 min below −50 dBFS" },
      { icon: "fe:alert-triangle", title: "Silent system audio", sub: "warns live after 10 s of zero signal" },
      { icon: "fe:refresh-cw", title: "Default output changed", sub: "reopens the loopback stream (1 s poll)" },
      { icon: "fe:shuffle", title: "Source changed mid-recording", sub: "opens the new stream first, same file" },
    ] },
  ],
  edges: [
    { from: "r-mic", fromSide: "right", to: "r-mix", toSide: "left", toOff: -10 },
    { from: "r-sys", fromSide: "right", to: "r-mix", toSide: "left", toOff: 10 },
    { from: "r-mix", fromSide: "right", to: "r-wav", toSide: "left", style: "accent" },
    { from: "r-wav", fromSide: "right", to: "r-q", toSide: "left", label: "on stop" },
    { from: "r-q", fromSide: "right", to: "r-tr", toSide: "left" },
    { from: "r-mix", fromSide: "bottom", to: "r-lvl", toSide: "top", label: "emit(): one level value per tick\nraw audio never reaches the webview", labelAt: [420, 352], style: "dashed" },
  ],
};

const stack = {
  name: "stack",
  width: 1200,
  height: 566,
  rows: [
    { x: 24, y: 24, w: 1152, title: "Desktop UI", sub: "webview, untrusted", items: [
      { icon: "si:React", title: "React 19", sub: "UI" },
      { icon: "si:Typescript", title: "TypeScript", sub: "UI · engine · CLI" },
      { icon: "si:Vite", title: "Vite", sub: "dev server · build" },
      { icon: "fe:droplet", title: "Design tokens", sub: "light / dark themes" },
      { icon: "fe:globe", title: "i18n", sub: "ja / en, live switch" },
    ] },
    { x: 24, y: 132, w: 1152, title: "Native shell", sub: "Rust, privileged", items: [
      { icon: "si:Tauri", title: "Tauri 2", sub: "IPC · capabilities" },
      { icon: "si:Rust", title: "Rust", sub: "commands · config" },
      { icon: "fe:mic", title: "cpal", sub: "mic + loopback capture" },
      { icon: "fe:hard-drive", title: "hound", sub: "WAV writer" },
      { icon: "fe:trash-2", title: "trash", sub: "OS trash, restorable" },
    ] },
    { x: 24, y: 240, w: 1152, title: "Engine & CLI", sub: "Node.js, shared", items: [
      { icon: "si:Nodedotjs", title: "Node.js 24", sub: "runtime" },
      { icon: "si:Ffmpeg", title: "ffmpeg", sub: "normalize · split" },
      { icon: "fe:cloud", title: "Groq Whisper", sub: "speech-to-text API" },
      { icon: "si:Esbuild", title: "esbuild + pkg", sub: "single-binary sidecar" },
    ] },
    { x: 24, y: 348, w: 1152, title: "Data", sub: "self-hosted", items: [
      { icon: "si:Postgresql", title: "PostgreSQL", sub: "history · notes" },
      { icon: "si:Drizzle", title: "Drizzle ORM", sub: "schema · migrations" },
      { icon: "si:Docker", title: "Docker", sub: "compose" },
      { icon: "si:Ubuntu", title: "Ubuntu", sub: "home server" },
      { icon: "si:Tailscale", title: "Tailscale", sub: "private network" },
    ] },
    { x: 24, y: 456, w: 1152, title: "Quality & delivery", sub: "checked by machine", items: [
      { icon: "si:Vitest", title: "Vitest", sub: "unit · component" },
      { icon: "si:Eslint", title: "ESLint", sub: "+ no-emoji / no-hex rules" },
      { icon: "si:Rust", title: "cargo test", sub: "+ clippy" },
      { icon: "si:Githubactions", title: "GitHub Actions", sub: "3-OS release" },
      { icon: "si:Pnpm", title: "pnpm", sub: "workspace monorepo" },
    ] },
  ],
};

export const diagrams = [architecture, pipeline, recording, stack];

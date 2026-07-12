// Typed wrappers over the two commands the Rust shell exposes
// (apps/desktop/src-tauri/src/commands.rs). This is the ONLY file that may
// call Tauri's invoke() -- it never touches secrets, fs, or the network
// itself; both underlying commands proxy to the Node sidecar
// (packages/core/src/sidecar.ts). Keep the JSON shape here in sync with the
// Rust structs by hand (no codegen wired up) -- see
// .claude/skills/tauri-command-scaffold/SKILL.md.
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
// Import from the "./types" subpath, not the package root -- the root
// barrel (src/index.ts) re-exports groq.ts, which apps/desktop's tsconfig
// (lib: DOM+node, unlike packages/core's node-only lib) transitively
// typechecks under DOM's stricter Blob/BlobPart generics and fails on.
// types.ts has no runtime code and no Blob usage, so this subpath avoids
// that entirely while still importing the real, shared type (not a
// hand-duplicated copy that could drift).
import type { OutputFormat } from "@voice-transcript/core/types";

export function ping(): Promise<string> {
  return invoke("ping");
}

export interface TranscribeRequest {
  filePath: string;
  model: string;
  language?: string;
  format: OutputFormat;
}

export interface TranscribeResponse {
  text: string;
  rendered: string;
  language?: string;
  duration?: number;
}

export function transcribe(request: TranscribeRequest): Promise<TranscribeResponse> {
  return invoke("transcribe", { request });
}

// F17 (gui-queue): native OS file picker via @tauri-apps/plugin-dialog.
// Unlike ping/transcribe, this does NOT go through a Rust #[tauri::command]
// -- it only returns paths the user explicitly picked through a native
// dialog, so it doesn't cross the same trust boundary ffmpeg/Groq/DB access
// does (see apps/desktop/src-tauri/capabilities/default.json's
// dialog:allow-open grant). Returns [] if the user cancels.
export async function pickFiles(): Promise<string[]> {
  const result = await open({
    multiple: true,
    filters: [
      { name: "Audio", extensions: ["m4a", "mp3", "wav", "flac", "ogg", "aac", "wma"] },
    ],
  });
  if (result === null) return [];
  return Array.isArray(result) ? result : [result];
}

// F18 (gui-history). Mirrors packages/core/src/db/history.ts's HistoryRecord
// by hand (same manual-sync convention as TranscribeResponse above) --
// startedAt arrives as an ISO string (JSON has no Date type), parsed to a
// real Date here so callers don't each repeat `new Date(...)`.
export interface HistoryEntry {
  id: number;
  sourceFileName: string;
  startedAt: Date;
  model: string;
  language?: string;
  formats: string[];
  status: "success" | "failed";
  transcriptText?: string;
}

interface HistoryEntryDto {
  id: number;
  sourceFileName: string;
  startedAt: string;
  model: string;
  language: string | null;
  formats: string[];
  status: "success" | "failed";
  transcriptText: string | null;
}

function fromDto(dto: HistoryEntryDto): HistoryEntry {
  return {
    id: dto.id,
    sourceFileName: dto.sourceFileName,
    startedAt: new Date(dto.startedAt),
    model: dto.model,
    language: dto.language ?? undefined,
    formats: dto.formats,
    status: dto.status,
    transcriptText: dto.transcriptText ?? undefined,
  };
}

// No standalone getHistory(id): the list response already includes
// transcriptText, so "opening" an entry in the UI expands already-fetched
// data rather than issuing a new fetch (see commands.rs's comment on why
// there's no get_history command).
export async function listHistory(): Promise<HistoryEntry[]> {
  const rows = await invoke<HistoryEntryDto[]>("list_history");
  return rows.map(fromDto);
}

export interface TrashResult {
  trashed: boolean;
}

// ACCEPTANCE G7: trash the source audio, keep the history record.
export function trashAudio(id: number): Promise<TrashResult> {
  return invoke("trash_audio", { id });
}

// ACCEPTANCE G9: delete the history record (and trash the audio if it's
// still there).
export function deleteHistoryEntry(id: number): Promise<TrashResult> {
  return invoke("delete_history_entry", { id });
}

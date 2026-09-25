// Typed wrappers over the two commands the Rust shell exposes
// (apps/desktop/src-tauri/src/commands.rs). This is the ONLY file that may
// call Tauri's invoke() -- it never touches secrets, fs, or the network
// itself; both underlying commands proxy to the Node sidecar
// (packages/core/src/sidecar.ts). Keep the JSON shape here in sync with the
// Rust structs by hand (no codegen wired up) -- see
// .claude/skills/tauri-command-scaffold/SKILL.md.
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
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
  // The new transcriptions.id -- absent whenever no history row was
  // written (no database connection configured, or the write itself
  // failed). Transcript notes (below) need it to attach a note to a Queue
  // item, not only to a row already listed in History.
  id?: number;
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
  // How many transcript notes point at this row -- from listHistory's own
  // leftJoin+count (db/history.ts), not a separate fetch. See
  // useTranscriptNotes' knownNoteCount for why this matters: it lets a row
  // with zero notes (the common case) skip its own list_notes call
  // entirely instead of every rendered row spawning a sidecar subprocess
  // just to learn it has nothing.
  noteCount: number;
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
  noteCount: number;
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
    noteCount: dto.noteCount,
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

// Search (SPEC.md > Search): title, transcript body, and note text at
// once, space-separated terms ANDed together -- queries the whole table
// via the sidecar (db/history.ts's searchHistory), not just whatever
// listHistory() already has loaded, so it reaches history past that
// call's own limit and reaches note text at all (notes aren't bulk-loaded
// client-side, see useTranscriptNotes' knownNoteCount).
export interface HistorySearchResult {
  id: number;
  sourceFileName: string;
  startedAt: Date;
  transcriptText: string | null;
  matchedNotes: { quotedText: string; note: string }[];
}

interface HistorySearchResultDto {
  id: number;
  sourceFileName: string;
  startedAt: string;
  transcriptText: string | null;
  matchedNotes: { quotedText: string; note: string }[];
}

export async function searchHistory(query: string): Promise<HistorySearchResult[]> {
  const rows = await invoke<HistorySearchResultDto[]>("search_history", { query });
  return rows.map((dto) => ({ ...dto, startedAt: new Date(dto.startedAt) }));
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

// F21 (native-menu): the Export menu item. pickSavePath() is the same
// class of grant as pickFiles() above (dialog:allow-save, not
// dialog:allow-open) -- it only returns a path the user interactively
// chose via a native dialog, it doesn't write anything itself.
// export_transcript() then does the actual write, given that path.
export async function pickSavePath(defaultFileName: string): Promise<string | null> {
  return save({ defaultPath: defaultFileName });
}

export function exportTranscript(path: string, content: string): Promise<void> {
  return invoke("export_transcript", { path, content });
}

// F21 (native-menu, Preferences). ACCEPTANCE G11: saveApiKey() sends a key
// to Rust to persist; there is deliberately no getApiKey() -- only a
// boolean status, so the webview can never read the secret back out once
// saved.
export function saveApiKey(key: string): Promise<void> {
  return invoke("save_api_key", { key });
}

export function getApiKeyStatus(): Promise<boolean> {
  return invoke("get_api_key_status");
}

// Same write-only pattern as saveApiKey/getApiKeyStatus above -- a Postgres
// connection string embeds a password, so it gets identical treatment:
// never read back, only a boolean "is one saved" status.
export function saveDatabaseUrl(url: string): Promise<void> {
  return invoke("save_database_url", { url });
}

export function getDatabaseUrlStatus(): Promise<boolean> {
  return invoke("get_database_url_status");
}

// gui-i18n: keeps the native OS menu bar's labels in sync with the
// webview's own language setting (menu.rs's build() takes the same "en"/
// "ja" values as I18nContext's Lang type). Called from I18nContext on every
// language change, including once on mount to sync a persisted preference
// -- see menu.rs's set_menu_language doc comment for the cold-start caveat.
export function setMenuLanguage(lang: string): Promise<void> {
  return invoke("set_menu_language", { lang });
}

// Sidebar polish (2026-07-19): History row's "Copy transcript" button. Goes
// through @tauri-apps/plugin-clipboard-manager rather than plain
// navigator.clipboard.writeText -- the plugin is the reliable path across
// all three target platforms inside a WRY webview (capabilities/default.json
// grants clipboard-manager:allow-write-text only, no read grant).
export function copyToClipboard(text: string): Promise<void> {
  return writeText(text);
}

// Custom dictionary (word replacement). Mirrors HistoryEntry's manual DTO
// mapping pattern above -- createdAt/updatedAt arrive as ISO strings.
export interface DictionaryEntryRecord {
  id: number;
  word: string;
  replacement: string;
  createdAt: Date;
  updatedAt: Date;
}

interface DictionaryEntryDto {
  id: number;
  word: string;
  replacement: string;
  createdAt: string;
  updatedAt: string;
}

function fromDictionaryDto(dto: DictionaryEntryDto): DictionaryEntryRecord {
  return { ...dto, createdAt: new Date(dto.createdAt), updatedAt: new Date(dto.updatedAt) };
}

export async function listDictionary(): Promise<DictionaryEntryRecord[]> {
  const rows = await invoke<DictionaryEntryDto[]>("list_dictionary");
  return rows.map(fromDictionaryDto);
}

export async function addDictionaryEntry(word: string, replacement: string): Promise<DictionaryEntryRecord> {
  const row = await invoke<DictionaryEntryDto>("add_dictionary_entry", { request: { word, replacement } });
  return fromDictionaryDto(row);
}

export async function updateDictionaryEntry(
  id: number,
  word: string,
  replacement: string,
): Promise<DictionaryEntryRecord> {
  const row = await invoke<DictionaryEntryDto>("update_dictionary_entry", { request: { id, word, replacement } });
  return fromDictionaryDto(row);
}

export function deleteDictionaryEntry(id: number): Promise<void> {
  return invoke("delete_dictionary_entry", { id });
}

export interface DictionaryImportResult {
  inserted: number;
  updated: number;
  skipped: number;
}

// Takes no path argument by design (tauri-capability-reviewer finding): the
// native file-picker dialog is driven entirely inside the Rust command
// (commands.rs's import_dictionary_file), not by the webview, so there is no
// IPC-reachable way to ask Rust to read an arbitrary local file. Resolves to
// null if the user cancels the dialog.
export function importDictionaryFile(): Promise<DictionaryImportResult | null> {
  return invoke("import_dictionary_file");
}

// Transcript notes (annotations). A note anchors to a [startOffset,
// endOffset) character range of one transcription's transcriptText -- the
// body text itself is never edited, only the note. Mirrors
// DictionaryEntryRecord's manual DTO mapping pattern above (createdAt/
// updatedAt arrive as ISO strings).
export interface TranscriptNote {
  id: number;
  transcriptionId: number;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  note: string;
  createdAt: Date;
  updatedAt: Date;
}

interface NoteDto {
  id: number;
  transcriptionId: number;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

function fromNoteDto(dto: NoteDto): TranscriptNote {
  return { ...dto, createdAt: new Date(dto.createdAt), updatedAt: new Date(dto.updatedAt) };
}

export async function listNotes(transcriptionId: number): Promise<TranscriptNote[]> {
  const rows = await invoke<NoteDto[]>("list_notes", { transcriptionId });
  return rows.map(fromNoteDto);
}

export async function addNote(
  transcriptionId: number,
  startOffset: number,
  endOffset: number,
  quotedText: string,
  note: string,
): Promise<TranscriptNote> {
  const row = await invoke<NoteDto>("add_note", {
    request: { transcriptionId, startOffset, endOffset, quotedText, note },
  });
  return fromNoteDto(row);
}

export async function updateNote(id: number, note: string): Promise<TranscriptNote> {
  const row = await invoke<NoteDto>("update_note", { request: { id, note } });
  return fromNoteDto(row);
}

export function deleteNote(id: number): Promise<void> {
  return invoke("delete_note", { id });
}

// Audio recording (SPEC.md > Audio recording). All capture happens in Rust
// (recording.rs, cpal -> hound WAV) -- the webview only ever sends the
// chosen source and device ids and receives a finished file's path/duration;
// no audio bytes cross this boundary.
export interface InputDevice {
  id: string;
  name: string;
}

// "system" and "both" capture the output device (WASAPI loopback on Windows,
// a Core Audio process tap on macOS 14.6+). Linux has neither, and
// list_output_devices returns an empty list there.
export type AudioSource = "microphone" | "system" | "both";

export function listInputDevices(): Promise<InputDevice[]> {
  return invoke("list_input_devices");
}

export function listOutputDevices(): Promise<InputDevice[]> {
  return invoke("list_output_devices");
}

export interface StartRecordingOptions {
  source: AudioSource;
  deviceId?: string;
  outputDeviceId?: string;
}

export function startRecording(options: StartRecordingOptions): Promise<void> {
  return invoke("start_recording", {
    source: options.source,
    deviceId: options.deviceId ?? null,
    outputDeviceId: options.outputDeviceId ?? null,
  });
}

export interface RecordingResult {
  path: string;
  durationSeconds: number;
  // Requested sources that produced nothing but digital silence -- the only
  // way to notice a silently-denied macOS system-audio permission (see
  // recording.rs's RecordingOutcome).
  silentSources: string[];
}

export function stopRecording(): Promise<RecordingResult> {
  return invoke("stop_recording");
}

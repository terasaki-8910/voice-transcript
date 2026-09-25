// F15 (desktop-ipc): the only two commands the webview can reach. Both
// proxy to the Node sidecar (packages/core/src/sidecar.ts) -- neither the
// webview nor this file itself touches ffmpeg, the Groq API, or the DB
// directly. GROQ_API_KEY / DATABASE_URL live in the sidecar's own process
// environment and are never passed as a command argument or returned in a
// response (see .claude/agents/tauri-capability-reviewer.md).
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

// camelCase: the webview passes `{ filePath, model, language, format }`
// (JS convention); serde maps that onto these snake_case Rust fields.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeRequest {
    pub file_path: String,
    pub model: String,
    pub language: Option<String>,
    pub format: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscribeResponse {
    pub text: String,
    pub rendered: String,
    pub language: Option<String>,
    pub duration: Option<f64>,
    // The new transcriptions.id (transcript notes anchor to it) -- absent
    // whenever the sidecar didn't write a history row (no DATABASE_URL, or
    // the write itself failed; see sidecar.ts's TranscribeResponse comment).
    pub id: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct SidecarEnvelope<T> {
    ok: bool,
    data: Option<T>,
    error: Option<String>,
}

/// Runs the sidecar with `[command, argJson]` and decodes its one-line JSON
/// envelope. A transport failure (nonzero exit, unparsable stdout) and a
/// domain failure (`{ ok: false, error }`) are both surfaced as `Err`, but
/// kept distinguishable in the message so a caller/log can tell them apart.
/// Always injects db_env (below) -- every command that reaches the
/// sidecar's DB layer needs it, not just the history-specific ones, since
/// transcribe writes a history record too.
async fn call_sidecar<T: for<'de> Deserialize<'de>>(
    app: &tauri::AppHandle,
    command: &str,
    arg_json: &str,
) -> Result<T, String> {
    call_sidecar_with_env(app, command, arg_json, db_env(app)).await
}

/// Same as `call_sidecar`, but can inject extra environment variables into
/// the spawned sidecar process (used by `transcribe`, to additionally pass
/// along the locally-configured API key -- see its call site). This sets
/// the variables on the CHILD PROCESS's environment, the same place
/// GROQ_API_KEY/DATABASE_URL already live when they come from the shell --
/// never as a command-line argument, which would be visible to other
/// processes on the machine via a process listing.
async fn call_sidecar_with_env<T: for<'de> Deserialize<'de>>(
    app: &tauri::AppHandle,
    command: &str,
    arg_json: &str,
    extra_env: Vec<(&str, String)>,
) -> Result<T, String> {
    let mut sidecar_command = app
        .shell()
        .sidecar("core-sidecar")
        .map_err(|e| format!("sidecar not found: {e}"))?
        .arg(command)
        .arg(arg_json);

    for (key, value) in extra_env {
        sidecar_command = sidecar_command.env(key, value);
    }

    let output = sidecar_command
        .output()
        .await
        .map_err(|e| format!("failed to spawn sidecar: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("sidecar exited with {:?}: {stderr}", output.status));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let envelope: SidecarEnvelope<T> = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("sidecar returned invalid JSON: {e} (stdout: {stdout})"))?;

    if envelope.ok {
        envelope.data.ok_or_else(|| "sidecar reported ok with no data".to_string())
    } else {
        Err(envelope.error.unwrap_or_else(|| "unknown sidecar error".to_string()))
    }
}

/// DATABASE_URL from the environment always wins; the locally-saved
/// Preferences URL (config.rs) is only a fallback used when the environment
/// doesn't already provide one -- same precedence rule as GROQ_API_KEY
/// (ACCEPTANCE G11).
fn db_url_fallback(app: &tauri::AppHandle) -> Option<(&'static str, String)> {
    if std::env::var("DATABASE_URL").is_err() {
        crate::config::read_database_url(app).map(|url| ("DATABASE_URL", url))
    } else {
        None
    }
}

/// Points the sidecar at the bundled copy of packages/core/src/db/migrations/
/// (tauri.conf.json's bundle.resources, populated by
/// packages/core/scripts/build-sidecar.mjs) so it can auto-create its
/// schema on a fresh database -- see packages/core/src/db/migrate.ts's
/// comment on why the pkg-compiled sidecar can't resolve that folder as a
/// real on-disk sibling of itself the way the CLI can. Silently omitted
/// (never a hard error) if resource_dir() can't resolve -- the sidecar
/// falls back to its own defaultMigrationsFolder() in that case, which is
/// still correct in any dev context where the sidecar isn't actually
/// bundled.
fn migrations_dir_env(app: &tauri::AppHandle) -> Option<(&'static str, String)> {
    let dir = app.path().resource_dir().ok()?.join("db-migrations");
    Some(("MIGRATIONS_DIR", dir.to_string_lossy().into_owned()))
}

/// The combined DB-related environment for any sidecar call that touches
/// the DB layer (which, per db_url_fallback's own comment, is every call --
/// transcribe included).
fn db_env(app: &tauri::AppHandle) -> Vec<(&'static str, String)> {
    db_url_fallback(app).into_iter().chain(migrations_dir_env(app)).collect()
}

/// A GUI app launched from Finder/Dock/Launchpad does NOT inherit the
/// interactive shell's PATH -- macOS gives it the bare system default
/// (roughly `/usr/bin:/bin:/usr/sbin:/sbin`), which doesn't include
/// Homebrew's `/opt/homebrew/bin` (Apple Silicon) or `/usr/local/bin`
/// (Intel), or any other shell-rc-configured install location (nvm, asdf,
/// MacPorts, ...). `tauri dev` run from a terminal never hits this --
/// terminal-launched processes DO inherit the full shell PATH -- which is
/// exactly why this went unnoticed through this whole project's dev/testing
/// and only surfaced from a real installed .dmg (real user report,
/// 2026-07-13: "ffmpeg was not found on PATH" despite ffmpeg being
/// installed). Fix: resolve the PATH an actual login shell would have, by
/// briefly running one (`-ilc`, interactive+login, so it sources
/// .zshrc/.zprofile/.bash_profile the same way opening Terminal would), and
/// hand that to the sidecar instead of trusting the GUI-launch default.
/// Same technique as the widely-used `fix-path` npm package (Electron
/// ecosystem's standard fix for this exact class of bug). Unix only --
/// Windows GUI apps already inherit the OS-level PATH set via System
/// Properties, not a shell-rc setting, so this doesn't apply there.
#[cfg(unix)]
fn login_shell_path() -> Option<(&'static str, String)> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = std::process::Command::new(shell).args(["-ilc", "echo -n \"$PATH\""]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(("PATH", path))
    }
}

#[cfg(not(unix))]
fn login_shell_path() -> Option<(&'static str, String)> {
    None
}

#[tauri::command]
pub async fn ping(app: tauri::AppHandle) -> Result<String, String> {
    call_sidecar(&app, "ping", "null").await
}

#[tauri::command]
pub async fn transcribe(
    app: tauri::AppHandle,
    request: TranscribeRequest,
) -> Result<TranscribeResponse, String> {
    let arg_json = serde_json::json!({
        "filePath": request.file_path,
        "model": request.model,
        "language": request.language,
        "format": request.format,
    })
    .to_string();

    // ACCEPTANCE G11: GROQ_API_KEY from the environment always wins; the
    // locally-saved Preferences key (config.rs) is only a fallback used
    // when the environment doesn't already provide one. Injected into the
    // spawned sidecar's own process environment, never into arg_json --
    // see call_sidecar_with_env's doc comment on why. DATABASE_URL gets the
    // same treatment (db_url_fallback) since transcribe also writes a
    // history record on completion.
    let key_fallback = if std::env::var("GROQ_API_KEY").is_err() {
        crate::config::read_api_key(&app)
    } else {
        None
    };

    let mut extra_env: Vec<(&str, String)> = key_fallback.map(|k| ("GROQ_API_KEY", k)).into_iter().collect();
    extra_env.extend(db_env(&app));
    // ffmpeg (spawned inside the sidecar) needs a real PATH -- see
    // login_shell_path's doc comment for why a GUI launch doesn't have one.
    extra_env.extend(login_shell_path());

    call_sidecar_with_env(&app, "transcribe", &arg_json, extra_env).await
}

// F18 (gui-history). The sidecar owns all DB access (list/get/delete); this
// file only additionally owns the actual "move to OS trash" step, since
// that's a plain local filesystem operation with no need to round-trip
// through Node. The webview only ever passes a history `id` (never a raw
// path) into trash_audio/delete_history_entry -- the real path always comes
// from a DB-backed sidecar lookup, so the webview can't ask Rust to trash an
// arbitrary file.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecordDto {
    pub id: i64,
    pub source_file_name: String,
    pub started_at: String,
    pub model: String,
    pub language: Option<String>,
    pub formats: Vec<String>,
    pub status: String,
    pub transcript_text: Option<String>,
    pub segments: Option<serde_json::Value>,
    // How many transcript notes point at this row -- a leftJoin+count done
    // alongside listHistory's own query (packages/core/src/db/history.ts),
    // not a separate call, so the webview can decide whether a row has
    // notes worth fetching without spawning a sidecar subprocess per row
    // (see useTranscriptNotes' knownNoteCount on the webview side).
    pub note_count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryFileRef {
    source_file_name: String,
}

#[derive(Debug, Serialize)]
pub struct TrashResult {
    pub trashed: bool,
}

/// Moves `path` to the OS trash/recycle bin if it still exists on disk.
/// Never a permanent delete (ACCEPTANCE G7/G9); a missing file, or one the
/// OS refuses to trash, is reported as `trashed: false`, not an error --
/// the caller's own DB-level result (list refresh / entry-deleted) is still
/// valid either way.
fn trash_if_exists(path: &str) -> bool {
    if !std::path::Path::new(path).exists() {
        return false;
    }
    trash::delete(path).is_ok()
}

#[tauri::command]
pub async fn list_history(app: tauri::AppHandle) -> Result<Vec<HistoryRecordDto>, String> {
    call_sidecar(&app, "list-history", "null").await
}

// No standalone get_history command: list_history's rows already include
// transcriptText, so "opening" an entry in the UI is just expanding
// already-fetched data, not a new fetch. The sidecar's "get-history" action
// still exists and is used internally by trash_audio/delete_history_entry
// below (to look up a single record's path), just not exposed to the
// webview as its own command.

/// ACCEPTANCE G7: trash the source audio, keep the history record.
#[tauri::command]
pub async fn trash_audio(app: tauri::AppHandle, id: i64) -> Result<TrashResult, String> {
    let arg_json = serde_json::json!({ "id": id }).to_string();
    let record: HistoryFileRef = call_sidecar(&app, "get-history", &arg_json).await?;
    Ok(TrashResult { trashed: trash_if_exists(&record.source_file_name) })
}

/// ACCEPTANCE G9: delete the history record entirely, and also trash the
/// source audio if it still exists on disk.
#[tauri::command]
pub async fn delete_history_entry(app: tauri::AppHandle, id: i64) -> Result<TrashResult, String> {
    let arg_json = serde_json::json!({ "id": id }).to_string();
    let record: HistoryFileRef = call_sidecar(&app, "delete-history-entry", &arg_json).await?;
    Ok(TrashResult { trashed: trash_if_exists(&record.source_file_name) })
}

// F21 (native-menu): the Export menu item. Unlike trash_audio/
// delete_history_entry, `path` here is genuinely arbitrary -- but it comes
// from a native OS save dialog the user interactively drove
// (@tauri-apps/plugin-dialog's save(), same class of grant as F17's
// pickFiles/open()), not a path the webview invents on its own. `content`
// is just rendered transcript text, never a secret.
#[tauri::command]
pub fn export_transcript(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("failed to write export file: {e}"))
}

// Custom dictionary (word replacement). Four of these five proxy the
// sidecar 1:1, same pattern as the history commands above; import_dictionary_file
// (below) additionally drives the native file dialog itself -- see its own
// comment for why. No new capability grant needed for any of them: these are
// app-defined commands like ping/transcribe, not a plugin ACL surface.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryRecordDto {
    pub id: i64,
    pub word: String,
    pub replacement: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryEntryRequest {
    pub word: String,
    pub replacement: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDictionaryEntryRequest {
    pub id: i64,
    pub word: String,
    pub replacement: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResultDto {
    pub inserted: i64,
    pub updated: i64,
    pub skipped: i64,
}

#[tauri::command]
pub async fn list_dictionary(app: tauri::AppHandle) -> Result<Vec<DictionaryRecordDto>, String> {
    call_sidecar(&app, "list-dictionary", "null").await
}

#[tauri::command]
pub async fn add_dictionary_entry(
    app: tauri::AppHandle,
    request: DictionaryEntryRequest,
) -> Result<DictionaryRecordDto, String> {
    let arg_json = serde_json::json!({ "word": request.word, "replacement": request.replacement }).to_string();
    call_sidecar(&app, "add-dictionary-entry", &arg_json).await
}

#[tauri::command]
pub async fn update_dictionary_entry(
    app: tauri::AppHandle,
    request: UpdateDictionaryEntryRequest,
) -> Result<DictionaryRecordDto, String> {
    let arg_json = serde_json::json!({
        "id": request.id,
        "word": request.word,
        "replacement": request.replacement,
    })
    .to_string();
    call_sidecar(&app, "update-dictionary-entry", &arg_json).await
}

#[derive(Debug, Deserialize)]
struct DeletedDictionaryEntry {
    #[allow(dead_code)]
    id: i64,
}

#[tauri::command]
pub async fn delete_dictionary_entry(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let arg_json = serde_json::json!({ "id": id }).to_string();
    let _: DeletedDictionaryEntry = call_sidecar(&app, "delete-dictionary-entry", &arg_json).await?;
    Ok(())
}

// SECURITY: deliberately takes NO path argument. An earlier version of this
// command accepted `path: String` from the webview on the assumption that
// only DictionarySection.tsx's picker would ever call it -- that is a UI
// convention, not an IPC-enforced boundary: any script running in the
// webview can invoke() a registered command with arbitrary arguments
// (Tauri's capability system gates plugin permissions, not app-defined
// command parameters), so a `path: String` parameter here would let
// malicious JS read arbitrary local files, including this app's own
// plaintext-secret config files (config.rs -- the API key / DATABASE_URL
// live at a well-known OS path derived from this app's public bundle
// identifier). Fixed (found by tauri-capability-reviewer) by doing the pick
// and the read as one atomic Rust-side operation: the native file dialog is
// invoked here, not the webview, so the only path this command ever reads
// is one the user just interactively chose through a real OS picker.
// Returns Ok(None) if the user cancels the dialog (not an error).
#[tauri::command]
pub async fn import_dictionary_file(app: tauri::AppHandle) -> Result<Option<ImportResultDto>, String> {
    let Some(file_path) = app.dialog().file().add_filter("JSON", &["json"]).blocking_pick_file() else {
        return Ok(None);
    };
    let path = file_path.into_path().map_err(|e| format!("invalid file path: {e}"))?;
    let contents = std::fs::read_to_string(&path).map_err(|e| format!("failed to read import file: {e}"))?;
    let arg_json = serde_json::json!({ "json": contents }).to_string();
    let result: ImportResultDto = call_sidecar(&app, "import-dictionary", &arg_json).await?;
    Ok(Some(result))
}

// Transcript notes (annotations) -- sidecar 1:1, same proxy pattern as the
// dictionary commands above. The webview only ever passes a
// transcriptionId it already got back from `transcribe`'s own response or
// from list_history/HistoryEntry.id -- never a raw one it invents, but
// nothing here needs to enforce that: a note pointing at someone else's
// transcriptionId is meaningless, not a privilege escalation (SQLite/
// Postgres just returns [] for it), same trust level as e.g.
// delete_history_entry's id argument.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRecordDto {
    pub id: i64,
    pub transcription_id: i64,
    pub start_offset: i64,
    pub end_offset: i64,
    pub quoted_text: String,
    pub note: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddNoteRequest {
    pub transcription_id: i64,
    pub start_offset: i64,
    pub end_offset: i64,
    pub quoted_text: String,
    pub note: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNoteRequest {
    pub id: i64,
    pub note: String,
}

#[tauri::command]
pub async fn list_notes(app: tauri::AppHandle, transcription_id: i64) -> Result<Vec<NoteRecordDto>, String> {
    let arg_json = serde_json::json!({ "transcriptionId": transcription_id }).to_string();
    call_sidecar(&app, "list-notes", &arg_json).await
}

#[tauri::command]
pub async fn add_note(app: tauri::AppHandle, request: AddNoteRequest) -> Result<NoteRecordDto, String> {
    let arg_json = serde_json::json!({
        "transcriptionId": request.transcription_id,
        "startOffset": request.start_offset,
        "endOffset": request.end_offset,
        "quotedText": request.quoted_text,
        "note": request.note,
    })
    .to_string();
    call_sidecar(&app, "add-note", &arg_json).await
}

#[tauri::command]
pub async fn update_note(app: tauri::AppHandle, request: UpdateNoteRequest) -> Result<NoteRecordDto, String> {
    let arg_json = serde_json::json!({ "id": request.id, "note": request.note }).to_string();
    call_sidecar(&app, "update-note", &arg_json).await
}

#[derive(Debug, Deserialize)]
struct DeletedNote {
    #[allow(dead_code)]
    id: i64,
}

#[tauri::command]
pub async fn delete_note(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let arg_json = serde_json::json!({ "id": id }).to_string();
    let _: DeletedNote = call_sidecar(&app, "delete-note", &arg_json).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Regression test for a real bug reported from an installed .dmg,
    // 2026-07-13: ffmpeg was on PATH for every terminal-launched `tauri dev`
    // session this whole project was tested with, but not for a real
    // Finder/Dock launch, which doesn't inherit the shell's PATH -- so this
    // never surfaced until a real user tried the actual installer. Runs in
    // whatever PATH `cargo test` itself has (a full terminal PATH, same
    // limitation as `tauri dev`), so it can't reproduce the GUI-launch
    // failure directly, but it does directly exercise the real
    // login_shell_path() used in production and confirms the mechanism
    // that fixes it actually resolves a real, usable PATH -- not a stub.
    #[cfg(unix)]
    #[test]
    fn login_shell_path_resolves_a_real_usable_path() {
        let (key, path) = login_shell_path().expect("login_shell_path should resolve on a dev machine");
        assert_eq!(key, "PATH");
        assert!(!path.trim().is_empty());
        let found = path.split(':').any(|dir| std::path::Path::new(dir).join("ffmpeg").exists());
        assert!(found, "resolved PATH should contain a directory with an ffmpeg binary: {path}");
    }

    // Regression test for a real bug caught in pre-merge review: the
    // sidecar (packages/core/src/sidecar.ts) always emits camelCase JSON
    // keys (e.g. `sourceFileName`), so any struct decoding its output
    // needs `#[serde(rename_all = "camelCase")]` -- without it, every
    // trash_audio/delete_history_entry call failed to parse the sidecar's
    // response, and for delete_history_entry specifically, the DB row was
    // already deleted by the time that parse failure surfaced.
    #[test]
    fn history_file_ref_decodes_camel_case_sidecar_json() {
        let json = r#"{"sourceFileName":"/audio/a.m4a"}"#;
        let parsed: HistoryFileRef = serde_json::from_str(json).expect("must decode camelCase sourceFileName");
        assert_eq!(parsed.source_file_name, "/audio/a.m4a");
    }

    #[test]
    fn history_record_dto_decodes_camel_case_sidecar_json() {
        let json = r#"{
            "id": 1,
            "sourceFileName": "/audio/a.m4a",
            "startedAt": "2026-07-13T00:00:00.000Z",
            "model": "whisper-large-v3-turbo",
            "language": null,
            "formats": ["txt"],
            "status": "success",
            "transcriptText": "hello",
            "segments": null,
            "noteCount": 2
        }"#;
        let parsed: HistoryRecordDto = serde_json::from_str(json).expect("must decode camelCase history record");
        assert_eq!(parsed.source_file_name, "/audio/a.m4a");
        assert_eq!(parsed.transcript_text.as_deref(), Some("hello"));
        assert_eq!(parsed.note_count, 2);
    }

    // Same regression class as the two tests above, for the note commands
    // added alongside transcript notes.
    #[test]
    fn note_record_dto_decodes_camel_case_sidecar_json() {
        let json = r#"{
            "id": 1,
            "transcriptionId": 10,
            "startOffset": 4,
            "endOffset": 11,
            "quotedText": "2GOMCP",
            "note": "正しくはTogoMCP",
            "createdAt": "2026-09-25T00:00:00.000Z",
            "updatedAt": "2026-09-25T00:00:00.000Z"
        }"#;
        let parsed: NoteRecordDto = serde_json::from_str(json).expect("must decode camelCase note record");
        assert_eq!(parsed.transcription_id, 10);
        assert_eq!(parsed.start_offset, 4);
        assert_eq!(parsed.end_offset, 11);
        assert_eq!(parsed.quoted_text, "2GOMCP");
    }

    #[test]
    fn transcribe_response_decodes_camel_case_sidecar_json_including_the_new_id_field() {
        let json = r#"{"text":"hi","rendered":"hi","language":null,"duration":null,"id":10}"#;
        let parsed: TranscribeResponse = serde_json::from_str(json).expect("must decode camelCase transcribe response");
        assert_eq!(parsed.id, Some(10));
    }

    #[test]
    fn transcribe_response_id_is_optional_when_the_sidecar_omits_it() {
        // Whenever recordHistory writes nothing (no DATABASE_URL, or the
        // write itself failed) sidecar.ts's TranscribeResponse simply omits
        // `id` -- this must decode to None, not a parse error.
        let json = r#"{"text":"hi","rendered":"hi","language":null,"duration":null}"#;
        let parsed: TranscribeResponse = serde_json::from_str(json).expect("id must be optional");
        assert_eq!(parsed.id, None);
    }
}

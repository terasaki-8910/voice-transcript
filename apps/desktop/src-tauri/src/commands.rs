// F15 (desktop-ipc): the only two commands the webview can reach. Both
// proxy to the Node sidecar (packages/core/src/sidecar.ts) -- neither the
// webview nor this file itself touches ffmpeg, the Groq API, or the DB
// directly. GROQ_API_KEY / DATABASE_URL live in the sidecar's own process
// environment and are never passed as a command argument or returned in a
// response (see .claude/agents/tauri-capability-reviewer.md).
use serde::{Deserialize, Serialize};
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
async fn call_sidecar<T: for<'de> Deserialize<'de>>(
    app: &tauri::AppHandle,
    command: &str,
    arg_json: &str,
) -> Result<T, String> {
    let sidecar_command = app
        .shell()
        .sidecar("core-sidecar")
        .map_err(|e| format!("sidecar not found: {e}"))?
        .arg(command)
        .arg(arg_json);

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
    call_sidecar(&app, "transcribe", &arg_json).await
}

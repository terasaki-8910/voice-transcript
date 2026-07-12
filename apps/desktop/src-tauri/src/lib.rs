// F14 (tauri-scaffold): the shell itself, no commands registered yet.
// F15 (desktop-ipc) adds the Node sidecar that runs @voice-transcript/core
// and the narrow #[tauri::command]s the webview calls through
// apps/desktop/src/lib/tauri.ts -- see SPEC.md > Architecture (monorepo).
// The webview never gets fs/network/DB access directly; every privileged
// operation is added here or in the sidecar, never in apps/desktop/src/**.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

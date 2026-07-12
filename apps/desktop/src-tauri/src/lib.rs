// F15 (desktop-ipc): registers the two commands the webview can reach
// (commands.rs), both of which proxy to the Node sidecar
// (packages/core/src/sidecar.ts) via tauri-plugin-shell. The webview never
// gets fs/network/DB access directly; every privileged operation lives here
// or in the sidecar, never in apps/desktop/src/**.
//
// F17 (gui-queue) adds tauri-plugin-dialog, called directly from the
// webview via @tauri-apps/plugin-dialog's open() -- this is the one
// exception to "webview never touches a privileged API directly": the
// dialog plugin only returns the paths of files the USER explicitly picked
// through a native OS picker, it can't read arbitrary files, so it doesn't
// cross the same trust boundary ffmpeg/Groq/DB access does.
//
// F18 (gui-history) adds list_history/trash_audio/delete_history_entry. The
// webview only ever passes a history `id`; the actual file path always
// comes from a DB-backed sidecar lookup inside commands.rs, never from the
// webview directly, so no new capability grant is needed for these (same as
// ping/transcribe: app-defined commands, not a plugin's ACL surface). The
// `trash` crate call happens here in Rust, not in the sidecar, since it's a
// plain local filesystem operation with no need to round-trip through Node.
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::transcribe,
            commands::list_history,
            commands::trash_audio,
            commands::delete_history_entry,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

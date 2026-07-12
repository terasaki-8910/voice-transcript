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
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![commands::ping, commands::transcribe])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// F15 (desktop-ipc): registers the two commands the webview can reach
// (commands.rs), both of which proxy to the Node sidecar
// (packages/core/src/sidecar.ts) via tauri-plugin-shell. The webview never
// gets fs/network/DB access directly; every privileged operation lives here
// or in the sidecar, never in apps/desktop/src/**.
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![commands::ping, commands::transcribe])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

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
//
// F21 (native-menu) adds the real OS menu (menu.rs) and Preferences
// (config.rs, ACCEPTANCE G11). save_api_key/get_api_key_status/
// export_transcript are app-defined commands like the ones above -- no new
// capabilities.json entry. tauri-plugin-opener is added only for View on
// GitHub (opens a URL with the OS default handler); it's invoked from
// Rust's own menu event handler, not from the webview, so it doesn't need
// a webview-facing capability grant either.
mod commands;
mod config;
mod menu;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .menu(|app| menu::build(app, "en"))
        .on_menu_event(menu::handle_event)
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::transcribe,
            commands::list_history,
            commands::trash_audio,
            commands::delete_history_entry,
            commands::export_transcript,
            config::save_api_key,
            config::get_api_key_status,
            config::save_database_url,
            config::get_database_url_status,
            menu::set_menu_language,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

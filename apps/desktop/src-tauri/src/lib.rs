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
//
// Sidebar polish (2026-07-19) adds tauri-plugin-clipboard-manager for the
// History row's "Copy transcript" button -- plain navigator.clipboard isn't
// reliable across all three target platforms inside WRY, so this uses the
// official plugin instead. Write-only grant (clipboard-manager:allow-write-text
// in capabilities/default.json) -- the app never reads the system clipboard.
//
// Custom dictionary (word replacement) adds list_dictionary/
// add_dictionary_entry/update_dictionary_entry/delete_dictionary_entry
// (proxy the sidecar, same pattern as the history commands) plus
// import_dictionary_file, which drives the native file dialog itself from
// inside the command (tauri_plugin_dialog's blocking_pick_file(), not a
// path argument the webview could supply -- an earlier version took
// `path: String` from the webview, which tauri-capability-reviewer flagged
// as an arbitrary-local-file-read primitive reachable by any webview script,
// not just the intended picker UI; see commands.rs's comment on the fix)
// and forwards the picked file's contents to the sidecar for parsing -- no
// new capability grant needed (dialog:allow-open already covers this).
//
// Microphone recording adds recording.rs (cpal capture -> hound WAV,
// entirely in Rust -- no raw audio bytes cross the webview/IPC boundary
// during capture) with start_recording/stop_recording/list_input_devices.
// Chosen over webview getUserMedia because WebKitGTK (Linux) has no
// released Tauri version that enables media-stream capture (see
// design/notes on this decision) -- cpal is the one implementation that is
// uniformly correct on macOS/Windows/Linux. No new capability grant: these
// are app-defined commands, not a plugin ACL surface. A live level meter
// (2026-09-30) pushes one derived loudness float per 50ms mixer tick via
// the EVENT_RECORDING_LEVEL app.emit() -- still no raw audio, no new
// command or capability grant either (event listen/unlisten is already
// covered by core:default).
// Transcript notes (annotations) adds list_notes/add_note/update_note/
// delete_note -- same sidecar-proxy pattern as the dictionary commands
// above, no new capability grant needed. transcribe's response also grows
// an optional `id` (the new transcriptions.id) so the GUI can attach a note
// to a just-finished transcription in the Queue, not only to a row already
// listed in History.
//
// Search adds search_history -- title, transcript body, and note text at
// once, space-separated terms ANDed together. Same proxy pattern, no new
// capability grant; the actual query lives entirely in the sidecar/DB
// layer (packages/core/src/db/history.ts's searchHistory).
mod commands;
mod config;
mod menu;
mod recording;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(recording::RecordingManager::new())
        .menu(|app| menu::build(app, "en"))
        .on_menu_event(menu::handle_event)
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::transcribe,
            commands::list_history,
            commands::search_history,
            commands::trash_audio,
            commands::delete_history_entry,
            commands::update_history_title,
            commands::export_transcript,
            config::save_api_key,
            config::get_api_key_status,
            config::save_database_url,
            config::get_database_url_status,
            commands::test_database_connection,
            menu::set_menu_language,
            commands::list_dictionary,
            commands::add_dictionary_entry,
            commands::update_dictionary_entry,
            commands::delete_dictionary_entry,
            commands::import_dictionary_file,
            commands::list_notes,
            commands::add_note,
            commands::update_note,
            commands::delete_note,
            recording::list_input_devices,
            recording::list_output_devices,
            recording::start_recording,
            recording::stop_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

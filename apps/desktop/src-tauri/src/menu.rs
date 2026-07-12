// F21 (native-menu). ACCEPTANCE G8/G10: real OS-level menu items (macOS
// global menu bar / Windows app menu), not just in-webview controls.
// Add files/Open history/Export/Preferences all just emit a webview event
// by id -- the actual behavior (opening the file picker, switching tabs,
// picking a save path, showing the Preferences view) lives entirely in the
// webview, which already owns that state. This file's only privileged
// action is View on GitHub (opens a URL via tauri-plugin-opener).
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Runtime};
use tauri_plugin_opener::OpenerExt;

// The project's own configured git remote (github.com/terasaki-8910/voice-transcript),
// not a placeholder -- ACCEPTANCE G8's "View on GitHub" opens this repo.
const REPO_URL: &str = "https://github.com/terasaki-8910/voice-transcript";
const EVENT_VIEW_ON_GITHUB: &str = "menu-view-on-github";

pub const EVENT_ADD_FILES: &str = "menu-add-files";
pub const EVENT_OPEN_HISTORY: &str = "menu-open-history";
pub const EVENT_EXPORT: &str = "menu-export";
pub const EVENT_PREFERENCES: &str = "menu-preferences";

pub fn build<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let add_files = MenuItem::with_id(app, EVENT_ADD_FILES, "Add files...", true, Some("CmdOrCtrl+O"))?;
    let open_history = MenuItem::with_id(app, EVENT_OPEN_HISTORY, "Open history", true, None::<&str>)?;
    let export = MenuItem::with_id(app, EVENT_EXPORT, "Export...", true, None::<&str>)?;
    let preferences = MenuItem::with_id(app, EVENT_PREFERENCES, "Preferences...", true, Some("CmdOrCtrl+,"))?;
    let view_on_github = MenuItem::with_id(app, EVENT_VIEW_ON_GITHUB, "View on GitHub", true, None::<&str>)?;

    let pkg_info = app.package_info();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        ..Default::default()
    };

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view_menu = Submenu::with_items(app, "View", true, &[&open_history])?;

    let window_menu = Submenu::with_id_and_items(
        app,
        "window-menu",
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    // macOS: "Preferences..." conventionally lives in the app-name menu
    // (with About/Services/Hide/Quit), not File; File/Help don't get a
    // separate Quit/About since the app menu already has them.
    #[cfg(target_os = "macos")]
    {
        let app_menu = Submenu::with_items(
            app,
            pkg_info.name.clone(),
            true,
            &[
                &PredefinedMenuItem::about(app, None, Some(about_metadata))?,
                &PredefinedMenuItem::separator(app)?,
                &preferences,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?;
        let file_menu = Submenu::with_items(app, "File", true, &[&add_files, &export, &PredefinedMenuItem::close_window(app, None)?])?;
        let help_menu = Submenu::with_items(app, "Help", true, &[&view_on_github])?;
        Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
    }

    // Windows/Linux: no separate app-name menu, so File carries
    // Preferences/Quit and Help carries About, matching the platform's own
    // default() composition (see tauri::menu::Menu::default).
    #[cfg(not(target_os = "macos"))]
    {
        let file_menu = Submenu::with_items(
            app,
            "File",
            true,
            &[
                &add_files,
                &export,
                &PredefinedMenuItem::separator(app)?,
                &preferences,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::close_window(app, None)?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?;
        let help_menu = Submenu::with_items(
            app,
            "Help",
            true,
            &[&view_on_github, &PredefinedMenuItem::about(app, None, Some(about_metadata))?],
        )?;
        Menu::with_items(app, &[&file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
    }
}

pub fn handle_event<R: Runtime>(app: &tauri::AppHandle<R>, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        EVENT_ADD_FILES => {
            let _ = app.emit(EVENT_ADD_FILES, ());
        }
        EVENT_OPEN_HISTORY => {
            let _ = app.emit(EVENT_OPEN_HISTORY, ());
        }
        EVENT_EXPORT => {
            let _ = app.emit(EVENT_EXPORT, ());
        }
        EVENT_PREFERENCES => {
            let _ = app.emit(EVENT_PREFERENCES, ());
        }
        EVENT_VIEW_ON_GITHUB => {
            let _ = app.opener().open_url(REPO_URL, None::<&str>);
        }
        _ => {}
    }
}

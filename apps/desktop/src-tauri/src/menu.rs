// F21 (native-menu). ACCEPTANCE G8/G10: real OS-level menu items (macOS
// global menu bar / Windows app menu), not just in-webview controls.
// Add files/Open history/Export/Preferences all just emit a webview event
// by id -- the actual behavior (opening the file picker, switching tabs,
// picking a save path, showing the Preferences view) lives entirely in the
// webview, which already owns that state. This file's only privileged
// action is View on GitHub (opens a URL via tauri-plugin-opener).
//
// Menu labels follow the app's own language setting (gui-i18n), not just
// the OS locale -- the webview calls set_menu_language() (below) whenever
// its language changes (I18nContext.tsx), including once on startup to
// sync a persisted preference, since this menu is first built with a fixed
// "en" default in lib.rs before the webview has loaded at all. English
// keeps using each PredefinedMenuItem's OS-native default text (None) --
// zero behavior change from before this file supported Japanese. Labels
// are hand-kept in sync with apps/desktop/src/i18n/translations.ts (same
// manual-sync convention as the DTOs in commands.rs), not shared code,
// since one is Rust/muda and the other is a TS object literal.
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

fn is_ja(lang: &str) -> bool {
    lang == "ja"
}

/// Picks the label for lang. Returns an owned String since MenuItem/Submenu
/// builders accept any `impl AsRef<str>` fine, and the ja strings for
/// quit/about/hide below need to be built at runtime (they embed the app
/// name), so both branches stay the same type.
fn label(lang: &str, en: &str, ja: &str) -> String {
    if is_ja(lang) { ja.to_string() } else { en.to_string() }
}

/// Only overrides a PredefinedMenuItem's text for Japanese; English passes
/// None straight through so it keeps using the OS's own localized default,
/// exactly as before this file supported more than one language.
fn predefined_text(lang: &str, ja: &str) -> Option<String> {
    if is_ja(lang) { Some(ja.to_string()) } else { None }
}

pub fn build<R: Runtime>(app: &tauri::AppHandle<R>, lang: &str) -> tauri::Result<Menu<R>> {
    let add_files = MenuItem::with_id(
        app,
        EVENT_ADD_FILES,
        label(lang, "Add files...", "ファイルを追加..."),
        true,
        Some("CmdOrCtrl+O"),
    )?;
    let open_history = MenuItem::with_id(
        app,
        EVENT_OPEN_HISTORY,
        label(lang, "Open history", "履歴を開く"),
        true,
        None::<&str>,
    )?;
    let export = MenuItem::with_id(app, EVENT_EXPORT, label(lang, "Export...", "エクスポート..."), true, None::<&str>)?;
    let preferences = MenuItem::with_id(
        app,
        EVENT_PREFERENCES,
        label(lang, "Preferences...", "環境設定..."),
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let view_on_github = MenuItem::with_id(
        app,
        EVENT_VIEW_ON_GITHUB,
        label(lang, "View on GitHub", "GitHubで見る"),
        true,
        None::<&str>,
    )?;

    let pkg_info = app.package_info();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        ..Default::default()
    };

    let edit_menu = Submenu::with_items(
        app,
        label(lang, "Edit", "編集"),
        true,
        &[
            &PredefinedMenuItem::undo(app, predefined_text(lang, "取り消す").as_deref())?,
            &PredefinedMenuItem::redo(app, predefined_text(lang, "やり直す").as_deref())?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, predefined_text(lang, "カット").as_deref())?,
            &PredefinedMenuItem::copy(app, predefined_text(lang, "コピー").as_deref())?,
            &PredefinedMenuItem::paste(app, predefined_text(lang, "ペースト").as_deref())?,
            &PredefinedMenuItem::select_all(app, predefined_text(lang, "すべてを選択").as_deref())?,
        ],
    )?;

    let view_menu = Submenu::with_items(app, label(lang, "View", "表示"), true, &[&open_history])?;

    let window_menu = Submenu::with_id_and_items(
        app,
        "window-menu",
        label(lang, "Window", "ウインドウ"),
        true,
        &[
            &PredefinedMenuItem::minimize(app, predefined_text(lang, "しまう").as_deref())?,
            &PredefinedMenuItem::maximize(app, predefined_text(lang, "拡大/縮小").as_deref())?,
            &PredefinedMenuItem::close_window(app, predefined_text(lang, "ウインドウを閉じる").as_deref())?,
        ],
    )?;

    // macOS: "Preferences..." conventionally lives in the app-name menu
    // (with About/Services/Hide/Quit), not File; File/Help don't get a
    // separate Quit/About since the app menu already has them.
    #[cfg(target_os = "macos")]
    {
        let quit_text = predefined_text(lang, &format!("{}を終了", pkg_info.name.clone()));
        let hide_text = predefined_text(lang, &format!("{}を隠す", pkg_info.name.clone()));
        let about_text = predefined_text(lang, &format!("{}について", pkg_info.name.clone()));

        let app_menu = Submenu::with_items(
            app,
            pkg_info.name.clone(),
            true,
            &[
                &PredefinedMenuItem::about(app, about_text.as_deref(), Some(about_metadata))?,
                &PredefinedMenuItem::separator(app)?,
                &preferences,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, predefined_text(lang, "サービス").as_deref())?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, hide_text.as_deref())?,
                &PredefinedMenuItem::hide_others(app, predefined_text(lang, "ほかを隠す").as_deref())?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, quit_text.as_deref())?,
            ],
        )?;
        let file_menu = Submenu::with_items(
            app,
            label(lang, "File", "ファイル"),
            true,
            &[&add_files, &export, &PredefinedMenuItem::close_window(app, predefined_text(lang, "ウインドウを閉じる").as_deref())?],
        )?;
        let help_menu = Submenu::with_items(app, label(lang, "Help", "ヘルプ"), true, &[&view_on_github])?;
        Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
    }

    // Windows/Linux: no separate app-name menu, so File carries
    // Preferences/Quit and Help carries About, matching the platform's own
    // default() composition (see tauri::menu::Menu::default).
    #[cfg(not(target_os = "macos"))]
    {
        let quit_text = predefined_text(lang, "終了");
        let file_menu = Submenu::with_items(
            app,
            label(lang, "File", "ファイル"),
            true,
            &[
                &add_files,
                &export,
                &PredefinedMenuItem::separator(app)?,
                &preferences,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::close_window(app, predefined_text(lang, "閉じる").as_deref())?,
                &PredefinedMenuItem::quit(app, quit_text.as_deref())?,
            ],
        )?;
        let about_text = predefined_text(lang, &format!("{}について", pkg_info.name.clone()));
        let help_menu = Submenu::with_items(
            app,
            label(lang, "Help", "ヘルプ"),
            true,
            &[&view_on_github, &PredefinedMenuItem::about(app, about_text.as_deref(), Some(about_metadata))?],
        )?;
        Menu::with_items(app, &[&file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
    }
}

/// Rebuilds and swaps in the whole menu tree with new-language labels.
/// Called by the webview (via lib/tauri.ts's setMenuLanguage) whenever its
/// language changes, including once on startup to sync a persisted
/// preference -- this menu was already built with a fixed "en" default in
/// lib.rs before the webview loaded and read localStorage, so a cold start
/// on a Japanese-preference profile briefly shows an English menu until
/// this first sync call lands (a few hundred ms at most, not worth adding
/// IPC-before-window-creation complexity to avoid).
#[tauri::command]
pub fn set_menu_language(app: tauri::AppHandle, lang: String) -> Result<(), String> {
    let menu = build(&app, &lang).map_err(|e| format!("failed to rebuild menu: {e}"))?;
    app.set_menu(menu).map_err(|e| format!("failed to set menu: {e}"))?;
    Ok(())
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

// F21 (native-menu, Preferences). ACCEPTANCE G11: the API key lives in a
// local config file in the OS's per-user app-config directory -- never in
// the git repo, never returned to the webview once saved (only a boolean
// "is it set" status is). This is a deliberate, stated tradeoff (SPEC.md >
// Preferences (API key)): plaintext-on-disk, not encrypted-at-rest like an
// OS keychain entry would be, mitigated by owner-only file permissions and
// living outside the repo. Acceptable for this app's current single-user
// scope.
use tauri::Manager;

fn config_file_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("cannot resolve app config directory: {e}"))?;
    Ok(dir.join("groq_api_key"))
}

fn database_url_file_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("cannot resolve app config directory: {e}"))?;
    Ok(dir.join("database_url"))
}

/// Reads the locally-saved API key, if any. Used only from Rust (to inject
/// into the sidecar's spawned-process environment as a fallback when
/// GROQ_API_KEY isn't already set) -- never exposed back to the webview.
pub fn read_api_key(app: &tauri::AppHandle) -> Option<String> {
    let path = config_file_path(app).ok()?;
    let contents = std::fs::read_to_string(path).ok()?;
    let trimmed = contents.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn validate_key(key: &str) -> Result<&str, String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        Err("API key must not be empty.".to_string())
    } else {
        Ok(trimmed)
    }
}

#[tauri::command]
pub fn save_api_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let trimmed = validate_key(&key)?;
    let path = config_file_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("failed to create config directory: {e}"))?;
    }
    write_owner_only(&path, trimmed)
}

// Opens the file with owner-only permissions from the moment it's created,
// rather than write() then chmod() afterward -- the latter has a brief
// window where the file exists at the default (umask-derived, often
// world-readable) mode before being tightened. Windows has no equivalent
// mode bits in std::fs; ACL hardening there is a documented, accepted gap
// (see the module doc comment) rather than something this function papers
// over.
#[cfg(unix)]
fn write_owner_only(path: &std::path::Path, contents: &str) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| format!("failed to open config file: {e}"))?;
    file.write_all(contents.as_bytes()).map_err(|e| format!("failed to write config file: {e}"))
}

#[cfg(not(unix))]
fn write_owner_only(path: &std::path::Path, contents: &str) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|e| format!("failed to write config file: {e}"))
}

/// Never returns the key itself -- only whether one is currently saved, so
/// the Preferences view can show "API key is set" without the webview ever
/// reading the secret back.
#[tauri::command]
pub fn get_api_key_status(app: tauri::AppHandle) -> bool {
    read_api_key(&app).is_some()
}

// Same pattern and tradeoff as the API key above, for DATABASE_URL: a
// locally-saved connection string in the OS's per-user app-config
// directory, used only as a fallback when the DATABASE_URL environment
// variable isn't already set (see commands.rs's db_url_fallback), never
// returned to the webview -- a Postgres connection string embeds a
// password, so it gets exactly the same write-only treatment as the API
// key, not weaker handling just because it's "a URL, not a secret."
pub fn read_database_url(app: &tauri::AppHandle) -> Option<String> {
    let path = database_url_file_path(app).ok()?;
    let contents = std::fs::read_to_string(path).ok()?;
    let trimmed = contents.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

// Only postgres(ql):// is accepted today -- SPEC.md's stated portability
// goal (a later MySQL move should be a config change, not a rewrite)
// applies to the packages/core data-access layer, not to this input
// validator; this field will need a matching scheme check added if/when
// that support actually lands, not a permissive check speculatively
// widened now for a database this app can't yet talk to.
fn validate_database_url(url: &str) -> Result<&str, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("Database URL must not be empty.".to_string());
    }
    if !(trimmed.starts_with("postgres://") || trimmed.starts_with("postgresql://")) {
        return Err("Database URL must start with postgres:// or postgresql://".to_string());
    }
    Ok(trimmed)
}

#[tauri::command]
pub fn save_database_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let trimmed = validate_database_url(&url)?;
    let path = database_url_file_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("failed to create config directory: {e}"))?;
    }
    write_owner_only(&path, trimmed)
}

/// Never returns the URL itself -- only whether one is currently saved (same
/// reasoning as get_api_key_status).
#[tauri::command]
pub fn get_database_url_status(app: tauri::AppHandle) -> bool {
    read_database_url(&app).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_key_rejects_empty_or_whitespace_only_input() {
        assert!(validate_key("").is_err());
        assert!(validate_key("   ").is_err());
    }

    #[test]
    fn validate_key_trims_and_accepts_a_real_looking_key() {
        assert_eq!(validate_key("  gsk_real_key  ").unwrap(), "gsk_real_key");
    }

    #[test]
    fn validate_database_url_rejects_empty_or_whitespace_only_input() {
        assert!(validate_database_url("").is_err());
        assert!(validate_database_url("   ").is_err());
    }

    #[test]
    fn validate_database_url_rejects_a_non_postgres_scheme() {
        assert!(validate_database_url("mysql://user:pass@host/db").is_err());
    }

    #[test]
    fn validate_database_url_trims_and_accepts_a_real_looking_url() {
        assert_eq!(
            validate_database_url("  postgresql://user:pass@localhost:5432/voice_transcript  ").unwrap(),
            "postgresql://user:pass@localhost:5432/voice_transcript",
        );
    }
}

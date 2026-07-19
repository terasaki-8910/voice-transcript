// F21 (native-menu). ACCEPTANCE G10/G11. Opened via the native menu's
// "Preferences..." item or Cmd+,/Ctrl+, (useMenuEvents.ts), not a
// persistent tab. Deliberately shows only whether a key is currently set
// (getApiKeyStatus), never the key's value -- saveApiKey() is write-only
// from the webview's point of view, so a saved key can never be read back
// out through this UI (see lib/tauri.ts's comment on why).
//
// Light dismiss (2026-07-19, real-usage feedback): clicking the backdrop or
// pressing Escape closes the dialog, same as the explicit "Close" button --
// standard modal/overlay convention (WAI-ARIA calls the underlying pattern
// "light dismissal"). The backdrop click checks e.target === e.currentTarget
// so clicks inside .modal (including on the input fields) don't bubble into
// a false dismiss.
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nContext";
import { saveApiKey, getApiKeyStatus, saveDatabaseUrl, getDatabaseUrlStatus } from "../../lib/tauri";
import "./preferences.css";

type FieldStatus = "checking" | "set" | "unset";
type SaveState = "idle" | "saving" | "error";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function PreferencesView({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [key, setKey] = useState("");
  const [keyStatus, setKeyStatus] = useState<FieldStatus>("checking");
  const [keySaveState, setKeySaveState] = useState<SaveState>("idle");
  const [keyError, setKeyError] = useState<string>();

  const [databaseUrl, setDatabaseUrl] = useState("");
  const [databaseUrlStatus, setDatabaseUrlStatus] = useState<FieldStatus>("checking");
  const [databaseUrlSaveState, setDatabaseUrlSaveState] = useState<SaveState>("idle");
  const [databaseUrlError, setDatabaseUrlError] = useState<string>();

  useEffect(() => {
    getApiKeyStatus()
      .then((isSet) => setKeyStatus(isSet ? "set" : "unset"))
      .catch(() => setKeyStatus("unset"));
    getDatabaseUrlStatus()
      .then((isSet) => setDatabaseUrlStatus(isSet ? "set" : "unset"))
      .catch(() => setDatabaseUrlStatus("unset"));
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSaveKey = async () => {
    setKeySaveState("saving");
    setKeyError(undefined);
    try {
      await saveApiKey(key);
      setKeyStatus("set");
      setKey("");
      setKeySaveState("idle");
    } catch (err) {
      setKeySaveState("error");
      setKeyError(errorMessage(err));
    }
  };

  const handleSaveDatabaseUrl = async () => {
    setDatabaseUrlSaveState("saving");
    setDatabaseUrlError(undefined);
    try {
      await saveDatabaseUrl(databaseUrl);
      setDatabaseUrlStatus("set");
      setDatabaseUrl("");
      setDatabaseUrlSaveState("idle");
    } catch (err) {
      setDatabaseUrlSaveState("error");
      setDatabaseUrlError(errorMessage(err));
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("preferences")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <h2>{t("preferences")}</h2>

        <p className="modal-status">
          {keyStatus === "set" ? t("apiKeySet") : keyStatus === "unset" ? t("apiKeyNotSet") : ""}
        </p>
        <label htmlFor="api-key-input">
          {t("apiKeyLabel")}
          <input
            id="api-key-input"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        {keySaveState === "error" && keyError && <p className="fail-reason">{keyError}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="btn-primary"
            aria-label={t("saveApiKeyAria")}
            disabled={!key.trim() || keySaveState === "saving"}
            onClick={() => void handleSaveKey()}
          >
            {t("save")}
          </button>
        </div>

        <hr className="modal-divider" />

        <p className="modal-status">
          {databaseUrlStatus === "set"
            ? t("databaseUrlSet")
            : databaseUrlStatus === "unset"
              ? t("databaseUrlNotSet")
              : ""}
        </p>
        <label htmlFor="database-url-input">
          {t("databaseUrlLabel")}
          <input
            id="database-url-input"
            type="password"
            autoComplete="off"
            placeholder="user:password@host:5432/voice_transcript"
            value={databaseUrl}
            onChange={(e) => setDatabaseUrl(e.target.value)}
          />
        </label>
        {databaseUrlSaveState === "error" && databaseUrlError && <p className="fail-reason">{databaseUrlError}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-link" onClick={onClose}>
            {t("close")}
          </button>
          <button
            type="button"
            className="btn-primary"
            aria-label={t("saveDatabaseUrlAria")}
            disabled={!databaseUrl.trim() || databaseUrlSaveState === "saving"}
            onClick={() => void handleSaveDatabaseUrl()}
          >
            {t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

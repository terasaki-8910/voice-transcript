// F21 (native-menu). ACCEPTANCE G10/G11. Opened via the native menu's
// "Preferences..." item or Cmd+,/Ctrl+, (useMenuEvents.ts), not a
// persistent tab. Deliberately shows only whether a key is currently set
// (getApiKeyStatus), never the key's value -- saveApiKey() is write-only
// from the webview's point of view, so a saved key can never be read back
// out through this UI (see lib/tauri.ts's comment on why).
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nContext";
import { saveApiKey, getApiKeyStatus } from "../../lib/tauri";
import "./preferences.css";

type KeyStatus = "checking" | "set" | "unset";
type SaveState = "idle" | "saving" | "error";

export function PreferencesView({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<KeyStatus>("checking");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string>();

  useEffect(() => {
    getApiKeyStatus()
      .then((isSet) => setStatus(isSet ? "set" : "unset"))
      .catch(() => setStatus("unset"));
  }, []);

  const handleSave = async () => {
    setSaveState("saving");
    setError(undefined);
    try {
      await saveApiKey(key);
      setStatus("set");
      setKey("");
      setSaveState("idle");
    } catch (err) {
      setSaveState("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t("preferences")}>
      <div className="modal">
        <h2>{t("preferences")}</h2>
        <p className="modal-status">{status === "set" ? t("apiKeySet") : status === "unset" ? t("apiKeyNotSet") : ""}</p>
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
        {saveState === "error" && error && <p className="fail-reason">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-link" onClick={onClose}>
            {t("close")}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!key.trim() || saveState === "saving"}
            onClick={() => void handleSave()}
          >
            {t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

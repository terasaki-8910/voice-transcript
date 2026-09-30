// Settings > Connection. The Groq API key / Postgres database URL fields,
// unchanged from the original single-panel PreferencesView (ACCEPTANCE
// G11) -- only relocated into their own section. Deliberately shows only
// whether a key/URL is currently set (getApiKeyStatus/getDatabaseUrlStatus),
// never the value itself -- saveApiKey/saveDatabaseUrl are write-only from
// the webview's point of view (see lib/tauri.ts's comment on why).
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nContext";
import {
  saveApiKey,
  getApiKeyStatus,
  saveDatabaseUrl,
  getDatabaseUrlStatus,
  testDatabaseConnection,
} from "../../lib/tauri";

type FieldStatus = "checking" | "set" | "unset";
type SaveState = "idle" | "saving" | "error";
// Success flashes and clears itself (matches CopyMenu's "Copied" pattern) --
// re-testing is a deliberate, infrequent click, not something needing a
// lingering confirmation. Failure deliberately does NOT auto-clear: the
// whole point of this button is reading the real error message it surfaces
// (user-reported, 2026-09-30: Tailscale was up, the DB port was open, and
// there was still no way to see WHY the connection itself was failing).
type TestState = "idle" | "testing";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function ConnectionSection() {
  const { t } = useI18n();
  const [key, setKey] = useState("");
  const [keyStatus, setKeyStatus] = useState<FieldStatus>("checking");
  const [keySaveState, setKeySaveState] = useState<SaveState>("idle");
  const [keyError, setKeyError] = useState<string>();

  const [databaseUrl, setDatabaseUrl] = useState("");
  const [databaseUrlStatus, setDatabaseUrlStatus] = useState<FieldStatus>("checking");
  const [databaseUrlSaveState, setDatabaseUrlSaveState] = useState<SaveState>("idle");
  const [databaseUrlError, setDatabaseUrlError] = useState<string>();
  const [testState, setTestState] = useState<TestState>("idle");
  const [testSuccess, setTestSuccess] = useState(false);
  const [testError, setTestError] = useState<string>();

  useEffect(() => {
    getApiKeyStatus()
      .then((isSet) => setKeyStatus(isSet ? "set" : "unset"))
      .catch(() => setKeyStatus("unset"));
    getDatabaseUrlStatus()
      .then((isSet) => setDatabaseUrlStatus(isSet ? "set" : "unset"))
      .catch(() => setDatabaseUrlStatus("unset"));
  }, []);

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

  // Tests whichever database URL is currently active -- the same value
  // every real DB command already uses -- not whatever may or may not be
  // typed into the field above; saving and testing are deliberately
  // separate actions. handleTestConnection() itself never rejects (a
  // connection failure is an ordinary result, not an exception), so the
  // try/catch here is only defense-in-depth for the IPC call itself
  // (e.g. the sidecar binary missing).
  const handleTestConnection = async () => {
    setTestState("testing");
    setTestSuccess(false);
    setTestError(undefined);
    try {
      const result = await testDatabaseConnection();
      if (result.connected) {
        setTestSuccess(true);
        setTimeout(() => setTestSuccess(false), 1500);
      } else {
        setTestError(result.error ?? "Connection failed.");
      }
    } catch (err) {
      setTestError(errorMessage(err));
    } finally {
      setTestState("idle");
    }
  };

  return (
    <div className="settings-section">
      {keyStatus !== "checking" && (
        <p className="modal-status">{keyStatus === "set" ? t("apiKeySet") : t("apiKeyNotSet")}</p>
      )}
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

      {databaseUrlStatus !== "checking" && (
        <p className="modal-status">
          {databaseUrlStatus === "set" ? t("databaseUrlSet") : t("databaseUrlNotSet")}
        </p>
      )}
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
      {testSuccess && <p className="settings-hint">{t("connectionTestSuccess")}</p>}
      {testError && <p className="fail-reason">{testError}</p>}
      <div className="modal-actions">
        <button
          type="button"
          className="btn-link"
          disabled={testState === "testing" || databaseUrlSaveState === "saving"}
          onClick={() => void handleTestConnection()}
        >
          {testState === "testing" ? t("testingConnection") : t("testConnection")}
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
  );
}

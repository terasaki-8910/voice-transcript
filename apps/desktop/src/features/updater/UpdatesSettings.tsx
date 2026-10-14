// Settings > General: the running version and a manual "Check for updates".
// A manual check ignores "Skip this version" -- asking explicitly is the
// way back to a skipped update.
import { useI18n } from "../../i18n/I18nContext";
import { useUpdater } from "./UpdaterContext";
import "./updater.css";

export function UpdatesSettings() {
  const { t } = useI18n();
  const updater = useUpdater();
  const checking = updater.checkStatus === "checking";

  let buttonLabel = t("updateCheckNow");
  if (checking) buttonLabel = t("updateChecking");
  else if (updater.update) buttonLabel = t("updateShow");

  return (
    <div className="updates-settings">
      <div className="updates-settings-row">
        <p className="modal-status">
          {updater.currentVersion ? t("updateCurrentVersion").replace("{version}", updater.currentVersion) : null}
        </p>
        <button
          type="button"
          className="btn-link"
          onClick={updater.update ? updater.openDialog : () => void updater.checkNow()}
          disabled={checking}
        >
          {buttonLabel}
        </button>
      </div>
      {updater.update && (
        <p className="settings-hint" role="status">
          {t("updateAvailableShort").replace("{version}", updater.update.version)}
        </p>
      )}
      {!updater.update && updater.checkStatus === "upToDate" && (
        <p className="settings-hint" role="status">
          {t("updateUpToDate")}
        </p>
      )}
      {updater.checkStatus === "failed" && updater.checkError && (
        <p className="settings-hint fail-reason" role="status">
          {t("updateCheckFailed").replace("{error}", updater.checkError)}
        </p>
      )}
    </div>
  );
}

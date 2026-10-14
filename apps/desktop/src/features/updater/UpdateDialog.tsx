// The "an update is available" prompt (SPEC.md > In-app updates). Three
// answers: install now, later (asks again next launch), or skip this
// version (asks again only once something newer ships).
//
// Installing restarts the app, which would kill a transcription or a
// recording in progress, so "Update now" stays disabled until both are
// idle. Once the download starts the dialog can't be dismissed: the app
// restarts as soon as the install finishes, and leaving the window usable
// in the meantime would let new work start that the restart then cuts off.
import { useEffect } from "react";
import { useI18n } from "../../i18n/I18nContext";
import { useQueue } from "../queue/QueueContext";
import { useRecording } from "../recording/RecordingContext";
import { useUpdater } from "./UpdaterContext";
import "../preferences/preferences.css";
import "./updater.css";

export function UpdateDialog() {
  const { t } = useI18n();
  const updater = useUpdater();
  const queue = useQueue();
  const recording = useRecording();
  const installing = updater.installStatus === "installing";
  const busy =
    recording.status !== "idle" || queue.items.some((item) => item.status === "queued" || item.status === "transcribing");
  const { later } = updater;

  // Window capture phase, so Escape here doesn't also reach
  // PreferencesView's document-level handler when this opened from
  // Settings > General on top of it.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (!installing) later();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [installing, later]);

  const { update } = updater;
  if (!update) return null;

  let statusText: string;
  if (!installing) statusText = busy ? t("updateBusyHint") : t("updateRestartNote");
  else if (updater.percent === null) statusText = t("updateDownloading");
  else if (updater.percent >= 100) statusText = t("updateInstalling");
  else statusText = t("updateDownloadingPercent").replace("{percent}", String(updater.percent));

  return (
    <div
      className="modal-overlay update-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !installing) later();
      }}
    >
      <div className="modal update-modal">
        <h2 id="update-dialog-title">{t("updateAvailableTitle")}</h2>
        <p className="update-versions">
          {t("updateAvailableBody").replace("{version}", update.version).replace("{current}", update.currentVersion)}
        </p>
        <p className="modal-status" role="status">
          {statusText}
        </p>
        {installing && (
          <div
            className="update-progress"
            role="progressbar"
            aria-label={t("updateDownloading")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={updater.percent ?? undefined}
          >
            <div
              className={updater.percent === null ? "update-progress-fill indeterminate" : "update-progress-fill"}
              style={updater.percent === null ? undefined : { width: `${updater.percent}%` }}
            />
          </div>
        )}
        {updater.installStatus === "failed" && updater.installError && (
          <p className="fail-reason update-error">{t("updateInstallFailed").replace("{error}", updater.installError)}</p>
        )}
        <div className="modal-actions update-actions">
          <button type="button" className="btn-link update-skip" onClick={updater.skipVersion} disabled={installing}>
            {t("updateSkipVersion")}
          </button>
          <button type="button" className="btn-link" onClick={later} disabled={installing}>
            {t("updateLater")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void updater.installNow()}
            disabled={installing || busy}
            autoFocus
          >
            {updater.installStatus === "failed" ? t("retry") : t("updateNow")}
          </button>
        </div>
      </div>
    </div>
  );
}

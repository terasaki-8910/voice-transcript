// Matches design/reference-screen.html's queue row style. "View" expands
// the stored transcript inline (no separate history screen yet -- that's
// F18); "Retry" re-queues a failed item. F21: "View" also records this item
// as the current selection, so the native menu's Export item has something
// to act on.
//
// Post-integration fix batch (2026-07-13, user testing feedback): the
// collapse control was a bare "−" character, easy to miss as a close
// affordance -- now reuses the existing "close" translation key. Export is
// now also available directly on the row (previously only reachable via
// the native menu + a prior "View" click), independent of SelectionContext.
import { useState } from "react";
import { FiDownload } from "react-icons/fi";
import { useI18n } from "../../i18n/I18nContext";
import { useQueue } from "./QueueContext";
import type { QueueItem } from "./QueueContext";
import { useSelection } from "../selection/SelectionContext";
import { pickSavePath, exportTranscript } from "../../lib/tauri";

const CHIP_CLASS: Record<QueueItem["status"], string> = {
  queued: "chip chip-queued",
  transcribing: "chip chip-active",
  done: "chip chip-done",
  failed: "chip chip-failed",
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function QueueRow({ item }: { item: QueueItem }) {
  const { t } = useI18n();
  const { retry } = useQueue();
  const { setSelection } = useSelection();
  const [expanded, setExpanded] = useState(false);
  const [exportError, setExportError] = useState<string>();

  const handleView = () => {
    setExpanded((v) => !v);
    if (item.result) {
      setSelection({ fileName: item.fileName, text: item.result.text, format: "txt" });
    }
  };

  // pickSavePath()/exportTranscript() can throw (a denied capability, a
  // closed dialog, an fs error) -- caught so a failure always surfaces
  // instead of becoming a silent unhandled rejection that looks like
  // "nothing happened."
  const handleExport = async () => {
    if (!item.result) return;
    try {
      const path = await pickSavePath(`${item.fileName}.txt`);
      if (!path) return;
      await exportTranscript(path, item.result.text);
      setExportError(undefined);
    } catch (err) {
      setExportError(errorMessage(err));
    }
  };

  const statusLabel: Record<QueueItem["status"], string> = {
    queued: t("statusQueued"),
    transcribing: t("statusTranscribing"),
    done: t("statusDone"),
    failed: t("statusFailed"),
  };

  return (
    <div className={`row${item.status === "queued" ? " is-queued" : ""}`}>
      <div className="row-main">
        <div className="row-top">
          <span className="filename">{item.fileName}</span>
          <span className={CHIP_CLASS[item.status]}>{statusLabel[item.status]}</span>
        </div>
        {item.status === "failed" && item.error && <div className="row-meta fail-reason">{item.error}</div>}
        {exportError && <div className="row-meta fail-reason">{exportError}</div>}
        {item.status === "done" && expanded && item.result && (
          <p
            style={{
              marginTop: "var(--space-2)",
              fontSize: "var(--text-sm)",
              whiteSpace: "pre-wrap",
            }}
          >
            {item.result.text}
          </p>
        )}
      </div>
      {item.status === "done" && (
        <button type="button" className="row-action btn-link" onClick={handleView}>
          {expanded ? t("close") : t("view")}
        </button>
      )}
      {item.status === "done" && (
        <button
          type="button"
          className="row-action icon-btn"
          title={t("export")}
          aria-label={t("export")}
          onClick={() => void handleExport()}
        >
          <FiDownload aria-hidden="true" />
        </button>
      )}
      {item.status === "failed" && (
        <button type="button" className="row-action btn-link" onClick={() => retry(item.id)}>
          {t("retry")}
        </button>
      )}
    </div>
  );
}

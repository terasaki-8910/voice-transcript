// Matches design/reference-screen.html's queue row style. "View" expands
// the stored transcript inline (no separate history screen yet -- that's
// F18); "Retry" re-queues a failed item. F21: "View" also records this item
// as the current selection, so the native menu's Export item has something
// to act on.
import { useState } from "react";
import { useI18n } from "../../i18n/I18nContext";
import { useQueue } from "./QueueContext";
import type { QueueItem } from "./QueueContext";
import { useSelection } from "../selection/SelectionContext";

const CHIP_CLASS: Record<QueueItem["status"], string> = {
  queued: "chip chip-queued",
  transcribing: "chip chip-active",
  done: "chip chip-done",
  failed: "chip chip-failed",
};

export function QueueRow({ item }: { item: QueueItem }) {
  const { t } = useI18n();
  const { retry } = useQueue();
  const { setSelection } = useSelection();
  const [expanded, setExpanded] = useState(false);

  const handleView = () => {
    setExpanded((v) => !v);
    if (item.result) {
      setSelection({ fileName: item.fileName, text: item.result.text, format: "txt" });
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
          {expanded ? "−" : t("view")}
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

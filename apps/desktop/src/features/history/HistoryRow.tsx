// F18 (gui-history). Same row shape as QueueRow (queue/QueueRow.tsx) for
// visual consistency, with two distinct actions instead of one: "Trash
// audio" (G7, keeps the record) and "Delete" (G9, removes the record and
// trashes the audio too if it's still there). F21: "View" also records this
// item as the current selection, so the native menu's Export item has
// something to act on.
import { useState } from "react";
import { useI18n } from "../../i18n/I18nContext";
import { useHistory } from "./HistoryContext";
import type { HistoryEntry } from "../../lib/tauri";
import { useSelection } from "../selection/SelectionContext";

function basename(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

export function HistoryRow({ item, audioTrashed }: { item: HistoryEntry; audioTrashed: boolean }) {
  const { t } = useI18n();
  const { trash, remove, actionErrors } = useHistory();
  const { setSelection } = useSelection();
  const [expanded, setExpanded] = useState(false);
  const actionError = actionErrors.get(item.id);

  const handleView = () => {
    setExpanded((v) => !v);
    if (item.transcriptText) {
      setSelection({ fileName: basename(item.sourceFileName), text: item.transcriptText, format: "txt" });
    }
  };

  return (
    <div className="row">
      <div className="row-main">
        <div className="row-top">
          <span className="filename">{basename(item.sourceFileName)}</span>
          <span className={`chip ${item.status === "success" ? "chip-done" : "chip-failed"}`}>
            {item.status === "success" ? t("statusDone") : t("statusFailed")}
          </span>
        </div>
        <div className="row-meta">{item.startedAt.toLocaleString()}</div>
        {actionError && <div className="row-meta fail-reason">{actionError}</div>}
        {expanded && item.transcriptText && (
          <p
            style={{
              marginTop: "var(--space-2)",
              fontSize: "var(--text-sm)",
              whiteSpace: "pre-wrap",
            }}
          >
            {item.transcriptText}
          </p>
        )}
      </div>
      {item.transcriptText && (
        <button type="button" className="row-action btn-link" onClick={handleView}>
          {expanded ? "−" : t("view")}
        </button>
      )}
      <button
        type="button"
        className="row-action btn-link"
        disabled={audioTrashed}
        onClick={() => void trash(item.id)}
      >
        {audioTrashed ? t("audioTrashed") : t("trashAudio")}
      </button>
      <button type="button" className="row-action btn-link" onClick={() => void remove(item.id)}>
        {t("deleteEntry")}
      </button>
    </div>
  );
}

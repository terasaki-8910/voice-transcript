// F18 (gui-history). Same row shape as QueueRow (queue/QueueRow.tsx) for
// visual consistency, with two distinct actions instead of one: "Trash
// audio" (G7, keeps the record) and "Delete" (G9, removes the record and
// trashes the audio too if it's still there). F21: "View" also records this
// item as the current selection, so the native menu's Export item has
// something to act on.
//
// Post-integration fix batch (2026-07-13, user testing feedback):
// - Both destructive actions now require an OS-native confirm() dialog
//   first -- previously they fired immediately on click.
// - Trash/Delete render as icon buttons (react-icons/fi) instead of plain
//   text links, with Delete in --color-danger (a design token, never a
//   hardcoded hex) since it's the more final of the two actions.
// - Export is now also available directly on the row (previously only
//   reachable via the native menu's Export item + a prior "View" click to
//   set the selection) -- exports this row's own transcript directly,
//   independent of SelectionContext.
import { useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { FiTrash, FiTrash2, FiDownload } from "react-icons/fi";
import { useI18n } from "../../i18n/I18nContext";
import { useHistory } from "./HistoryContext";
import type { HistoryEntry } from "../../lib/tauri";
import { pickSavePath, exportTranscript } from "../../lib/tauri";
import { useSelection } from "../selection/SelectionContext";

function basename(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function HistoryRow({ item, audioTrashed }: { item: HistoryEntry; audioTrashed: boolean }) {
  const { t } = useI18n();
  const { trash, remove, actionErrors, reportActionError } = useHistory();
  const { setSelection } = useSelection();
  const [expanded, setExpanded] = useState(false);
  const actionError = actionErrors.get(item.id);
  const fileName = basename(item.sourceFileName);

  const handleView = () => {
    setExpanded((v) => !v);
    if (item.transcriptText) {
      setSelection({ fileName, text: item.transcriptText, format: "txt" });
    }
  };

  // confirm()/pickSavePath()/exportTranscript() can all throw (a denied
  // capability, a closed dialog on an unexpected monitor/space in a
  // multi-display setup, an fs error) -- every await here is wrapped so a
  // failure always surfaces in the row instead of becoming a silent
  // unhandled rejection that looks like "nothing happened."
  const handleTrash = async () => {
    try {
      const confirmed = await confirm(`${fileName}\n\n${t("confirmTrashAudioBody")}`, {
        title: t("trashAudio"),
        kind: "warning",
      });
      if (!confirmed) return;
      await trash(item.id);
    } catch (err) {
      reportActionError(item.id, errorMessage(err));
    }
  };

  const handleDelete = async () => {
    try {
      const confirmed = await confirm(`${fileName}\n\n${t("confirmDeleteEntryBody")}`, {
        title: t("deleteEntry"),
        kind: "warning",
      });
      if (!confirmed) return;
      await remove(item.id);
    } catch (err) {
      reportActionError(item.id, errorMessage(err));
    }
  };

  const handleExport = async () => {
    if (!item.transcriptText) return;
    try {
      const path = await pickSavePath(`${fileName}.txt`);
      if (!path) return;
      await exportTranscript(path, item.transcriptText);
    } catch (err) {
      reportActionError(item.id, errorMessage(err));
    }
  };

  return (
    <div className="row">
      <div className="row-main">
        <div className="row-top">
          <span className="filename">{fileName}</span>
          <span className={`chip ${item.status === "success" ? "chip-done" : "chip-failed"}`}>
            {item.status === "success" ? t("statusDone") : t("statusFailed")}
          </span>
        </div>
        <div className="row-meta">{item.startedAt.toLocaleString()}</div>
        {actionError && <div className="row-meta fail-reason">{actionError}</div>}
        {expanded && item.transcriptText && <p className="row-preview">{item.transcriptText}</p>}
      </div>
      {item.transcriptText && (
        <button type="button" className="row-action btn-link" onClick={handleView}>
          {expanded ? t("close") : t("view")}
        </button>
      )}
      {item.transcriptText && (
        <button type="button" className="row-action icon-btn" title={t("export")} aria-label={t("export")} onClick={() => void handleExport()}>
          <FiDownload aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        className="row-action icon-btn"
        disabled={audioTrashed}
        title={audioTrashed ? t("audioTrashed") : t("trashAudio")}
        aria-label={audioTrashed ? t("audioTrashed") : t("trashAudio")}
        onClick={() => void handleTrash()}
      >
        <FiTrash aria-hidden="true" />
      </button>
      <button
        type="button"
        className="row-action icon-btn icon-btn-danger"
        title={t("deleteEntry")}
        aria-label={t("deleteEntry")}
        onClick={() => void handleDelete()}
      >
        <FiTrash2 aria-hidden="true" />
      </button>
    </div>
  );
}

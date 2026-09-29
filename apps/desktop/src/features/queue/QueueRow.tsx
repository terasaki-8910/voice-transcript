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
import { FiDownload, FiTrash } from "react-icons/fi";
import { useI18n } from "../../i18n/I18nContext";
import { useQueue } from "./QueueContext";
import type { QueueItem } from "./QueueContext";
import { useSelection } from "../selection/SelectionContext";
import { pickSavePath, exportTranscript, copyToClipboard, addDictionaryEntry } from "../../lib/tauri";
import { useDisplayPreferences } from "../preferences/DisplayPreferencesContext";
import { useTranscriptNotes } from "../notes/useTranscriptNotes";
import { AnnotatedTranscript } from "../notes/AnnotatedTranscript";
import { CopyMenu } from "../notes/CopyMenu";
import { formatWithNotes } from "../notes/notesFormat";

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
  const { retry, remove } = useQueue();
  const { setSelection } = useSelection();
  const { breakAtPeriod } = useDisplayPreferences();
  const [fullText, setFullText] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [exportError, setExportError] = useState<string>();
  // knownNoteCount is always 0, not just "usually" -- item.result.id (when
  // present) is a transcriptions.id that `transcribe` only just inserted,
  // so it provably has no notes yet from any earlier session. This also
  // means a queue item never spawns a list_notes sidecar call at all.
  const {
    notes,
    failures: noteFailures,
    add: addNote,
    update: updateNote,
    remove: removeNote,
    retry: retryNote,
    discard: discardNote,
  } = useTranscriptNotes(item.result?.id, 0);

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

  // Both rethrow after reporting (not just catch-and-report) -- CopyMenu
  // awaits these itself to decide whether to flash its "copied" checkmark,
  // so a failure has to actually reject, not resolve silently.
  const handleCopy = async () => {
    if (!item.result) return;
    try {
      await copyToClipboard(item.result.text);
    } catch (err) {
      setExportError(errorMessage(err));
      throw err;
    }
  };

  const handleCopyWithNotes = async () => {
    if (!item.result) return;
    try {
      await copyToClipboard(formatWithNotes(item.result.text, notes, t("notesFooterHeading")));
    } catch (err) {
      setExportError(errorMessage(err));
      throw err;
    }
  };

  const handleLinkToDictionary = async (word: string, replacement: string) => {
    await addDictionaryEntry(word, replacement);
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
          <>
            <AnnotatedTranscript
              text={item.result.text}
              notes={notes}
              noteFailures={noteFailures}
              breakAtPeriod={breakAtPeriod}
              className={`row-preview${fullText ? " row-preview-full" : ""}`}
              onAddNote={addNote}
              onUpdateNote={updateNote}
              onDeleteNote={removeNote}
              onRetryNote={retryNote}
              onDiscardNote={discardNote}
              onLinkToDictionary={handleLinkToDictionary}
            />
            <button
              type="button"
              className="btn-link row-preview-toggle"
              onClick={() => setFullText((v) => !v)}
            >
              {fullText ? t("showLess") : t("showFullText")}
            </button>
          </>
        )}
      </div>
      {item.status === "done" && (
        <button type="button" className="row-action btn-link" onClick={handleView}>
          {expanded ? t("close") : t("view")}
        </button>
      )}
      {item.status === "done" && (
        <CopyMenu
          hasNotes={notes.length > 0}
          onCopy={handleCopy}
          onCopyWithNotes={handleCopyWithNotes}
          copyLabel={t("copyTranscript")}
          copyWithNotesLabel={t("copyWithNotes")}
          copiedLabel={t("copied")}
        />
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
      {(item.status === "done" || item.status === "failed") && (
        <button
          type="button"
          className="row-action icon-btn"
          title={t("removeFromQueue")}
          aria-label={t("removeFromQueue")}
          onClick={() => remove(item.id)}
        >
          <FiTrash aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// F18 (gui-history). Same row shape as QueueRow (queue/QueueRow.tsx) for
// visual consistency, with two distinct destructive actions: "Trash audio"
// (G7, keeps the record) and "Delete" (G9, removes the record and trashes
// the audio too if it's still there). F21: "View" also records this item as
// the current selection, so the native menu's Export item has something to
// act on.
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
//
// Sidebar follow-up (2026-07-19): "expanded" is no longer a local useState --
// it's derived from HistoryNavContext's currentId, so the sidebar's
// back/forward buttons can drive which row is open from outside this
// component (see HistoryNavContext.tsx for the stack semantics).
//
// Sidebar polish (2026-07-19, real-usage feedback -- the two separate
// destructive icons read as confusing): Trash/Delete are now ONE icon
// button (DeleteMenu, below) that opens a small 2-item menu -- the
// underlying handleTrash/handleDelete and their confirm() dialogs are
// unchanged, only the entry point moved. The slot this frees up gets a new
// Copy-transcript button.
import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { FiTrash, FiTrash2, FiDownload, FiEdit2, FiCheck } from "react-icons/fi";
import { useI18n } from "../../i18n/I18nContext";
import { useHistory } from "./HistoryContext";
import { useHistoryNav } from "./HistoryNavContext";
import type { HistoryEntry } from "../../lib/tauri";
import { pickSavePath, exportTranscript, copyToClipboard, addDictionaryEntry } from "../../lib/tauri";
import { basename } from "../../lib/path";
import { useSelection } from "../selection/SelectionContext";
import { useDisplayPreferences } from "../preferences/DisplayPreferencesContext";
import { useDismissOnOutsideClick } from "../../lib/useDismiss";
import { isImeComposing } from "../../lib/ime";
import { useTranscriptNotes } from "../notes/useTranscriptNotes";
import { AnnotatedTranscript } from "../notes/AnnotatedTranscript";
import { CopyMenu } from "../notes/CopyMenu";
import { formatWithNotes } from "../notes/notesFormat";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Local to this file -- nothing else needs a generic menu widget yet, so
// this isn't pulled out into a shared component. WAI-ARIA "menu button"
// pattern: aria-haspopup/aria-expanded on the trigger, role="menu"/
// role="menuitem" on the panel. Closes on: selecting an item, clicking
// outside, or Escape (which also returns focus to the trigger). Tab-order
// reachability via the two buttons' natural tab stops covers the WCAG
// floor -- full roving-tabindex arrow-key navigation is deliberately not
// built for a two-item menu.
function DeleteMenu({
  audioTrashed,
  onTrash,
  onDelete,
  triggerLabel,
  trashLabel,
  deleteLabel,
}: {
  audioTrashed: boolean;
  onTrash: () => void;
  onDelete: () => void;
  triggerLabel: string;
  trashLabel: string;
  deleteLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useDismissOnOutsideClick(
    open,
    () => {
      setOpen(false);
      triggerRef.current?.focus();
    },
    anchorRef,
  );

  return (
    <div className="row-action menu-anchor" ref={anchorRef}>
      <button
        type="button"
        ref={triggerRef}
        className="icon-btn icon-btn-danger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <FiTrash2 aria-hidden="true" />
      </button>
      {open && (
        <div className="menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={audioTrashed}
            onClick={() => {
              setOpen(false);
              onTrash();
            }}
          >
            <FiTrash aria-hidden="true" />
            <span>{trashLabel}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item menu-item-danger"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <FiTrash2 aria-hidden="true" />
            <span>{deleteLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function HistoryRow({ item, audioTrashed }: { item: HistoryEntry; audioTrashed: boolean }) {
  const { t } = useI18n();
  const { trash, remove, rename, actionErrors, reportActionError } = useHistory();
  const { setSelection } = useSelection();
  const { currentId, view, close } = useHistoryNav();
  const { breakAtPeriod } = useDisplayPreferences();
  const [fullText, setFullText] = useState(false);
  const expanded = currentId === item.id;
  const actionError = actionErrors.get(item.id);
  const fileName = basename(item.sourceFileName);
  // A custom title (set via the rename pencil below) takes over the
  // display everywhere a name is shown -- including as the suggested
  // export filename and in the trash/delete confirm dialogs -- renaming
  // never touches sourceFileName itself, which stays the real path
  // trash_audio/delete_history_entry look up by (see HistoryEntry's own
  // comment on why).
  const displayName = item.title ?? fileName;
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const {
    notes,
    failures: noteFailures,
    add: addNote,
    update: updateNote,
    remove: removeNote,
    retry: retryNote,
    discard: discardNote,
  } = useTranscriptNotes(item.id, item.noteCount);

  const handleView = () => {
    if (expanded) {
      close();
      return;
    }
    view(item.id);
    if (item.transcriptText) {
      setSelection({ fileName: displayName, text: item.transcriptText, format: "txt" });
    }
  };

  // confirm()/pickSavePath()/exportTranscript()/copyToClipboard() can all
  // throw (a denied capability, a closed dialog on an unexpected monitor/
  // space in a multi-display setup, an fs error) -- every await here is
  // wrapped so a failure always surfaces in the row instead of becoming a
  // silent unhandled rejection that looks like "nothing happened."
  const handleTrash = async () => {
    try {
      const confirmed = await confirm(`${displayName}\n\n${t("confirmTrashAudioBody")}`, {
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
      const confirmed = await confirm(`${displayName}\n\n${t("confirmDeleteEntryBody")}`, {
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
      const path = await pickSavePath(`${displayName}.txt`);
      if (!path) return;
      await exportTranscript(path, item.transcriptText);
    } catch (err) {
      reportActionError(item.id, errorMessage(err));
    }
  };

  const startRename = () => {
    setTitleDraft(displayName);
    setRenaming(true);
  };

  const handleSaveRename = async () => {
    if (renameSaving) return;
    setRenameSaving(true);
    const ok = await rename(item.id, titleDraft);
    setRenameSaving(false);
    if (ok) setRenaming(false);
  };

  const handleRenameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(e.nativeEvent)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSaveRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setRenaming(false);
    }
  };

  // Both rethrow after reporting (not just catch-and-report) -- CopyMenu
  // awaits these itself to decide whether to flash its "copied" checkmark,
  // so a failure has to actually reject, not resolve silently.
  const handleCopy = async () => {
    if (!item.transcriptText) return;
    try {
      await copyToClipboard(item.transcriptText);
    } catch (err) {
      reportActionError(item.id, errorMessage(err));
      throw err;
    }
  };

  const handleCopyWithNotes = async () => {
    if (!item.transcriptText) return;
    try {
      await copyToClipboard(formatWithNotes(item.transcriptText, notes, t("notesFooterHeading")));
    } catch (err) {
      reportActionError(item.id, errorMessage(err));
      throw err;
    }
  };

  const handleLinkToDictionary = async (word: string, replacement: string) => {
    await addDictionaryEntry(word, replacement);
  };

  return (
    <div className="row">
      <div className="row-main">
        <div className="row-top">
          {renaming ? (
            <input
              className="filename-input"
              autoFocus
              aria-label={t("renameAria")}
              value={titleDraft}
              disabled={renameSaving}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={handleRenameKeyDown}
            />
          ) : (
            <span className="filename">{displayName}</span>
          )}
          <span className={`chip ${item.status === "success" ? "chip-done" : "chip-failed"}`}>
            {item.status === "success" ? t("statusDone") : t("statusFailed")}
          </span>
          <button
            type="button"
            className="icon-btn row-rename-btn"
            aria-label={renaming ? t("save") : t("renameAria")}
            title={renaming ? t("save") : t("renameAria")}
            disabled={renameSaving}
            onClick={renaming ? () => void handleSaveRename() : startRename}
          >
            {renaming ? <FiCheck aria-hidden="true" /> : <FiEdit2 aria-hidden="true" />}
          </button>
        </div>
        <div className="row-meta">{item.startedAt.toLocaleString()}</div>
        {actionError && <div className="row-meta fail-reason">{actionError}</div>}
        {expanded && item.transcriptText && (
          <>
            <AnnotatedTranscript
              text={item.transcriptText}
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
      {item.transcriptText && (
        <button type="button" className="row-action btn-link" onClick={handleView}>
          {expanded ? t("close") : t("view")}
        </button>
      )}
      {item.transcriptText && (
        <CopyMenu
          hasNotes={notes.length > 0}
          onCopy={handleCopy}
          onCopyWithNotes={handleCopyWithNotes}
          copyLabel={t("copyTranscript")}
          copyWithNotesLabel={t("copyWithNotes")}
          copiedLabel={t("copied")}
        />
      )}
      {item.transcriptText && (
        <button type="button" className="row-action icon-btn" title={t("export")} aria-label={t("export")} onClick={() => void handleExport()}>
          <FiDownload aria-hidden="true" />
        </button>
      )}
      <DeleteMenu
        audioTrashed={audioTrashed}
        onTrash={() => void handleTrash()}
        onDelete={() => void handleDelete()}
        triggerLabel={t("deleteEntry")}
        trashLabel={audioTrashed ? t("audioTrashed") : t("trashAudio")}
        deleteLabel={t("deleteEntry")}
      />
    </div>
  );
}

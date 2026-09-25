// Transcript notes (SPEC.md > Transcript notes). Renders one transcript's
// body with its notes highlighted, and owns the two popovers that create/
// view/edit/delete a note -- HistoryRow and QueueRow each own a
// useTranscriptNotes() instance and pass its state/actions in here as
// props, so this component itself never touches Tauri IPC directly (easy
// to test with plain mock callbacks, and the parent row's copy button can
// read the same `notes` array without a second fetch).
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../../i18n/I18nContext";
import { renderAnnotatedText, getSelectionOffsets } from "./textOffsets";
import { useDismissOnOutsideClick } from "../../lib/useDismiss";
import type { TranscriptNote } from "../../lib/tauri";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface PendingSelection {
  start: number;
  end: number;
  quotedText: string;
  rect: DOMRect;
}

interface OpenNote {
  note: TranscriptNote;
  rect: DOMRect;
}

// Keeps a fixed-position popover on screen regardless of where in the
// (possibly clipped/scrolling) row-preview its anchor rect sits -- see
// queue.css's .row-preview max-height/overflow, which a popover nested
// inside would otherwise be clipped by.
function popoverStyle(rect: DOMRect): React.CSSProperties {
  return { position: "fixed", top: rect.bottom + 6, left: Math.max(8, rect.left) };
}

export interface AnnotatedTranscriptProps {
  text: string;
  notes: TranscriptNote[];
  breakAtPeriod: boolean;
  className?: string;
  onAddNote: (startOffset: number, endOffset: number, quotedText: string, note: string) => Promise<void>;
  onUpdateNote: (id: number, note: string) => Promise<void>;
  onDeleteNote: (id: number) => Promise<void>;
  onLinkToDictionary: (word: string, replacement: string) => Promise<void>;
}

export function AnnotatedTranscript({
  text,
  notes,
  breakAtPeriod,
  className,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onLinkToDictionary,
}: AnnotatedTranscriptProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLParagraphElement>(null);
  const newPopoverRef = useRef<HTMLDivElement>(null);
  const openPopoverRef = useRef<HTMLDivElement>(null);

  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string>();
  // Every one of these round-trips through the sidecar, which is a brand
  // new Node subprocess per call (no persistent connection -- see
  // commands.rs's call_sidecar), easily several hundred ms. Without a
  // visible "working" state the popover just sits there after a click with
  // no feedback until it suddenly closes, which reads as broken -- and
  // worse, an un-disabled Save button invites a second click mid-flight
  // that would fire a duplicate add/update/delete. `saving` disables the
  // form and swaps the button label the instant the click registers.
  const [saving, setSaving] = useState(false);

  const [open, setOpen] = useState<OpenNote | null>(null);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [actionError, setActionError] = useState<string>();
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [linkReplacement, setLinkReplacement] = useState("");
  const [linkSaved, setLinkSaved] = useState(false);
  const [linkError, setLinkError] = useState<string>();
  const [linking, setLinking] = useState(false);

  // A drag-selection finishing anywhere on the page might end outside this
  // exact element (the mouseup fires on whatever's under the cursor), so
  // this listens on the document rather than the container -- same reason
  // DeleteMenu's outside-click listener is document-level.
  useEffect(() => {
    const handleMouseUp = () => {
      const container = containerRef.current;
      if (!container) return;
      const range = getSelectionOffsets(container);
      if (!range) return;
      const sel = window.getSelection();
      const rect = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      if (!rect) return;
      setOpen(null);
      setAddError(undefined);
      setDraft("");
      setPending({ start: range.start, end: range.end, quotedText: text.slice(range.start, range.end), rect });
    };
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [text]);

  const dismissPending = () => {
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };
  const dismissOpen = () => {
    setOpen(null);
    setEditing(false);
    setActionError(undefined);
    setLinkReplacement("");
    setLinkSaved(false);
    setLinkError(undefined);
  };

  // Disabled while a request from this SAME popover is in flight, so an
  // accidental outside click (or Escape) mid-save can't yank the popover
  // away from underneath its own pending request.
  useDismissOnOutsideClick(pending !== null && !saving, dismissPending, newPopoverRef);
  useDismissOnOutsideClick(open !== null && !savingEdit && !deleting, dismissOpen, openPopoverRef);

  const handleSaveNew = async () => {
    if (!pending || !draft.trim() || saving) return;
    setSaving(true);
    try {
      await onAddNote(pending.start, pending.end, pending.quotedText, draft.trim());
      dismissPending();
    } catch (err) {
      setAddError(errorMessage(err));
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!open || !editDraft.trim() || savingEdit) return;
    setSavingEdit(true);
    try {
      await onUpdateNote(open.note.id, editDraft.trim());
      setOpen({ ...open, note: { ...open.note, note: editDraft.trim() } });
      setEditing(false);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!open || deleting) return;
    try {
      const confirmed = await confirm(`${open.note.quotedText}\n\n${t("confirmDeleteNoteBody")}`, {
        title: t("deleteNoteAria"),
        kind: "warning",
      });
      if (!confirmed) return;
      setDeleting(true);
      await onDeleteNote(open.note.id);
      dismissOpen();
    } catch (err) {
      setActionError(errorMessage(err));
      setDeleting(false);
    }
  };

  const handleLinkToDictionary = async () => {
    if (!open || !linkReplacement.trim() || linking) return;
    setLinking(true);
    try {
      await onLinkToDictionary(open.note.quotedText, linkReplacement.trim());
      setLinkSaved(true);
      setLinkError(undefined);
    } catch (err) {
      setLinkError(errorMessage(err));
    } finally {
      setLinking(false);
    }
  };

  const renderNote = ({ key, text: pieceText, noteId }: { key: string; text: string; noteId: number }): ReactNode => (
    <mark
      key={key}
      className="transcript-note"
      onClick={(e) => {
        const found = notes.find((n) => n.id === noteId);
        if (!found) return;
        setPending(null);
        setEditing(false);
        setActionError(undefined);
        setLinkReplacement("");
        setLinkSaved(false);
        setLinkError(undefined);
        setOpen({ note: found, rect: e.currentTarget.getBoundingClientRect() });
      }}
    >
      {pieceText}
    </mark>
  );

  return (
    <>
      <p ref={containerRef} className={className}>
        {renderAnnotatedText(text, notes, { breakAtPeriod, renderNote })}
      </p>

      {pending && (
        <div ref={newPopoverRef} className="note-popover" style={popoverStyle(pending.rect)}>
          <p className="note-popover-quote">"{pending.quotedText}"</p>
          <textarea
            autoFocus
            className="note-popover-textarea"
            placeholder={t("notePlaceholder")}
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
          />
          {addError && <p className="fail-reason">{addError}</p>}
          <div className="note-popover-actions">
            <button type="button" className="btn-link" disabled={saving} onClick={dismissPending}>
              {t("cancel")}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!draft.trim() || saving}
              onClick={() => void handleSaveNew()}
            >
              {saving ? t("saving") : t("save")}
            </button>
          </div>
        </div>
      )}

      {open && (
        <div ref={openPopoverRef} className="note-popover" style={popoverStyle(open.rect)}>
          <p className="note-popover-quote">"{open.note.quotedText}"</p>
          {editing ? (
            <>
              <textarea
                autoFocus
                className="note-popover-textarea"
                value={editDraft}
                disabled={savingEdit}
                onChange={(e) => setEditDraft(e.target.value)}
              />
              <div className="note-popover-actions">
                <button type="button" className="btn-link" disabled={savingEdit} onClick={() => setEditing(false)}>
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!editDraft.trim() || savingEdit}
                  onClick={() => void handleSaveEdit()}
                >
                  {savingEdit ? t("saving") : t("save")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="note-popover-body">{open.note.note}</p>
              <div className="note-popover-actions">
                <button
                  type="button"
                  className="btn-link"
                  disabled={deleting}
                  onClick={() => {
                    setEditDraft(open.note.note);
                    setEditing(true);
                  }}
                >
                  {t("editNoteAria")}
                </button>
                <button type="button" className="btn-link" disabled={deleting} onClick={() => void handleDelete()}>
                  {deleting ? t("deleting") : t("deleteNoteAria")}
                </button>
              </div>
            </>
          )}
          {actionError && <p className="fail-reason">{actionError}</p>}

          {!editing && (
            <div className="note-popover-dictionary">
              {linkSaved ? (
                <p className="settings-hint">{t("addToDictionarySuccess")}</p>
              ) : (
                <>
                  <label htmlFor="note-link-replacement">{t("addToDictionaryReplacementLabel")}</label>
                  <div className="note-popover-dictionary-row">
                    <input
                      id="note-link-replacement"
                      type="text"
                      value={linkReplacement}
                      disabled={linking}
                      onChange={(e) => setLinkReplacement(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn-link"
                      disabled={!linkReplacement.trim() || linking}
                      onClick={() => void handleLinkToDictionary()}
                    >
                      {linking ? t("saving") : t("addToDictionary")}
                    </button>
                  </div>
                  {linkError && <p className="fail-reason">{linkError}</p>}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

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

// Shared outside-click + Escape dismissal, same behavior as HistoryRow's
// DeleteMenu (mousedown outside closes; Escape closes and hands focus back).
function useDismiss(active: boolean, onDismiss: () => void, anchorRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) onDismiss();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, onDismiss, anchorRef]);
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

  const [open, setOpen] = useState<OpenNote | null>(null);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [actionError, setActionError] = useState<string>();
  const [linkReplacement, setLinkReplacement] = useState("");
  const [linkSaved, setLinkSaved] = useState(false);
  const [linkError, setLinkError] = useState<string>();

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

  useDismiss(pending !== null, dismissPending, newPopoverRef);
  useDismiss(open !== null, dismissOpen, openPopoverRef);

  const handleSaveNew = async () => {
    if (!pending || !draft.trim()) return;
    try {
      await onAddNote(pending.start, pending.end, pending.quotedText, draft.trim());
      dismissPending();
    } catch (err) {
      setAddError(errorMessage(err));
    }
  };

  const handleSaveEdit = async () => {
    if (!open || !editDraft.trim()) return;
    try {
      await onUpdateNote(open.note.id, editDraft.trim());
      setOpen({ ...open, note: { ...open.note, note: editDraft.trim() } });
      setEditing(false);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const handleDelete = async () => {
    if (!open) return;
    try {
      const confirmed = await confirm(`${open.note.quotedText}\n\n${t("confirmDeleteNoteBody")}`, {
        title: t("deleteNoteAria"),
        kind: "warning",
      });
      if (!confirmed) return;
      await onDeleteNote(open.note.id);
      dismissOpen();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const handleLinkToDictionary = async () => {
    if (!open || !linkReplacement.trim()) return;
    try {
      await onLinkToDictionary(open.note.quotedText, linkReplacement.trim());
      setLinkSaved(true);
      setLinkError(undefined);
    } catch (err) {
      setLinkError(errorMessage(err));
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
            onChange={(e) => setDraft(e.target.value)}
          />
          {addError && <p className="fail-reason">{addError}</p>}
          <div className="note-popover-actions">
            <button type="button" className="btn-link" onClick={dismissPending}>
              {t("cancel")}
            </button>
            <button type="button" className="btn-primary" disabled={!draft.trim()} onClick={() => void handleSaveNew()}>
              {t("save")}
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
                onChange={(e) => setEditDraft(e.target.value)}
              />
              <div className="note-popover-actions">
                <button type="button" className="btn-link" onClick={() => setEditing(false)}>
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!editDraft.trim()}
                  onClick={() => void handleSaveEdit()}
                >
                  {t("save")}
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
                  onClick={() => {
                    setEditDraft(open.note.note);
                    setEditing(true);
                  }}
                >
                  {t("editNoteAria")}
                </button>
                <button type="button" className="btn-link" onClick={() => void handleDelete()}>
                  {t("deleteNoteAria")}
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
                      onChange={(e) => setLinkReplacement(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn-link"
                      disabled={!linkReplacement.trim()}
                      onClick={() => void handleLinkToDictionary()}
                    >
                      {t("addToDictionary")}
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

// Transcript notes (SPEC.md > Transcript notes). Renders one transcript's
// body with its notes highlighted, and owns the two popovers that create/
// view/edit/delete a note -- HistoryRow and QueueRow each own a
// useTranscriptNotes() instance and pass its state/actions in here as
// props, so this component itself never touches Tauri IPC directly (easy
// to test with plain mock callbacks, and the parent row's copy button can
// read the same `notes` array without a second fetch).
//
// Optimistic (2026-09-29, user-reported): add/edit/delete apply to local
// state and close their popover the instant the action is taken -- the
// sidecar round trip happens in the background (useTranscriptNotes owns
// that). `open` therefore stores only a noteId, not a snapshot of the
// note itself: the note actually shown is always derived fresh from the
// current `notes` prop, so a background success/failure that lands while
// a DIFFERENT note is now open just naturally has nothing to clobber.
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../../i18n/I18nContext";
import { renderAnnotatedText, getSelectionOffsets } from "./textOffsets";
import { useDismissOnOutsideClick } from "../../lib/useDismiss";
import { useClampedPopoverPosition } from "./useClampedPopoverPosition";
import { isImeComposing } from "../../lib/ime";
import type { TranscriptNote } from "../../lib/tauri";
import type { NoteFailure } from "./useTranscriptNotes";

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
  noteId: number;
  rect: DOMRect;
}

export interface AnnotatedTranscriptProps {
  text: string;
  notes: TranscriptNote[];
  noteFailures: Map<number, NoteFailure>;
  breakAtPeriod: boolean;
  className?: string;
  onAddNote: (startOffset: number, endOffset: number, quotedText: string, note: string) => void;
  onUpdateNote: (id: number, note: string) => void;
  onDeleteNote: (id: number) => void;
  onRetryNote: (id: number) => void;
  onDiscardNote: (id: number) => void;
  onLinkToDictionary: (word: string, replacement: string) => Promise<void>;
}

export function AnnotatedTranscript({
  text,
  notes,
  noteFailures,
  breakAtPeriod,
  className,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onRetryNote,
  onDiscardNote,
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
  const [linkReplacement, setLinkReplacement] = useState("");
  const [linkSaved, setLinkSaved] = useState(false);
  const [linkError, setLinkError] = useState<string>();
  const [linking, setLinking] = useState(false);
  // "Add to dictionary" is deliberately NOT optimistic (a secondary,
  // less-frequent action, out of scope for the note-save/cancel
  // complaint this component's other state was rewritten for) -- it
  // still awaits its request, so a slow request for a note the user has
  // since navigated away from needs this ref (read live, unlike the
  // `open` state closed over above) to avoid writing a stale success/
  // error into whatever's open now.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useClampedPopoverPosition(newPopoverRef, pending?.rect);
  useClampedPopoverPosition(openPopoverRef, open?.rect);

  const openNote = open ? notes.find((n) => n.id === open.noteId) : undefined;
  const openFailure = open ? noteFailures.get(open.noteId) : undefined;

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
      dismissOpen();
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
    setLinkReplacement("");
    setLinkSaved(false);
    setLinkError(undefined);
    setLinking(false);
  };

  useDismissOnOutsideClick(pending !== null, dismissPending, newPopoverRef);
  useDismissOnOutsideClick(open !== null, dismissOpen, openPopoverRef, editing ? () => setEditing(false) : undefined);

  const handleSaveNew = () => {
    if (!pending || !draft.trim()) return;
    try {
      onAddNote(pending.start, pending.end, pending.quotedText, draft.trim());
      dismissPending();
    } catch (err) {
      setAddError(errorMessage(err));
    }
  };

  const handleSaveEdit = () => {
    if (!openNote || !editDraft.trim()) return;
    onUpdateNote(openNote.id, editDraft.trim());
    setEditing(false);
  };

  const handleDelete = async () => {
    if (!openNote) return;
    const confirmed = await confirm(`${openNote.quotedText}\n\n${t("confirmDeleteNoteBody")}`, {
      title: t("deleteNoteAria"),
      kind: "warning",
    });
    if (!confirmed) return;
    onDeleteNote(openNote.id);
    dismissOpen();
  };

  const handleLinkToDictionary = async () => {
    if (!openNote || !linkReplacement.trim() || linking) return;
    const forNoteId = openNote.id;
    setLinking(true);
    try {
      await onLinkToDictionary(openNote.quotedText, linkReplacement.trim());
      if (openRef.current?.noteId !== forNoteId) return;
      setLinkSaved(true);
      setLinkError(undefined);
    } catch (err) {
      if (openRef.current?.noteId !== forNoteId) return;
      setLinkError(errorMessage(err));
    } finally {
      if (openRef.current?.noteId === forNoteId) setLinking(false);
    }
  };

  const handleTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>, onSave: () => void) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !isImeComposing(e.nativeEvent)) {
      e.preventDefault();
      onSave();
    }
  };

  const failureHeading = (action: NoteFailure["action"]): string => {
    if (action === "add") return t("noteSaveFailed");
    if (action === "update") return t("noteUpdateFailed");
    return t("noteDeleteFailed");
  };

  const renderNote = ({ key, text: pieceText, noteId }: { key: string; text: string; noteId: number }): ReactNode => (
    <mark
      key={key}
      className={noteFailures.has(noteId) ? "transcript-note transcript-note-failed" : "transcript-note"}
      onClick={(e) => {
        setPending(null);
        setEditing(false);
        setLinkReplacement("");
        setLinkSaved(false);
        setLinkError(undefined);
        setLinking(false);
        setOpen({ noteId, rect: e.currentTarget.getBoundingClientRect() });
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
        <div ref={newPopoverRef} className="note-popover" style={{ visibility: "hidden" }}>
          <p className="note-popover-quote">"{pending.quotedText}"</p>
          <textarea
            autoFocus
            className="note-popover-textarea"
            placeholder={t("notePlaceholder")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => handleTextareaKeyDown(e, handleSaveNew)}
          />
          {addError && <p className="fail-reason">{addError}</p>}
          <div className="note-popover-actions">
            <button type="button" className="btn-link" onClick={dismissPending}>
              {t("cancel")}
            </button>
            <button type="button" className="btn-primary" disabled={!draft.trim()} onClick={handleSaveNew}>
              {t("save")}
            </button>
          </div>
        </div>
      )}

      {open && openNote && (
        <div ref={openPopoverRef} className="note-popover" style={{ visibility: "hidden" }}>
          <p className="note-popover-quote">"{openNote.quotedText}"</p>
          {openFailure ? (
            <>
              <p className="fail-reason">
                {failureHeading(openFailure.action)} {openFailure.error}
              </p>
              <div className="note-popover-actions">
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => {
                    onDiscardNote(openNote.id);
                    dismissOpen();
                  }}
                >
                  {t("discard")}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    onRetryNote(openNote.id);
                    dismissOpen();
                  }}
                >
                  {t("retry")}
                </button>
              </div>
            </>
          ) : editing ? (
            <>
              <textarea
                autoFocus
                className="note-popover-textarea"
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={(e) => handleTextareaKeyDown(e, handleSaveEdit)}
              />
              <div className="note-popover-actions">
                <button type="button" className="btn-link" onClick={() => setEditing(false)}>
                  {t("cancel")}
                </button>
                <button type="button" className="btn-primary" disabled={!editDraft.trim()} onClick={handleSaveEdit}>
                  {t("save")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="note-popover-body">{openNote.note}</p>
              <div className="note-popover-actions">
                <button
                  type="button"
                  className="btn-link"
                  disabled={openNote.id < 0}
                  onClick={() => {
                    setEditDraft(openNote.note);
                    setEditing(true);
                  }}
                >
                  {t("editNoteAria")}
                </button>
                <button type="button" className="btn-link" disabled={openNote.id < 0} onClick={() => void handleDelete()}>
                  {t("deleteNoteAria")}
                </button>
              </div>
            </>
          )}

          {!editing && !openFailure && (
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

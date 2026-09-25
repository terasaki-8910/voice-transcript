// Transcript notes (SPEC.md > Transcript notes > Copy). Once a row has
// notes, "copy transcript" and "copy with notes" are both real choices --
// consolidated into one icon-sized trigger with a 2-item menu (same
// WAI-ARIA "menu button" pattern as HistoryRow's DeleteMenu) instead of an
// icon plus a separate text-link sitting next to it: that pairing read as
// visually mismatched and took up noticeably more row width than every
// other icon-only action (user-reported, 2026-09-25). With no notes, this
// renders as the single, instant-copy icon button it always was -- a menu
// offering only one real choice is never shown (ui.md's empty-state-
// clutter rule).
import { useRef, useState } from "react";
import { FiCopy, FiCheck, FiMessageSquare } from "react-icons/fi";
import { useDismissOnOutsideClick } from "../../lib/useDismiss";

export interface CopyMenuProps {
  hasNotes: boolean;
  onCopy: () => Promise<void>;
  onCopyWithNotes: () => Promise<void>;
  copyLabel: string;
  copyWithNotesLabel: string;
  copiedLabel: string;
}

export function CopyMenu({
  hasNotes,
  onCopy,
  onCopyWithNotes,
  copyLabel,
  copyWithNotesLabel,
  copiedLabel,
}: CopyMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useDismissOnOutsideClick(open, () => setOpen(false), anchorRef);

  // Awaits before flashing the checkmark (not a fire-and-forget) so a copy
  // failure never shows "Copied" -- the caller's onCopy/onCopyWithNotes
  // already reports the failure itself (HistoryRow's reportActionError /
  // QueueRow's setExportError), so this only decides the checkmark.
  const runCopy = async (fn: () => Promise<void>) => {
    setOpen(false);
    try {
      await fn();
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Already surfaced by the caller; nothing more to do here.
    }
  };

  const triggerIcon = copied ? <FiCheck aria-hidden="true" /> : <FiCopy aria-hidden="true" />;
  const triggerLabel = copied ? copiedLabel : copyLabel;

  if (!hasNotes) {
    return (
      <button
        type="button"
        className="row-action icon-btn"
        title={triggerLabel}
        aria-label={triggerLabel}
        onClick={() => void runCopy(onCopy)}
      >
        {triggerIcon}
      </button>
    );
  }

  return (
    <div className="row-action menu-anchor" ref={anchorRef}>
      <button
        type="button"
        className="icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        title={triggerLabel}
        aria-label={triggerLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {triggerIcon}
      </button>
      {open && (
        <div className="menu" role="menu">
          <button type="button" role="menuitem" className="menu-item" onClick={() => void runCopy(onCopy)}>
            <FiCopy aria-hidden="true" />
            <span>{copyLabel}</span>
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => void runCopy(onCopyWithNotes)}>
            <FiMessageSquare aria-hidden="true" />
            <span>{copyWithNotesLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
}

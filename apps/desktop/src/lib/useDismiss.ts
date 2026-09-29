// Shared outside-click + Escape dismissal for a popover/menu anchored to a
// ref -- mousedown outside the anchor closes it, Escape closes it too.
// Originally hand-rolled independently in HistoryRow's DeleteMenu and
// AnnotatedTranscript's two note popovers; pulled out once a third
// consumer (CopyMenu) needed the identical behavior a third time.
import { useEffect } from "react";
import type { RefObject } from "react";
import { isImeComposing } from "./ime";

// onEscape defaults to onDismiss -- pass a narrower callback when Escape
// should do less than a full dismiss (e.g. AnnotatedTranscript's open-note
// popover: Escape while editing should only leave edit mode, matching the
// visible Cancel link, not close the whole popover the way an outside
// click does).
export function useDismissOnOutsideClick(
  active: boolean,
  onDismiss: () => void,
  anchorRef: RefObject<HTMLElement | null>,
  onEscape: () => void = onDismiss,
): void {
  useEffect(() => {
    if (!active) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) onDismiss();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (e.key === "Escape") onEscape();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, onDismiss, onEscape, anchorRef]);
}

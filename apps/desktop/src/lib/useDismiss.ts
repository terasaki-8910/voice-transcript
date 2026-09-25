// Shared outside-click + Escape dismissal for a popover/menu anchored to a
// ref -- mousedown outside the anchor closes it, Escape closes it too.
// Originally hand-rolled independently in HistoryRow's DeleteMenu and
// AnnotatedTranscript's two note popovers; pulled out once a third
// consumer (CopyMenu) needed the identical behavior a third time.
import { useEffect } from "react";
import type { RefObject } from "react";

export function useDismissOnOutsideClick(
  active: boolean,
  onDismiss: () => void,
  anchorRef: RefObject<HTMLElement | null>,
): void {
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

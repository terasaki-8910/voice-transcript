// Keeps a note popover fully inside the browser window, regardless of
// where its anchor (a text selection or a highlighted <mark>) sits --
// selecting a long passage near the bottom/edge of the window used to push
// the popover (and its textarea) off-screen entirely, with no way to reach
// it. position: fixed is used deliberately (not absolute): the anchor can
// sit inside .row-preview, which clips overflow while collapsed -- fixed
// positioning is the one placement that escapes that clip since it's
// relative to the viewport, not any scrolling ancestor.
import { useLayoutEffect } from "react";
import type { RefObject } from "react";

export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface Size {
  width: number;
  height: number;
}

interface Viewport {
  width: number;
  height: number;
}

interface Position {
  top: number;
  left: number;
}

const MARGIN = 8;
const GAP = 6;

// Pure and plain-number-based on purpose -- exercised directly with plain
// numbers in tests rather than through jsdom, which does no real layout.
export function placePopover(anchor: Rect, size: Size, viewport: Viewport): Position {
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - size.height;

  let top: number;
  if (below + size.height <= viewport.height - MARGIN) {
    top = below;
  } else if (above >= MARGIN) {
    top = above;
  } else {
    top = viewport.height - MARGIN - size.height;
  }
  top = Math.max(MARGIN, top);

  const left = Math.max(MARGIN, Math.min(anchor.left, viewport.width - MARGIN - size.width));

  return { top, left };
}

// Measures the popover element itself (its real rendered size, including
// however tall its content made it) and writes a clamped position directly
// onto its style -- useLayoutEffect runs before paint, so there's no
// visible jump from a naive first position to the corrected one. Re-places
// on window resize and, via ResizeObserver (absent in jsdom, guarded), on
// the popover's own content changing size (an error line appearing, edit
// mode toggling, a manually resized textarea).
export function useClampedPopoverPosition(ref: RefObject<HTMLElement | null>, anchor: Rect | undefined): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;

    const place = () => {
      const size = el.getBoundingClientRect();
      const position = placePopover(anchor, { width: size.width, height: size.height }, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      el.style.top = `${position.top}px`;
      el.style.left = `${position.left}px`;
      el.style.visibility = "visible";
    };

    place();

    window.addEventListener("resize", place);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : undefined;
    observer?.observe(el);

    return () => {
      window.removeEventListener("resize", place);
      observer?.disconnect();
    };
  }, [ref, anchor]);
}

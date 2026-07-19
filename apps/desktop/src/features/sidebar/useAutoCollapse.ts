// Sidebar polish (2026-07-19, real-usage feedback): auto-engages the
// existing icon-rail collapse (Sidebar.tsx's isCollapsed) when the window
// gets too narrow to comfortably show both sidebar and content, Claude
// Desktop-style. Fires ONLY at the moment window width crosses the
// breakpoint, in either direction -- not on every resize tick while already
// on one side of it -- so a manual toggle click done in between crossings
// isn't immediately reverted on the next resize event.
import { useEffect, useRef } from "react";

export const COLLAPSE_BREAKPOINT = 640;

export function isNarrowWindow(): boolean {
  return window.innerWidth < COLLAPSE_BREAKPOINT;
}

export function useAutoCollapse(setIsCollapsed: (collapsed: boolean) => void): void {
  const wasNarrowRef = useRef(isNarrowWindow());

  useEffect(() => {
    const handleResize = () => {
      const isNarrow = isNarrowWindow();
      if (isNarrow !== wasNarrowRef.current) {
        wasNarrowRef.current = isNarrow;
        setIsCollapsed(isNarrow);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setIsCollapsed]);
}

// F17 (gui-queue). Uses Tauri's core webview drag-drop event -- real
// absolute file paths, no extra plugin/capability needed beyond
// core:default (already granted). See design_brief.md: "no custom
// in-webview file browser" -- this is native OS drag-and-drop, not a faked
// one.
import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

export function useDragDrop(onDrop: (paths: string[]) => void): { isDragging: boolean } {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          setIsDragging(true);
        } else if (event.payload.type === "drop") {
          setIsDragging(false);
          onDrop(event.payload.paths);
        } else {
          setIsDragging(false);
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
    // Subscribe once. `onDrop` (QueueContext's addFiles) uses the
    // functional setState form internally, so calling whichever closure
    // was captured at mount time is still correct even if the caller
    // re-creates the function reference on every render. (No
    // react-hooks/exhaustive-deps rule is configured in this project's
    // eslint.config.js, so no disable comment is needed here.)
  }, []);

  return { isDragging };
}

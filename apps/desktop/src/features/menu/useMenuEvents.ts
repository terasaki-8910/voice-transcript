// F21 (native-menu). Bridges the four webview-facing native menu events
// (menu.rs's EVENT_* constants) to the same actions their in-webview
// equivalents already trigger -- "View on GitHub" isn't listed here
// because it's handled entirely in Rust (opens the URL directly, no
// webview state needed). pickFiles/pickSavePath/exportTranscript are
// injectable (same DI convention as QueueContext's transcribeFn /
// HistoryContext's listHistoryFn) so tests can exercise this hook without
// a real Tauri runtime; `listen` itself is mocked at the module level in
// tests instead, matching how other raw Tauri API bindings are handled
// elsewhere in this codebase.
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueue } from "../queue/QueueContext";
import { useNav } from "../nav/NavContext";
import { useSelection } from "../selection/SelectionContext";
import { pickFiles, pickSavePath, exportTranscript } from "../../lib/tauri";

export interface UseMenuEventsDeps {
  pickFilesFn?: () => Promise<string[]>;
  pickSavePathFn?: (defaultFileName: string) => Promise<string | null>;
  exportTranscriptFn?: (path: string, content: string) => Promise<void>;
}

export function useMenuEvents(onOpenPreferences: () => void, deps: UseMenuEventsDeps = {}): void {
  const { pickFilesFn = pickFiles, pickSavePathFn = pickSavePath, exportTranscriptFn = exportTranscript } = deps;
  const { addFiles } = useQueue();
  const { setActiveTab } = useNav();
  const { selection } = useSelection();

  useEffect(() => {
    const unlistenPromises = [
      listen("menu-add-files", () => {
        void pickFilesFn().then((paths) => {
          if (paths.length > 0) addFiles(paths);
        });
      }),
      listen("menu-open-history", () => {
        setActiveTab("history");
      }),
      listen("menu-export", () => {
        if (!selection) return;
        void pickSavePathFn(`${selection.fileName}.${selection.format}`).then((path) => {
          if (path) return exportTranscriptFn(path, selection.text);
          return undefined;
        });
      }),
      listen("menu-preferences", () => {
        onOpenPreferences();
      }),
    ];

    return () => {
      unlistenPromises.forEach((p) => void p.then((unlisten) => unlisten()));
    };
  }, [addFiles, setActiveTab, selection, onOpenPreferences, pickFilesFn, pickSavePathFn, exportTranscriptFn]);
}

// F14 scaffold, grown incrementally: F20 (theme toggle) and F19 (language
// toggle) built the toolbar shell; F17 (gui-queue) replaces the placeholder
// body with the real queue screen. F18 (gui-history) adds HistoryProvider as
// a sibling of QueueProvider -- both stay mounted for the app's lifetime so
// switching tabs doesn't lose queue progress or refetch history from
// scratch. F21 (native-menu) adds NavProvider/SelectionProvider (shared
// state the native menu's events need to reach from outside the tree) and
// AppShell, which owns whether PreferencesView is open and wires
// useMenuEvents -- both need to sit inside every other provider.
//
// Sidebar redesign (2026-07-19): AppLayout (Sidebar + QueueView) replaces
// QueueView's own toolbar. HistoryNavProvider (back/forward through
// individually-View'd History entries) sits inside NavProvider -- it calls
// useNav() internally to switch to the History tab when navigating.
import { useEffect, useRef, useState } from "react";
import { QueueProvider, useQueue } from "./features/queue/QueueContext";
import type { QueueItemStatus } from "./features/queue/QueueContext";
import { AppLayout } from "./features/layout/AppLayout";
import { RecordingProvider } from "./features/recording/RecordingContext";
import { HistoryProvider, useHistory } from "./features/history/HistoryContext";
import { HistoryNavProvider } from "./features/history/HistoryNavContext";
import { NavProvider } from "./features/nav/NavContext";
import { SelectionProvider } from "./features/selection/SelectionContext";
import { PreferencesView } from "./features/preferences/PreferencesView";
import { SearchModal } from "./features/search/SearchModal";
import { useMenuEvents } from "./features/menu/useMenuEvents";
import { useVoiceInputSettings } from "./features/preferences/VoiceInputSettingsContext";
import { useI18n } from "./i18n/I18nContext";
import { setMenuLanguage } from "./lib/tauri";

// Exported for tests -- lets a test wrap it with injectable QueueProvider/
// HistoryProvider transcribeFn/listHistoryFn props (App() below hardcodes
// the real ones), to exercise the queue-completion -> history-refresh
// wiring without needing the real Tauri bridge.
export function AppShell() {
  const [showPreferences, setShowPreferences] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  useMenuEvents(() => setShowPreferences(true));

  // Cmd+F (macOS) / Ctrl+F (Windows/Linux): the conventional in-app search
  // shortcut, works regardless of which tab has focus (not gated behind
  // the sidebar having focus first) -- webview-level, not a native OS menu
  // item, since it only needs to work while this window is focused, the
  // same class of shortcut as a browser's own find-in-page.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setShowSearch(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // The sidecar writes a history record as soon as a queue item finishes
  // (success or failure -- both are recorded, per packages/core/src/
  // sidecar.ts's handleTranscribe), but HistoryProvider only ever fetches
  // once on mount. Without this, a completed queue item doesn't show up in
  // History until the app is restarted (real user report, 2026-07-14).
  // Tracks each item's last-seen status so a refresh fires exactly once
  // per transition into "done"/"failed", not on every unrelated queue
  // re-render.
  //
  // The same per-item transition also drives auto-trash (2026-09-30,
  // user-reported): a recording (never an upload -- the user's own
  // pre-existing file) whose transcription just succeeded (never
  // "failed" -- keep the file so a failed run can be retried from it) has
  // its audio moved to the OS trash via the existing history.trash(), the
  // same call the manual "Trash audio" button makes. Reading
  // autoTrashRecordings here (not at record-time) means flipping the
  // setting only affects transcriptions that finish afterward, not ones
  // already queued. No ordering hazard with history.refresh() in the same
  // effect -- refresh() only ever writes items/status/error/syncError,
  // trash() only ever writes trashedIds/actionErrors, disjoint state.
  const queue = useQueue();
  const history = useHistory();
  const { autoTrashRecordings } = useVoiceInputSettings();
  const lastStatusesRef = useRef<Map<string, QueueItemStatus>>(new Map());
  useEffect(() => {
    const lastStatuses = lastStatusesRef.current;
    const nextStatuses = new Map<string, QueueItemStatus>();
    let justCompleted = false;
    const toTrash: number[] = [];
    for (const item of queue.items) {
      nextStatuses.set(item.id, item.status);
      const isTerminal = item.status === "done" || item.status === "failed";
      if (isTerminal && lastStatuses.get(item.id) !== item.status) {
        justCompleted = true;
        if (autoTrashRecordings && item.status === "done" && item.origin === "recording" && item.result?.id !== undefined) {
          toTrash.push(item.result.id);
        }
      }
    }
    lastStatusesRef.current = nextStatuses;
    if (justCompleted) history.refresh();
    for (const id of toTrash) void history.trash(id);
  }, [queue.items, history, autoTrashRecordings]);

  // Keeps the native OS menu bar's labels in sync with the in-app language
  // setting (menu.rs's set_menu_language). Lives here, not in I18nContext
  // itself, since I18nProvider is also used as a plain test wrapper by many
  // narrower component tests (PreferencesView, QueueRow, ...) that assert
  // exact invoke() call counts/args -- putting a Tauri IPC call inside the
  // generic provider would fire it in every one of those, not just the
  // real app. Runs on mount too (not just later changes), so a persisted
  // language preference also syncs the menu, which was built with a fixed
  // "en" default before this ran (see menu.rs's doc comment on that
  // cold-start ordering).
  const { lang } = useI18n();
  useEffect(() => {
    void setMenuLanguage(lang).catch(() => {});
  }, [lang]);

  return (
    <>
      <AppLayout
        preferencesOpen={showPreferences}
        onOpenPreferences={() => setShowPreferences(true)}
        onOpenSearch={() => setShowSearch(true)}
      />
      {showPreferences && <PreferencesView onClose={() => setShowPreferences(false)} />}
      {showSearch && <SearchModal onClose={() => setShowSearch(false)} />}
    </>
  );
}

export function App() {
  return (
    <QueueProvider>
      <HistoryProvider>
        <NavProvider>
          <HistoryNavProvider>
            <SelectionProvider>
              <RecordingProvider>
                <AppShell />
              </RecordingProvider>
            </SelectionProvider>
          </HistoryNavProvider>
        </NavProvider>
      </HistoryProvider>
    </QueueProvider>
  );
}

// F14 scaffold, grown incrementally: F20 (theme toggle) and F19 (language
// toggle) built the toolbar shell; F17 (gui-queue) replaces the placeholder
// body with the real queue screen -- QueueView renders its own toolbar
// (Queue/History tabs + Add files), composing ThemeToggle/LanguageToggle
// into it. F18 (gui-history) adds HistoryProvider as a sibling of
// QueueProvider -- both stay mounted for the app's lifetime so switching
// tabs doesn't lose queue progress or refetch history from scratch. F21
// (native-menu) adds NavProvider/SelectionProvider (shared state the
// native menu's events need to reach from outside QueueView) and
// AppShell, which owns whether PreferencesView is open and wires
// useMenuEvents -- both need to sit inside every other provider.
import { useEffect, useState } from "react";
import { QueueProvider } from "./features/queue/QueueContext";
import { QueueView } from "./features/queue/QueueView";
import { HistoryProvider } from "./features/history/HistoryContext";
import { NavProvider } from "./features/nav/NavContext";
import { SelectionProvider } from "./features/selection/SelectionContext";
import { PreferencesView } from "./features/preferences/PreferencesView";
import { useMenuEvents } from "./features/menu/useMenuEvents";
import { useI18n } from "./i18n/I18nContext";
import { setMenuLanguage } from "./lib/tauri";

function AppShell() {
  const [showPreferences, setShowPreferences] = useState(false);
  useMenuEvents(() => setShowPreferences(true));

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
      <QueueView />
      {showPreferences && <PreferencesView onClose={() => setShowPreferences(false)} />}
    </>
  );
}

export function App() {
  return (
    <QueueProvider>
      <HistoryProvider>
        <NavProvider>
          <SelectionProvider>
            <AppShell />
          </SelectionProvider>
        </NavProvider>
      </HistoryProvider>
    </QueueProvider>
  );
}

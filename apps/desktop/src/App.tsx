// F14 scaffold, grown incrementally: F20 (theme toggle) and F19 (language
// toggle) built the toolbar shell; F17 (gui-queue) replaces the placeholder
// body with the real queue screen -- QueueView renders its own toolbar
// (Queue/History tabs + Add files), composing ThemeToggle/LanguageToggle
// into it. F18 (gui-history) adds HistoryProvider as a sibling of
// QueueProvider -- both stay mounted for the app's lifetime so switching
// tabs doesn't lose queue progress or refetch history from scratch.
import { QueueProvider } from "./features/queue/QueueContext";
import { QueueView } from "./features/queue/QueueView";
import { HistoryProvider } from "./features/history/HistoryContext";

export function App() {
  return (
    <QueueProvider>
      <HistoryProvider>
        <QueueView />
      </HistoryProvider>
    </QueueProvider>
  );
}

// F14 scaffold, grown incrementally: F20 (theme toggle) and F19 (language
// toggle) built the toolbar shell; F17 (gui-queue) replaces the placeholder
// body with the real queue screen -- QueueView renders its own toolbar
// (Queue/History tabs + Add files), composing ThemeToggle/LanguageToggle
// into it. F18 (gui-history) wires up the History tab's actual view next.
import { QueueProvider } from "./features/queue/QueueContext";
import { QueueView } from "./features/queue/QueueView";

export function App() {
  return (
    <QueueProvider>
      <QueueView />
    </QueueProvider>
  );
}

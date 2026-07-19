// Thin composition: sidebar + content pane, matching design/reference-screen.html's
// ".app" row layout (global.css). No new CSS -- reuses the existing .app rule.
import { Sidebar } from "../sidebar/Sidebar";
import { QueueView } from "../queue/QueueView";

interface AppLayoutProps {
  preferencesOpen: boolean;
  onOpenPreferences: () => void;
}

export function AppLayout({ preferencesOpen, onOpenPreferences }: AppLayoutProps) {
  return (
    <div className="app">
      <Sidebar preferencesOpen={preferencesOpen} onOpenPreferences={onOpenPreferences} />
      <QueueView />
    </div>
  );
}

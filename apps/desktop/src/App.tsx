// F14 scaffold, now growing incrementally: F20 (gui-theme) adds the
// toolbar shell + theme toggle. Queue/history/tabs land in F17/F18/F19
// (PLAN.md Wave 9) -- each adds to this toolbar rather than replacing it.
import { ThemeToggle } from "./theme/ThemeToggle";

export function App() {
  return (
    <div className="app">
      <header className="toolbar">
        <p className="brand">Voice Transcript</p>
        <div className="spacer" />
        <div className="settings">
          <ThemeToggle />
        </div>
      </header>
      <main
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "60vh",
          gap: "var(--space-3)",
          textAlign: "center",
          padding: "var(--space-5)",
        }}
      >
        <p
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--color-ink-muted)",
            margin: 0,
            maxWidth: "40ch",
          }}
        >
          Queue, history, and language settings land in upcoming builds.
        </p>
      </main>
    </div>
  );
}

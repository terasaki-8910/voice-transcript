// Scaffold placeholder (F14, tauri-scaffold). The real queue/history/i18n/
// theme UI (matching design/reference-screen.html) lands in later features
// (gui-queue, gui-history, gui-i18n, gui-theme, PLAN.md Wave 9) -- this
// component only proves the Tauri + React + token-styled wiring works.
export function App() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        gap: "var(--space-3)",
        textAlign: "center",
        padding: "var(--space-5)",
      }}
    >
      <h1
        style={{
          fontSize: "var(--text-lg)",
          fontWeight: "var(--weight-semibold)",
          margin: 0,
        }}
      >
        Voice Transcript
      </h1>
      <p
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--color-ink-muted)",
          margin: 0,
          maxWidth: "40ch",
        }}
      >
        Desktop scaffold -- queue, history, and settings land in upcoming
        builds.
      </p>
    </main>
  );
}

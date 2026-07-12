// F14 scaffold, now growing incrementally: F20 (gui-theme) added the
// toolbar shell + theme toggle; F19 (gui-i18n) adds the language toggle and
// switches the placeholder copy through the shared i18n system. Queue/
// history/tabs land in F17/F18 (PLAN.md Wave 9) -- each adds to this same
// toolbar rather than replacing it.
import { ThemeToggle } from "./theme/ThemeToggle";
import { LanguageToggle } from "./i18n/LanguageToggle";
import { useI18n } from "./i18n/I18nContext";

export function App() {
  const { t } = useI18n();

  return (
    <div className="app">
      <header className="toolbar">
        <p className="brand">Voice Transcript</p>
        <div className="spacer" />
        <div className="settings">
          <ThemeToggle />
          <LanguageToggle />
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
          {t("placeholder")}
        </p>
      </main>
    </div>
  );
}

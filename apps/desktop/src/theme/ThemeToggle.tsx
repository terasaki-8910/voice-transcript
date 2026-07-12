// Matches design/reference-screen.html's ".settings .tabs" pill-toggle
// style -- deliberately quiet (small, muted) so it never competes with the
// toolbar's primary action (design_brief.md > Do). Labels come from the
// shared i18n system (F19) so the theme toggle also switches with the
// language setting (ACCEPTANCE G6), not a locally-duplicated dictionary.
import { useTheme } from "./ThemeContext";
import type { Theme } from "./ThemeContext";
import { useI18n } from "../i18n/I18nContext";
import type { TranslationKey } from "../i18n/translations";

const OPTIONS: { value: Theme; key: TranslationKey }[] = [
  { value: "light", key: "light" },
  { value: "dark", key: "dark" },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();

  return (
    <div className="tabs" role="group" aria-label="Theme">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className="tab"
          aria-selected={theme === opt.value}
          onClick={() => setTheme(opt.value)}
        >
          {t(opt.key)}
        </button>
      ))}
    </div>
  );
}

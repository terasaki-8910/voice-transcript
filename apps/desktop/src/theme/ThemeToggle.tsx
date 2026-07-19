// Matches design/reference-screen.html's sidebar-footer icon toggle
// (sidebar follow-up, 2026-07-19 -- was a Light/Dark ".tabs" pill pair
// before this). Icon reflects the CURRENT theme (sun in light, moon in
// dark); clicking flips it. Label comes from the shared i18n system (F19)
// so it also switches with the language setting (ACCEPTANCE G6).
import { FiSun, FiMoon } from "react-icons/fi";
import { useTheme } from "./ThemeContext";
import { useI18n } from "../i18n/I18nContext";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();

  return (
    <button
      type="button"
      className="icon-toggle"
      aria-label={t("toggleTheme")}
      title={t("toggleTheme")}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? <FiMoon aria-hidden="true" /> : <FiSun aria-hidden="true" />}
    </button>
  );
}

// Matches design/reference-screen.html's ".settings .tabs" pill-toggle
// style -- deliberately quiet (small, muted) so it never competes with the
// toolbar's primary action (design_brief.md > Do).
import { useTheme } from "./ThemeContext";
import type { Theme } from "./ThemeContext";

const OPTIONS: { value: Theme; en: string; ja: string }[] = [
  { value: "light", en: "Light", ja: "ライト" },
  { value: "dark", en: "Dark", ja: "ダーク" },
];

export function ThemeToggle({ lang = "en" }: { lang?: "en" | "ja" }) {
  const { theme, setTheme } = useTheme();

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
          {lang === "ja" ? opt.ja : opt.en}
        </button>
      ))}
    </div>
  );
}

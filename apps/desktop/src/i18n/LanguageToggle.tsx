// Matches design/reference-screen.html's language pill-toggle. Labels
// ("EN" / "日本語") are the language names themselves, not translated by
// the current language -- same convention as most OS language pickers.
import { useI18n } from "./I18nContext";
import type { Lang } from "./translations";

const OPTIONS: { value: Lang; label: string }[] = [
  { value: "en", label: "EN" },
  { value: "ja", label: "日本語" },
];

export function LanguageToggle() {
  const { lang, setLang } = useI18n();

  return (
    <div className="tabs" role="group" aria-label="Language">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className="tab"
          aria-selected={lang === opt.value}
          onClick={() => setLang(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// Settings surface (grown from a single-panel Preferences modal into a
// sectioned dialog -- see design_brief.md's dated entry on this revision).
// Still a modal overlay reached the same three ways as before (sidebar
// Preferences item, native menu Preferences..., Cmd+,/Ctrl+,), still
// supports light dismiss (backdrop click + Escape) alongside the explicit
// Close button -- only what renders INSIDE changed. Sections:
// General / Voice input / Custom dictionary / Connection. ui.md's
// "General/Account/Privacy at minimum" template is for apps with accounts
// and telemetry; this app has neither, so those two are dropped in favor of
// the sections this app actually has settings for.
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nContext";
import { GeneralSection } from "./GeneralSection";
import { VoiceInputSection } from "./VoiceInputSection";
import { DictionarySection } from "./DictionarySection";
import { ConnectionSection } from "./ConnectionSection";
import "./preferences.css";

type SettingsSection = "voiceInput" | "dictionary" | "general" | "connection";

const SECTIONS: { id: SettingsSection; labelKey: "settingsVoiceInputSection" | "settingsDictionarySection" | "settingsGeneralSection" | "settingsConnectionSection" }[] = [
  { id: "voiceInput", labelKey: "settingsVoiceInputSection" },
  { id: "dictionary", labelKey: "settingsDictionarySection" },
  { id: "general", labelKey: "settingsGeneralSection" },
  { id: "connection", labelKey: "settingsConnectionSection" },
];

export function PreferencesView({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  // Voice input opens by default -- the section most likely to be visited
  // day-to-day (mic/model/language), matching the Amical reference's own
  // default section.
  const [activeSection, setActiveSection] = useState<SettingsSection>("voiceInput");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("preferences")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal settings-modal">
        <div className="settings-header">
          <h2>{t("preferences")}</h2>
          <button type="button" className="btn-link" onClick={onClose}>
            {t("close")}
          </button>
        </div>
        <div className="settings-body">
          <nav className="settings-nav" aria-label={t("preferences")}>
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className="settings-nav-item"
                aria-current={activeSection === section.id ? "page" : undefined}
                onClick={() => setActiveSection(section.id)}
              >
                {t(section.labelKey)}
              </button>
            ))}
          </nav>
          <div className="settings-panel">
            {activeSection === "voiceInput" && <VoiceInputSection />}
            {activeSection === "dictionary" && <DictionarySection />}
            {activeSection === "general" && <GeneralSection />}
            {activeSection === "connection" && <ConnectionSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

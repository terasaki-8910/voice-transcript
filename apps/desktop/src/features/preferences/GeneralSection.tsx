// Settings > General. Just the one existing display preference for now --
// UI language and theme already have dedicated, more-discoverable controls
// in the sidebar footer (LanguageToggle/ThemeToggle); duplicating them here
// too would be exactly the "scattered redundant controls" ui.md warns
// against, not an improvement.
import { useI18n } from "../../i18n/I18nContext";
import { useDisplayPreferences } from "./DisplayPreferencesContext";

export function GeneralSection() {
  const { t } = useI18n();
  const { breakAtPeriod, setBreakAtPeriod } = useDisplayPreferences();

  return (
    <div className="settings-section">
      <label className="modal-checkbox-row">
        <input type="checkbox" checked={breakAtPeriod} onChange={(e) => setBreakAtPeriod(e.target.checked)} />
        {t("breakAtPeriodLabel")}
      </label>
    </div>
  );
}

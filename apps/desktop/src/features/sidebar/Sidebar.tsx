// Sidebar layout redesign (2026-07-19): replaces the old top toolbar
// (QueueView's <header className="toolbar">). Owns the app's whole nav
// surface -- brand, "Add files" (the one primary action,
// design_brief.md > Do), transcript search, the Queue/History/Preferences
// nav, and the theme/language toggles -- plus the sidebar-follow-up items:
// collapse-to-rail, and History back/forward (which navigate the sequence
// of individually-opened "View" entries via HistoryNavContext, not this
// component's own nav list -- see HistoryNavContext.tsx).
//
// Sidebar polish (2026-07-19): useAutoCollapse forces isCollapsed to follow
// the window width at the moment it crosses 640px (either direction), on
// top of the manual toggle button below -- see useAutoCollapse.ts for why
// it's crossing-only rather than a continuous constraint.
import { useState } from "react";
import { FiPlus, FiInbox, FiClock, FiSettings, FiSearch, FiSidebar, FiChevronLeft, FiChevronRight } from "react-icons/fi";
import { useI18n } from "../../i18n/I18nContext";
import { useNav } from "../nav/NavContext";
import { useHistory } from "../history/HistoryContext";
import { useHistoryNav } from "../history/HistoryNavContext";
import { useQueue } from "../queue/QueueContext";
import { pickFiles } from "../../lib/tauri";
import { ThemeToggle } from "../../theme/ThemeToggle";
import { LanguageToggle } from "../../i18n/LanguageToggle";
import { useAutoCollapse, isNarrowWindow } from "./useAutoCollapse";
import "./sidebar.css";

interface SidebarProps {
  preferencesOpen: boolean;
  onOpenPreferences: () => void;
}

export function Sidebar({ preferencesOpen, onOpenPreferences }: SidebarProps) {
  const { t } = useI18n();
  const { activeTab, setActiveTab } = useNav();
  const { searchQuery, setSearchQuery } = useHistory();
  const { canGoBack, canGoForward, back, forward } = useHistoryNav();
  const { addFiles } = useQueue();
  const [isCollapsed, setIsCollapsed] = useState(isNarrowWindow);
  useAutoCollapse(setIsCollapsed);

  const handleAddFiles = async () => {
    const paths = await pickFiles();
    if (paths.length > 0) addFiles(paths);
  };

  return (
    <aside className={`sidebar${isCollapsed ? " is-collapsed" : ""}`}>
      <div className="sidebar-header">
        <div className="sidebar-topbar">
          <button
            type="button"
            className="icon-toggle"
            aria-label={t("toggleSidebar")}
            title={t("toggleSidebar")}
            onClick={() => setIsCollapsed((v) => !v)}
          >
            <FiSidebar aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-toggle"
            aria-label={t("back")}
            title={t("back")}
            disabled={!canGoBack}
            onClick={back}
          >
            <FiChevronLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-toggle"
            aria-label={t("forward")}
            title={t("forward")}
            disabled={!canGoForward}
            onClick={forward}
          >
            <FiChevronRight aria-hidden="true" />
          </button>
        </div>
        <p className="brand">Voice Transcript</p>
      </div>

      <button type="button" className="btn-primary sidebar-create" onClick={() => void handleAddFiles()}>
        <FiPlus className="sidebar-nav-icon" aria-hidden="true" />
        <span>{t("addFiles")}</span>
      </button>

      <div className="sidebar-search">
        <FiSearch aria-hidden="true" />
        <input
          type="text"
          aria-label={t("searchTranscripts")}
          placeholder={t("searchTranscripts")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <nav className="sidebar-nav" aria-label="Main">
        <button
          type="button"
          className="sidebar-nav-item"
          aria-current={!preferencesOpen && activeTab === "queue" ? "page" : undefined}
          onClick={() => setActiveTab("queue")}
        >
          <FiInbox className="sidebar-nav-icon" aria-hidden="true" />
          <span>{t("queue")}</span>
        </button>
        <button
          type="button"
          className="sidebar-nav-item"
          aria-current={!preferencesOpen && activeTab === "history" ? "page" : undefined}
          onClick={() => setActiveTab("history")}
        >
          <FiClock className="sidebar-nav-icon" aria-hidden="true" />
          <span>{t("history")}</span>
        </button>
        <button
          type="button"
          className="sidebar-nav-item"
          aria-current={preferencesOpen ? "page" : undefined}
          onClick={onOpenPreferences}
        >
          <FiSettings className="sidebar-nav-icon" aria-hidden="true" />
          <span>{t("preferences")}</span>
        </button>
      </nav>

      <div className="sidebar-footer">
        <div className="settings">
          <ThemeToggle />
          <LanguageToggle />
        </div>
      </div>
    </aside>
  );
}

// F17 (gui-queue) / F18 (gui-history) / F21 (native-menu). The primary
// screen: matches design/reference-screen.html (approved at the design
// gate). Composes the toolbar started by F20 (theme toggle) and F19
// (language toggle) -- adds the Queue/History tabs and the "Add files"
// primary action, which stays visible at all times regardless of queue
// state (design_brief.md > Do). The History tab switches views immediately
// even with zero history entries (HistoryView renders its own empty state)
// -- it must never be `disabled`; design-gate feedback was explicit that a
// data-less tab still has to respond, not sit inert until data exists.
// activeTab moved to NavContext (F21) so the native menu's "Open history"
// item can switch tabs from outside this component too.
import { useI18n } from "../../i18n/I18nContext";
import { ThemeToggle } from "../../theme/ThemeToggle";
import { LanguageToggle } from "../../i18n/LanguageToggle";
import { pickFiles } from "../../lib/tauri";
import { useQueue } from "./QueueContext";
import { QueueRow } from "./QueueRow";
import { useDragDrop } from "./useDragDrop";
import { HistoryView } from "../history/HistoryView";
import { useNav } from "../nav/NavContext";
import "./queue.css";

export function QueueView() {
  const { t } = useI18n();
  const { items, addFiles } = useQueue();
  const { isDragging } = useDragDrop(addFiles);
  const { activeTab, setActiveTab } = useNav();

  const handleAddFiles = async () => {
    const paths = await pickFiles();
    if (paths.length > 0) addFiles(paths);
  };

  return (
    <div className="app">
      <header className="toolbar">
        <p className="brand">Voice Transcript</p>
        <div className="tabs" role="tablist" aria-label="View">
          <button
            type="button"
            className="tab"
            role="tab"
            aria-selected={activeTab === "queue"}
            onClick={() => setActiveTab("queue")}
          >
            {t("queue")}
          </button>
          <button
            type="button"
            className="tab"
            role="tab"
            aria-selected={activeTab === "history"}
            onClick={() => setActiveTab("history")}
          >
            {t("history")}
          </button>
        </div>
        <div className="spacer" />
        <div className="settings">
          <ThemeToggle />
          <LanguageToggle />
        </div>
        <button type="button" className="btn-primary" onClick={handleAddFiles}>
          {t("addFiles")}
        </button>
      </header>

      {activeTab === "queue" ? (
        <main className="queue" aria-label="Transcription queue">
          <div className={`drop-zone${isDragging ? " is-dragging" : ""}`}>{t("dropHint")}</div>
          {items.length === 0 ? (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-ink-muted)", textAlign: "center" }}>
              {t("emptyQueue")}
            </p>
          ) : (
            items.map((item) => <QueueRow key={item.id} item={item} />)
          )}
        </main>
      ) : (
        <main className="queue" aria-label="Transcription history">
          <HistoryView />
        </main>
      )}
    </div>
  );
}

// F17 (gui-queue). The primary screen: matches design/reference-screen.html
// (approved at the design gate). Composes the toolbar started by F20
// (theme toggle) and F19 (language toggle) -- adds the Queue/History tabs
// and the "Add files" primary action, which stays visible at all times
// regardless of queue state (design_brief.md > Do).
import { useI18n } from "../../i18n/I18nContext";
import { ThemeToggle } from "../../theme/ThemeToggle";
import { LanguageToggle } from "../../i18n/LanguageToggle";
import { pickFiles } from "../../lib/tauri";
import { useQueue } from "./QueueContext";
import { QueueRow } from "./QueueRow";
import { useDragDrop } from "./useDragDrop";
import "./queue.css";

export function QueueView() {
  const { t } = useI18n();
  const { items, addFiles } = useQueue();
  const { isDragging } = useDragDrop(addFiles);

  const handleAddFiles = async () => {
    const paths = await pickFiles();
    if (paths.length > 0) addFiles(paths);
  };

  return (
    <div className="app">
      <header className="toolbar">
        <p className="brand">Voice Transcript</p>
        <div className="tabs" role="tablist" aria-label="View">
          <button type="button" className="tab" role="tab" aria-selected="true">
            {t("queue")}
          </button>
          <button type="button" className="tab" role="tab" aria-selected="false" disabled title="Coming soon">
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
    </div>
  );
}

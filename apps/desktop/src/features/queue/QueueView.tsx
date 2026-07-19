// F17 (gui-queue) / F18 (gui-history). The content pane: matches
// design/reference-screen.html's <main class="queue"> (approved at the
// design gate). Renders whichever of Queue/History is active -- the History
// tab switches views immediately even with zero history entries (HistoryView
// renders its own empty state) -- it must never be blocked on data existing.
// activeTab lives in NavContext (F21) so the native menu's "Open history"
// item, and the sidebar's back/forward navigation (HistoryNavContext), can
// switch tabs from outside this component too.
//
// Sidebar redesign (2026-07-19): nav, "Add files", and the theme/language
// toggles all moved out to Sidebar.tsx -- this component is now pure content.
import { useI18n } from "../../i18n/I18nContext";
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
  const { activeTab } = useNav();

  if (activeTab === "history") {
    return (
      <main className="queue" aria-label="Transcription history">
        <HistoryView />
      </main>
    );
  }

  return (
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
  );
}

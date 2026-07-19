// F18 (gui-history). Renders whatever state HistoryContext is in --
// including the empty state, which is the direct fix for the design-gate
// feedback that the History tab must respond (switch views) even when
// there's no history yet, not stay inert until data exists.
//
// Sidebar follow-up (2026-07-19): filters `items` by HistoryContext's
// searchQuery (set from the sidebar's search input) before rendering --
// `items` itself stays the full unfiltered list, since trash()/remove()
// and the sync-error/empty checks below all need the real count, not the
// filtered one.
import { useMemo } from "react";
import { useI18n } from "../../i18n/I18nContext";
import { useHistory } from "./HistoryContext";
import { HistoryRow } from "./HistoryRow";
import { basename } from "../../lib/path";

export function HistoryView() {
  const { t } = useI18n();
  const { items, status, error, syncError, searchQuery, trashedIds } = useHistory();

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return items;
    return items.filter(
      (item) =>
        basename(item.sourceFileName).toLowerCase().includes(query) ||
        item.transcriptText?.toLowerCase().includes(query),
    );
  }, [items, searchQuery]);

  const statusText: Record<"loading" | "error", string> = {
    loading: t("historyLoading"),
    error: error ?? t("historyLoading"),
  };

  if (status === "loading" || status === "error") {
    return (
      <p style={{ fontSize: "var(--text-sm)", color: "var(--color-ink-muted)", textAlign: "center" }}>
        {statusText[status]}
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p style={{ fontSize: "var(--text-sm)", color: "var(--color-ink-muted)", textAlign: "center" }}>
        {t("historyEmpty")}
      </p>
    );
  }

  return (
    <>
      {/* A failed background refresh with a list already showing (cached or
          last-good) is a small, non-blocking notice -- never replaces the
          list itself, which is still perfectly valid data. */}
      {syncError && <p className="row-meta fail-reason">{t("historySyncError")}</p>}
      {filteredItems.length === 0 ? (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-ink-muted)", textAlign: "center" }}>
          {t("historyNoResults")}
        </p>
      ) : (
        filteredItems.map((item) => (
          <HistoryRow key={item.id} item={item} audioTrashed={trashedIds.has(item.id)} />
        ))
      )}
    </>
  );
}

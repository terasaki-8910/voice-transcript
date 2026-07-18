// F18 (gui-history). Renders whatever state HistoryContext is in --
// including the empty state, which is the direct fix for the design-gate
// feedback that the History tab must respond (switch views) even when
// there's no history yet, not stay inert until data exists.
import { useI18n } from "../../i18n/I18nContext";
import { useHistory } from "./HistoryContext";
import { HistoryRow } from "./HistoryRow";

export function HistoryView() {
  const { t } = useI18n();
  const { items, status, error, syncError, trashedIds } = useHistory();

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
      {items.map((item) => (
        <HistoryRow key={item.id} item={item} audioTrashed={trashedIds.has(item.id)} />
      ))}
    </>
  );
}

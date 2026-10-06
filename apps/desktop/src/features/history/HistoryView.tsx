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
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nContext";
import { useHistory } from "./HistoryContext";
import { HistoryRow } from "./HistoryRow";
import { HistoryBulkBar } from "./HistoryBulkBar";
import { rangeIds } from "./bulkSelection";
import { basename } from "../../lib/path";

export function HistoryView() {
  const { t } = useI18n();
  const { items, status, error, syncError, searchQuery, trashedIds, requestRefresh } = useHistory();

  // QueueView mounts this only while the History tab is active, so this is
  // "the user opened History" -- picks up rows written elsewhere (another
  // window, another machine, the CLI) since the last fetch.
  useEffect(() => {
    requestRefresh();
  }, [requestRefresh]);

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return items;
    return items.filter(
      (item) =>
        basename(item.sourceFileName).toLowerCase().includes(query) ||
        item.transcriptText?.toLowerCase().includes(query),
    );
  }, [items, searchQuery]);

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(() => new Set());
  const anchorRef = useRef<number | undefined>(undefined);

  // Entries that disappear (deleted here, or gone after a refresh) leave the selection.
  useEffect(() => {
    setSelectedIds((prev) => {
      const alive = new Set(items.map((item) => item.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  // A new search clears the selection, so a bulk action never reaches rows the
  // user can no longer see.
  useEffect(() => {
    setSelectedIds(new Set());
    anchorRef.current = undefined;
  }, [searchQuery]);

  const visibleIds = useMemo(() => filteredItems.map((item) => item.id), [filteredItems]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const selectedItems = useMemo(() => items.filter((item) => selectedIds.has(item.id)), [items, selectedIds]);

  // Shift+click applies the clicked row's new state to every row between it
  // and the last row clicked (the anchor), in the order the list shows.
  const toggleRow = (id: number, shiftKey: boolean) => {
    const select = !selectedIds.has(id);
    const anchor = anchorRef.current;
    const ids = shiftKey && anchor !== undefined ? rangeIds(visibleIds, anchor, id) : [id];
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const target of ids) {
        if (select) next.add(target);
        else next.delete(target);
      }
      return next;
    });
    anchorRef.current = id;
  };

  const toggleAll = () => {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(visibleIds));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    anchorRef.current = undefined;
  };

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
      {items.length > 0 && (
        <HistoryBulkBar
          selected={selectedItems}
          visibleCount={visibleIds.length}
          allVisibleSelected={allVisibleSelected}
          onToggleAll={toggleAll}
          onClear={clearSelection}
        />
      )}
      {/* A failed background refresh with a list already showing (cached or
          last-good) is a small, non-blocking notice -- never replaces the
          list itself, which is still perfectly valid data. The real
          underlying error (syncError itself, e.g. "connect ETIMEDOUT
          ...", "password authentication failed ...") is shown alongside
          the static reassurance line, not swallowed by it -- previously
          only the generic text rendered, discarding the one piece of
          information that could actually explain what's wrong
          (user-reported, 2026-09-30: Tailscale was up, the DB port was
          reachable, and there was still no way to see why the connection
          itself was failing). See also Settings > Connection's "Test
          connection" button (ConnectionSection.tsx) for checking this
          proactively rather than only after a failed refresh. */}
      {syncError && (
        <>
          <p className="row-meta fail-reason">{t("historySyncError")}</p>
          <p className="row-meta fail-reason">{syncError}</p>
        </>
      )}
      {filteredItems.length === 0 ? (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-ink-muted)", textAlign: "center" }}>
          {t("historyNoResults")}
        </p>
      ) : (
        filteredItems.map((item) => (
          <HistoryRow
            key={item.id}
            item={item}
            audioTrashed={trashedIds.has(item.id)}
            selected={selectedIds.has(item.id)}
            onToggleSelect={(shiftKey) => toggleRow(item.id, shiftKey)}
          />
        ))
      )}
    </>
  );
}

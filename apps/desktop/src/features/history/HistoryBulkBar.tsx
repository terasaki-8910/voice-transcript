// Bulk actions for the checked History entries (SPEC.md > Transcription
// history). Each action reuses the same functions a single row uses --
// trash()/remove() from HistoryContext, copyToClipboard/exportTranscript from
// lib/tauri -- so confirmation and per-row error reporting stay consistent.
// Runs one entry at a time: each remove()/trash() updates the shared list.
// The two destructive actions sit behind one menu button (the same pattern as
// a row's Delete button), not as two always-visible icons.
import { useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { FiCopy, FiDownload, FiX } from "react-icons/fi";
import { useI18n } from "../../i18n/I18nContext";
import { useHistory } from "./HistoryContext";
import { DeleteMenu } from "./HistoryRow";
import type { HistoryEntry } from "../../lib/tauri";
import { copyToClipboard, exportTranscript, pickSavePath } from "../../lib/tauri";
import { basename } from "../../lib/path";
import { formatBulkTranscripts } from "./bulkSelection";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function displayName(item: HistoryEntry): string {
  return item.title ?? basename(item.sourceFileName);
}

export function HistoryBulkBar({
  selected,
  visibleCount,
  allVisibleSelected,
  onToggleAll,
  onClear,
}: {
  selected: HistoryEntry[];
  visibleCount: number;
  allVisibleSelected: boolean;
  onToggleAll: () => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const { trashedIds, remove, trash } = useHistory();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const count = selected.length;
  const hasSelection = count > 0;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const transcriptEntries = () =>
    selected.flatMap((item) =>
      item.transcriptText ? [{ name: displayName(item), text: item.transcriptText }] : [],
    );

  const handleCopy = () =>
    run(async () => {
      const entries = transcriptEntries();
      if (entries.length === 0) return;
      await copyToClipboard(formatBulkTranscripts(entries));
    });

  const handleExport = () =>
    run(async () => {
      const entries = transcriptEntries();
      if (entries.length === 0) return;
      const path = await pickSavePath("transcripts.txt");
      if (!path) return;
      await exportTranscript(path, formatBulkTranscripts(entries));
    });

  const handleTrashAudio = () =>
    run(async () => {
      const targets = selected.filter((item) => !trashedIds.has(item.id));
      if (targets.length === 0) return;
      const confirmed = await confirm(t("confirmBulkTrashBody").replace("{count}", String(targets.length)), {
        title: t("bulkTrashAudio"),
        kind: "warning",
      });
      if (!confirmed) return;
      for (const item of targets) {
        await trash(item.id);
      }
    });

  const handleDelete = () =>
    run(async () => {
      if (!hasSelection) return;
      const confirmed = await confirm(t("confirmBulkDeleteBody").replace("{count}", String(count)), {
        title: t("bulkDelete"),
        kind: "warning",
      });
      if (!confirmed) return;
      for (const item of selected) {
        await remove(item.id);
      }
    });

  return (
    <div className="history-bulk-bar" role="toolbar" aria-label={t("bulkToolbarLabel")}>
      <label className="history-bulk-select">
        <input
          type="checkbox"
          checked={allVisibleSelected}
          disabled={visibleCount === 0}
          onChange={onToggleAll}
        />
        <span>{hasSelection ? t("selectedCount").replace("{count}", String(count)) : t("selectAllEntries")}</span>
      </label>
      <div className="history-bulk-actions">
        <button
          type="button"
          className="icon-btn"
          title={t("bulkCopy")}
          aria-label={t("bulkCopy")}
          disabled={busy || !hasSelection}
          onClick={() => void handleCopy()}
        >
          <FiCopy aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={t("bulkExport")}
          aria-label={t("bulkExport")}
          disabled={busy || !hasSelection}
          onClick={() => void handleExport()}
        >
          <FiDownload aria-hidden="true" />
        </button>
        <DeleteMenu
          audioTrashed={false}
          onTrash={() => void handleTrashAudio()}
          onDelete={() => void handleDelete()}
          triggerLabel={t("bulkRemove")}
          trashLabel={t("bulkTrashAudio")}
          deleteLabel={t("bulkDelete")}
        />
        <button
          type="button"
          className="icon-btn"
          title={t("clearSelection")}
          aria-label={t("clearSelection")}
          disabled={!hasSelection}
          onClick={onClear}
        >
          <FiX aria-hidden="true" />
        </button>
      </div>
      {message && <p className="row-meta fail-reason" role="alert">{message}</p>}
    </div>
  );
}

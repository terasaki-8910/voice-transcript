// Pure helpers for multi-select in the History list. Kept free of React and
// Tauri imports so the range and copy-format rules can be unit-tested directly.

// Shift+click selects everything between the last clicked row and this one, in
// the order the list is showing. Falls back to just the target if either row
// is no longer visible (filtered out or deleted since the anchor was set).
export function rangeIds(visibleIds: readonly number[], anchorId: number, targetId: number): number[] {
  const from = visibleIds.indexOf(anchorId);
  const to = visibleIds.indexOf(targetId);
  if (from === -1 || to === -1) return [targetId];
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  return visibleIds.slice(start, end + 1);
}

export function formatBulkTranscripts(entries: readonly { name: string; text: string }[]): string {
  return entries.map((entry) => `${entry.name}\n\n${entry.text}`).join("\n\n---\n\n");
}

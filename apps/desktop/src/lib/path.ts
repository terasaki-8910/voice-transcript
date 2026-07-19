// Shared by HistoryRow (display) and HistoryView (search filtering) --
// moved out of HistoryRow so both use the same definition, not a
// hand-duplicated copy that could drift.
export function basename(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

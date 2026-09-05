// Display-only formatting: breaks long lines visually after each Japanese full-width period.
// Export and copy actions must always use the original, unmodified text, never this output.
export function breakAfterJapanesePeriod(text: string): string {
  return text.replace(/。(?!\n|$)/g, "。\n");
}

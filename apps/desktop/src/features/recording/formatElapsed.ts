// Formats a recording's elapsed seconds as MM:SS, or H:MM:SS once past an
// hour -- recordings have no duration cap (SPEC.md > Microphone recording),
// so the display must scale past 59:59 rather than wrapping/breaking.
export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

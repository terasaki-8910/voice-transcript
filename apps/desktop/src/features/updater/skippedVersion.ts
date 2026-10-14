// "Skip this version" in the update dialog. localStorage-backed like the
// other display preferences -- not a secret. Only one version is ever
// remembered: anything newer than the skipped one is a different version
// and prompts again.
const STORAGE_KEY = "voice-transcript-skipped-update-version";

export function readSkippedVersion(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function writeSkippedVersion(version: string): void {
  window.localStorage.setItem(STORAGE_KEY, version);
}

// The launch-time check stays quiet about the skipped version; a check the
// user starts from Settings always shows what it found.
export function shouldPromptOnLaunch(version: string, skippedVersion: string | null): boolean {
  return version !== skippedVersion;
}

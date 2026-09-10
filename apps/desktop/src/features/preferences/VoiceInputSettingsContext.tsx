// Voice input settings (Settings > Voice input section): Whisper model,
// language auto-detect + override, and the microphone used for recording.
// localStorage-backed like ThemeContext/DisplayPreferencesContext -- none of
// these are secrets, so none needs a Rust round-trip. Unlike those two
// single-value contexts, this one holds several related fields, so it is
// stored as one JSON blob under one key rather than one key per field.
//
// QueueContext reads model/autoDetectLanguage/language from here instead of
// the hardcoded DEFAULT_MODEL it used before -- this is what makes SPEC.md's
// "model/language exposed as GUI controls" promise actually true. Mic
// selection is read by RecordingContext when starting a recording.
import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AudioSource } from "../../lib/tauri";

const STORAGE_KEY = "voice-transcript-voice-input-settings";

// Mirrors packages/core/src/config.ts's two supported models -- not imported
// directly, same "avoid pulling packages/core's runtime into the webview
// bundle for a couple of string constants" reasoning as QueueContext's own
// DEFAULT_MODEL comment.
export type WhisperModel = "whisper-large-v3-turbo" | "whisper-large-v3";
export const WHISPER_MODELS: readonly WhisperModel[] = ["whisper-large-v3-turbo", "whisper-large-v3"];

// A short, curated list -- Groq/Whisper supports far more via ISO-639-1
// codes, but the language override is an escape hatch for when auto-detect
// gets it wrong, not the primary path (mirrors packages/cli/src/args.ts's
// free-form --language flag, just constrained to a picker here).
export interface LanguageOption {
  code: string;
  labelKey: "languageJapanese" | "languageEnglish" | "languageChinese" | "languageKorean" | "languageSpanish" | "languageFrench" | "languageGerman";
}
export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { code: "ja", labelKey: "languageJapanese" },
  { code: "en", labelKey: "languageEnglish" },
  { code: "zh", labelKey: "languageChinese" },
  { code: "ko", labelKey: "languageKorean" },
  { code: "es", labelKey: "languageSpanish" },
  { code: "fr", labelKey: "languageFrench" },
  { code: "de", labelKey: "languageGerman" },
];

// Recording sources, in the order they appear in the picker. "both" mixes
// the microphone and the system's output into one mono track (recording.rs);
// "system" alone is the "transcribe this call/video" case where the room's
// own noise is not wanted.
export interface AudioSourceOption {
  value: AudioSource;
  labelKey: "audioSourceMicrophone" | "audioSourceSystem" | "audioSourceBoth";
}
export const AUDIO_SOURCE_OPTIONS: readonly AudioSourceOption[] = [
  { value: "microphone", labelKey: "audioSourceMicrophone" },
  { value: "system", labelKey: "audioSourceSystem" },
  { value: "both", labelKey: "audioSourceBoth" },
];

export interface VoiceInputSettings {
  model: WhisperModel;
  autoDetectLanguage: boolean;
  language: string;
  audioSource: AudioSource;
  micDeviceId?: string;
  outputDeviceId?: string;
}

const DEFAULT_SETTINGS: VoiceInputSettings = {
  model: "whisper-large-v3-turbo",
  autoDetectLanguage: true,
  language: "ja",
  // Microphone-only stays the default: system capture needs a permission
  // grant on macOS and exists on no Linux build, so it has to be chosen, not
  // inherited by anyone who upgrades into this version.
  audioSource: "microphone",
  micDeviceId: undefined,
  outputDeviceId: undefined,
};

function readStoredSettings(): VoiceInputSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<VoiceInputSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface VoiceInputSettingsContextValue extends VoiceInputSettings {
  setSettings: (next: Partial<VoiceInputSettings>) => void;
}

const VoiceInputSettingsContext = createContext<VoiceInputSettingsContextValue | null>(null);

export function VoiceInputSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<VoiceInputSettings>(() => readStoredSettings());

  const setSettings = (next: Partial<VoiceInputSettings>) => {
    setSettingsState((prev) => {
      const merged = { ...prev, ...next };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      return merged;
    });
  };

  const value = useMemo<VoiceInputSettingsContextValue>(() => ({ ...settings, setSettings }), [settings]);

  return <VoiceInputSettingsContext.Provider value={value}>{children}</VoiceInputSettingsContext.Provider>;
}

export function useVoiceInputSettings(): VoiceInputSettingsContextValue {
  const ctx = useContext(VoiceInputSettingsContext);
  if (!ctx) {
    throw new Error("useVoiceInputSettings must be used within a VoiceInputSettingsProvider");
  }
  return ctx;
}

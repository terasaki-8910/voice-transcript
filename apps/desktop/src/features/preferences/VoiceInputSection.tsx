// Settings > Voice input. Model/language become the queue's actual defaults
// (QueueContext.tsx) -- ACCEPTANCE G12, closing the gap where the GUI used
// to hardcode whisper-large-v3-turbo and never sent a language at all. Mic
// selection feeds RecordingContext's start_recording call.
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nContext";
import { useVoiceInputSettings, WHISPER_MODELS, LANGUAGE_OPTIONS } from "./VoiceInputSettingsContext";
import type { WhisperModel } from "./VoiceInputSettingsContext";
import { listInputDevices } from "../../lib/tauri";
import type { InputDevice } from "../../lib/tauri";

const MODEL_LABEL_KEYS: Record<WhisperModel, "modelTurbo" | "modelLargeV3"> = {
  "whisper-large-v3-turbo": "modelTurbo",
  "whisper-large-v3": "modelLargeV3",
};

export function VoiceInputSection() {
  const { t } = useI18n();
  const { model, autoDetectLanguage, language, micDeviceId, setSettings } = useVoiceInputSettings();
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [devicesError, setDevicesError] = useState<string>();

  useEffect(() => {
    listInputDevices()
      .then(setDevices)
      .catch((err: unknown) => setDevicesError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div className="settings-section">
      <label htmlFor="voice-input-model">
        {t("voiceInputModelLabel")}
        <select
          id="voice-input-model"
          value={model}
          onChange={(e) => setSettings({ model: e.target.value as WhisperModel })}
        >
          {WHISPER_MODELS.map((m) => (
            <option key={m} value={m}>
              {t(MODEL_LABEL_KEYS[m])}
            </option>
          ))}
        </select>
      </label>

      <hr className="modal-divider" />

      <label className="modal-checkbox-row">
        <input
          type="checkbox"
          checked={autoDetectLanguage}
          onChange={(e) => setSettings({ autoDetectLanguage: e.target.checked })}
        />
        {t("voiceInputAutoDetect")}
      </label>
      <p className="settings-hint">{t("voiceInputAutoDetectDescription")}</p>
      <label htmlFor="voice-input-language">
        {t("voiceInputLanguageLabel")}
        <select
          id="voice-input-language"
          value={language}
          disabled={autoDetectLanguage}
          onChange={(e) => setSettings({ language: e.target.value })}
        >
          {LANGUAGE_OPTIONS.map((opt) => (
            <option key={opt.code} value={opt.code}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>
      </label>

      <hr className="modal-divider" />

      <label htmlFor="voice-input-mic">
        {t("voiceInputMicLabel")}
        <select
          id="voice-input-mic"
          value={micDeviceId ?? ""}
          onChange={(e) => setSettings({ micDeviceId: e.target.value || undefined })}
        >
          <option value="">{t("voiceInputMicDefault")}</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <p className="settings-hint">{t("voiceInputMicDescription")}</p>
      {devicesError && <p className="fail-reason">{devicesError}</p>}
    </div>
  );
}

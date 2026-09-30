// Settings > Voice input. Model/language become the queue's actual defaults
// (QueueContext.tsx) -- ACCEPTANCE G12, closing the gap where the GUI used
// to hardcode whisper-large-v3-turbo and never sent a language at all. Audio
// source, mic and output selection feed RecordingContext's start_recording
// call.
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nContext";
import {
  useVoiceInputSettings,
  WHISPER_MODELS,
  LANGUAGE_OPTIONS,
  AUDIO_SOURCE_OPTIONS,
} from "./VoiceInputSettingsContext";
import type { WhisperModel } from "./VoiceInputSettingsContext";
import { listInputDevices, listOutputDevices } from "../../lib/tauri";
import type { AudioSource, InputDevice } from "../../lib/tauri";

const MODEL_LABEL_KEYS: Record<WhisperModel, "modelTurbo" | "modelLargeV3"> = {
  "whisper-large-v3-turbo": "modelTurbo",
  "whisper-large-v3": "modelLargeV3",
};

export function VoiceInputSection() {
  const { t } = useI18n();
  const {
    model,
    autoDetectLanguage,
    language,
    audioSource,
    micDeviceId,
    outputDeviceId,
    autoTrashRecordings,
    setSettings,
  } = useVoiceInputSettings();
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [devicesError, setDevicesError] = useState<string>();
  // Rust returns an empty list on platforms with no loopback path (Linux),
  // which is how the GUI knows to say so rather than offering a picker that
  // could never work. Undefined means "not asked yet".
  const [outputDevices, setOutputDevices] = useState<InputDevice[]>();

  useEffect(() => {
    listInputDevices()
      .then(setDevices)
      .catch((err: unknown) => setDevicesError(err instanceof Error ? err.message : String(err)));
    listOutputDevices()
      .then(setOutputDevices)
      .catch(() => setOutputDevices([]));
  }, []);

  const capturesSystem = audioSource === "system" || audioSource === "both";
  const systemUnavailable = outputDevices !== undefined && outputDevices.length === 0;

  return (
    <div className="settings-section">
      <label htmlFor="voice-input-model">
        {t("voiceInputModelLabel")}
        <span className="select-wrap">
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
        </span>
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
        <span className="select-wrap">
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
        </span>
      </label>

      <hr className="modal-divider" />

      <label htmlFor="voice-input-source">
        {t("voiceInputSourceLabel")}
        <span className="select-wrap">
          <select
            id="voice-input-source"
            value={audioSource}
            onChange={(e) => setSettings({ audioSource: e.target.value as AudioSource })}
          >
            {AUDIO_SOURCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.value !== "microphone" && systemUnavailable}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </span>
      </label>
      <p className="settings-hint">
        {systemUnavailable ? t("voiceInputSystemUnavailable") : t("voiceInputSourceDescription")}
      </p>

      <label htmlFor="voice-input-mic">
        {t("voiceInputMicLabel")}
        <span className="select-wrap">
          <select
            id="voice-input-mic"
            value={micDeviceId ?? ""}
            disabled={audioSource === "system"}
            onChange={(e) => setSettings({ micDeviceId: e.target.value || undefined })}
          >
            <option value="">{t("voiceInputMicDefault")}</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </span>
      </label>
      <p className="settings-hint">{t("voiceInputMicDescription")}</p>
      {devicesError && <p className="fail-reason">{devicesError}</p>}

      {capturesSystem && !systemUnavailable && (
        <>
          <label htmlFor="voice-input-output">
            {t("voiceInputOutputLabel")}
            <span className="select-wrap">
              <select
                id="voice-input-output"
                value={outputDeviceId ?? ""}
                onChange={(e) => setSettings({ outputDeviceId: e.target.value || undefined })}
              >
                <option value="">{t("voiceInputOutputDefault")}</option>
                {(outputDevices ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <p className="settings-hint">{t("voiceInputOutputDescription")}</p>
        </>
      )}

      <hr className="modal-divider" />

      <label className="modal-checkbox-row">
        <input
          type="checkbox"
          checked={autoTrashRecordings}
          onChange={(e) => setSettings({ autoTrashRecordings: e.target.checked })}
        />
        {t("voiceInputAutoTrashRecordings")}
      </label>
      <p className="settings-hint">{t("voiceInputAutoTrashRecordingsDescription")}</p>
    </div>
  );
}

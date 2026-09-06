// Settings > Voice input (ACCEPTANCE G12). Pins that changing model/
// language/mic here actually updates VoiceInputSettingsContext -- the
// context this app's QueueContext/RecordingContext read from, not just that
// the controls render.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { VoiceInputSettingsProvider, useVoiceInputSettings } from "../../src/features/preferences/VoiceInputSettingsContext";
import { VoiceInputSection } from "../../src/features/preferences/VoiceInputSection";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

function SettingsProbe() {
  const { model, autoDetectLanguage, language, micDeviceId } = useVoiceInputSettings();
  return (
    <div>
      <p data-testid="probe-model">{model}</p>
      <p data-testid="probe-auto-detect">{String(autoDetectLanguage)}</p>
      <p data-testid="probe-language">{language}</p>
      <p data-testid="probe-mic">{micDeviceId ?? ""}</p>
    </div>
  );
}

function renderSection() {
  return render(
    <I18nProvider>
      <VoiceInputSettingsProvider>
        <SettingsProbe />
        <VoiceInputSection />
      </VoiceInputSettingsProvider>
    </I18nProvider>,
  );
}

describe("VoiceInputSection", () => {
  beforeEach(() => {
    invoke.mockReset();
    window.localStorage.clear();
  });

  it("changing the model updates VoiceInputSettingsContext", async () => {
    invoke.mockResolvedValueOnce([]); // list_input_devices
    renderSection();
    await waitFor(() => expect(screen.getByLabelText("Model")).toBeDefined());

    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "whisper-large-v3" } });
    expect(screen.getByTestId("probe-model").textContent).toBe("whisper-large-v3");
  });

  it("defaults to auto-detect on, with the language override disabled", async () => {
    invoke.mockResolvedValueOnce([]);
    renderSection();
    await waitFor(() => expect(screen.getByLabelText("Auto-detect language")).toBeDefined());

    expect(screen.getByLabelText("Auto-detect language")).toHaveProperty("checked", true);
    expect(screen.getByLabelText("Language")).toHaveProperty("disabled", true);
  });

  it("turning off auto-detect enables the language override and changing it updates the context", async () => {
    invoke.mockResolvedValueOnce([]);
    renderSection();
    await waitFor(() => expect(screen.getByLabelText("Auto-detect language")).toBeDefined());

    fireEvent.click(screen.getByLabelText("Auto-detect language"));
    expect(screen.getByTestId("probe-auto-detect").textContent).toBe("false");
    expect(screen.getByLabelText("Language")).toHaveProperty("disabled", false);

    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "en" } });
    expect(screen.getByTestId("probe-language").textContent).toBe("en");
  });

  it("lists microphones returned by list_input_devices and selecting one updates the context", async () => {
    invoke.mockResolvedValueOnce([
      { id: "mic-1", name: "Built-in Microphone" },
      { id: "mic-2", name: "USB Mic" },
    ]);
    renderSection();

    await waitFor(() => expect(screen.getByText("USB Mic")).toBeDefined());
    fireEvent.change(screen.getByLabelText("Microphone"), { target: { value: "mic-2" } });
    expect(screen.getByTestId("probe-mic").textContent).toBe("mic-2");
  });

  it("shows an inline error if the device list fails to load, without crashing the section", async () => {
    invoke.mockRejectedValueOnce(new Error("failed to enumerate input devices"));
    renderSection();

    await waitFor(() => expect(screen.getByText("failed to enumerate input devices")).toBeDefined());
    // The rest of the section is still usable.
    expect(screen.getByLabelText("Model")).toBeDefined();
  });
});

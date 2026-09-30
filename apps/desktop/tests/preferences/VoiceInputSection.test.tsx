// Settings > Voice input (ACCEPTANCE G12). Pins that changing model/
// language/audio source/devices here actually updates
// VoiceInputSettingsContext -- the context this app's QueueContext/
// RecordingContext read from, not just that the controls render.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { VoiceInputSettingsProvider, useVoiceInputSettings } from "../../src/features/preferences/VoiceInputSettingsContext";
import { VoiceInputSection } from "../../src/features/preferences/VoiceInputSection";

// Routed by command name rather than call order: the section fires
// list_input_devices and list_output_devices from the same effect, and a
// once-per-call queue would bind whichever happened to land first.
const inputDevices = vi.fn<() => Promise<unknown>>();
const outputDevices = vi.fn<() => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string) => {
    if (command === "list_input_devices") return inputDevices();
    if (command === "list_output_devices") return outputDevices();
    throw new Error(`unexpected command: ${command}`);
  },
}));

function SettingsProbe() {
  const { model, autoDetectLanguage, language, audioSource, micDeviceId, outputDeviceId, autoTrashRecordings } =
    useVoiceInputSettings();
  return (
    <div>
      <p data-testid="probe-model">{model}</p>
      <p data-testid="probe-auto-detect">{String(autoDetectLanguage)}</p>
      <p data-testid="probe-language">{language}</p>
      <p data-testid="probe-source">{audioSource}</p>
      <p data-testid="probe-mic">{micDeviceId ?? ""}</p>
      <p data-testid="probe-output">{outputDeviceId ?? ""}</p>
      <p data-testid="probe-auto-trash">{String(autoTrashRecordings)}</p>
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
    inputDevices.mockReset().mockResolvedValue([]);
    outputDevices.mockReset().mockResolvedValue([{ id: "out-1", name: "MacBook Pro Speakers" }]);
    window.localStorage.clear();
  });

  it("changing the model updates VoiceInputSettingsContext", async () => {
    renderSection();
    await waitFor(() => expect(screen.getByLabelText("Model")).toBeDefined());

    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "whisper-large-v3" } });
    expect(screen.getByTestId("probe-model").textContent).toBe("whisper-large-v3");
  });

  it("defaults to auto-detect on, with the language override disabled", async () => {
    renderSection();
    await waitFor(() => expect(screen.getByLabelText("Auto-detect language")).toBeDefined());

    expect(screen.getByLabelText("Auto-detect language")).toHaveProperty("checked", true);
    expect(screen.getByLabelText("Language")).toHaveProperty("disabled", true);
  });

  it("turning off auto-detect enables the language override and changing it updates the context", async () => {
    renderSection();
    await waitFor(() => expect(screen.getByLabelText("Auto-detect language")).toBeDefined());

    fireEvent.click(screen.getByLabelText("Auto-detect language"));
    expect(screen.getByTestId("probe-auto-detect").textContent).toBe("false");
    expect(screen.getByLabelText("Language")).toHaveProperty("disabled", false);

    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "en" } });
    expect(screen.getByTestId("probe-language").textContent).toBe("en");
  });

  it("lists microphones returned by list_input_devices and selecting one updates the context", async () => {
    inputDevices.mockResolvedValue([
      { id: "mic-1", name: "Built-in Microphone" },
      { id: "mic-2", name: "USB Mic" },
    ]);
    renderSection();

    await waitFor(() => expect(screen.getByText("USB Mic")).toBeDefined());
    fireEvent.change(screen.getByLabelText("Microphone"), { target: { value: "mic-2" } });
    expect(screen.getByTestId("probe-mic").textContent).toBe("mic-2");
  });

  it("defaults to microphone-only and hides the output picker until system audio is chosen", async () => {
    renderSection();
    await waitFor(() => expect(screen.getByLabelText("Audio source")).toBeDefined());

    expect(screen.getByTestId("probe-source").textContent).toBe("microphone");
    expect(screen.queryByLabelText("Output device to capture")).toBeNull();
  });

  it("choosing a system source updates the context and reveals the output picker", async () => {
    renderSection();
    await waitFor(() => expect(screen.getByLabelText("Audio source")).toBeDefined());

    fireEvent.change(screen.getByLabelText("Audio source"), { target: { value: "both" } });
    expect(screen.getByTestId("probe-source").textContent).toBe("both");

    await waitFor(() => expect(screen.getByLabelText("Output device to capture")).toBeDefined());
    fireEvent.change(screen.getByLabelText("Output device to capture"), { target: { value: "out-1" } });
    expect(screen.getByTestId("probe-output").textContent).toBe("out-1");
  });

  it("disables the microphone picker when only system audio is being captured", async () => {
    renderSection();
    await waitFor(() => expect(screen.getByLabelText("Audio source")).toBeDefined());

    fireEvent.change(screen.getByLabelText("Audio source"), { target: { value: "system" } });
    expect(screen.getByLabelText("Microphone")).toHaveProperty("disabled", true);
  });

  it("says system audio is unavailable when the platform reports no output devices", async () => {
    // Linux: recording.rs returns an empty list rather than an error, which
    // is how the GUI knows to disable the option instead of offering a
    // picker that could only ever produce silence.
    outputDevices.mockResolvedValue([]);
    renderSection();

    await waitFor(() =>
      expect(screen.getByText("System audio capture is not available on this platform.")).toBeDefined(),
    );
    const systemOption = screen.getByRole("option", { name: "System audio" });
    expect(systemOption).toHaveProperty("disabled", true);
  });

  it("shows an inline error if the device list fails to load, without crashing the section", async () => {
    inputDevices.mockRejectedValue(new Error("failed to enumerate input devices"));
    renderSection();

    await waitFor(() => expect(screen.getByText("failed to enumerate input devices")).toBeDefined());
    // The rest of the section is still usable.
    expect(screen.getByLabelText("Model")).toBeDefined();
  });

  // 2026-09-30, user-reported: recordings' audio piled up unbounded.
  describe("auto-trash recordings", () => {
    it("defaults to on for a fresh install (nothing stored yet)", async () => {
      renderSection();
      await waitFor(() => expect(screen.getByLabelText("Move recordings to the trash after transcription")).toBeDefined());
      expect(screen.getByLabelText("Move recordings to the trash after transcription")).toHaveProperty("checked", true);
      expect(screen.getByTestId("probe-auto-trash").textContent).toBe("true");
    });

    it("still reads as on for a settings blob saved before this setting existed", async () => {
      window.localStorage.setItem(
        "voice-transcript-voice-input-settings",
        JSON.stringify({ model: "whisper-large-v3", audioSource: "microphone" }),
      );
      renderSection();
      await waitFor(() => expect(screen.getByTestId("probe-auto-trash").textContent).toBe("true"));
    });

    it("unchecking it updates the context and persists across a remount", async () => {
      const { unmount } = renderSection();
      await waitFor(() => expect(screen.getByLabelText("Move recordings to the trash after transcription")).toBeDefined());

      fireEvent.click(screen.getByLabelText("Move recordings to the trash after transcription"));
      await waitFor(() => expect(screen.getByTestId("probe-auto-trash").textContent).toBe("false"));

      unmount();
      renderSection();
      await waitFor(() => expect(screen.getByTestId("probe-auto-trash").textContent).toBe("false"));
    });
  });
});

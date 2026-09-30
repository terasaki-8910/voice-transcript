// F21 (native-menu, Preferences); Settings surface revision (see
// design_brief.md's dated entry, and PreferencesView.tsx's header comment).
// ACCEPTANCE G11: pins the status display (never shows the key/URL itself,
// only set/unset), saving each field, and that a save failure surfaces an
// error instead of silently closing. @tauri-apps/api/core's invoke is
// mocked directly (lib/tauri.ts's saveApiKey/getApiKeyStatus/
// saveDatabaseUrl/getDatabaseUrlStatus/listInputDevices have no injectable
// seam, unlike the higher-level contexts elsewhere in this app -- consistent
// with how other tests mock raw Tauri API calls at the module boundary).
//
// The dialog now opens on the Voice input section by default (not
// Connection), so VoiceInputSection's mount-time list_input_devices() call
// is the FIRST invoke() every test sees, before the API-key/database-URL
// tests below navigate into the Connection section and trigger
// get_api_key_status/get_database_url_status, in that order.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { DisplayPreferencesProvider } from "../../src/features/preferences/DisplayPreferencesContext";
import { VoiceInputSettingsProvider } from "../../src/features/preferences/VoiceInputSettingsContext";
import { PreferencesView } from "../../src/features/preferences/PreferencesView";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, ...rest: unknown[]) => {
    // The Voice input section enumerates audio devices when it mounts, and
    // it is the default section, so those calls land before anything any
    // test here actually asserts on. They are answered by name instead of
    // from the ordered queue below -- otherwise adding or removing a device
    // call reshuffles every mockResolvedValueOnce in the file.
    if (command === "list_input_devices" || command === "list_output_devices") {
      // Deliberately not recorded on the spy: routing them through it would
      // consume the mockResolvedValueOnce values queued for the calls these
      // tests are actually about.
      return Promise.resolve([]);
    }
    return invoke(command, ...rest);
  },
}));

function renderView(onClose: () => void = vi.fn()) {
  return render(
    <I18nProvider>
      <DisplayPreferencesProvider>
        <VoiceInputSettingsProvider>
          <PreferencesView onClose={onClose} />
        </VoiceInputSettingsProvider>
      </DisplayPreferencesProvider>
    </I18nProvider>,
  );
}

function mockMountStatus(keySet: boolean, databaseUrlSet: boolean) {
  invoke.mockResolvedValueOnce(keySet); // get_api_key_status
  invoke.mockResolvedValueOnce(databaseUrlSet); // get_database_url_status
}

// Every API-key/database-URL test needs the Connection section open first --
// that's what actually mounts ConnectionSection and fires its status checks.
async function renderConnectionSection(onClose: () => void = vi.fn()) {
  const result = renderView(onClose);
  fireEvent.click(screen.getByRole("button", { name: "Connection" }));
  await waitFor(() => expect(screen.getByLabelText("Groq API key")).toBeDefined());
  return result;
}

describe("PreferencesView - section navigation", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("opens on the Voice input section by default", async () => {
    renderView();
    await waitFor(() => expect(screen.getByLabelText("Model")).toBeDefined());
    expect(screen.getByRole("button", { name: "Voice input" }).getAttribute("aria-current")).toBe("page");
  });

  it("switches sections via the settings nav", async () => {
    mockMountStatus(false, false);
    renderView();
    await waitFor(() => expect(screen.getByLabelText("Model")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Custom dictionary" }));
    expect(screen.getByText("Manage word replacements applied to every transcript.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Custom dictionary" }).getAttribute("aria-current")).toBe("page");
  });
});

describe("PreferencesView - API key", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("shows 'not set' when no key is saved yet", async () => {
    mockMountStatus(false, false);
    await renderConnectionSection();

    await waitFor(() => expect(screen.getByText("No API key is set yet.")).toBeDefined());
    expect(invoke).toHaveBeenCalledWith("get_api_key_status");
  });

  it("shows 'set' when a key is already saved", async () => {
    mockMountStatus(true, false);
    await renderConnectionSection();

    await waitFor(() => expect(screen.getByText("API key is set.")).toBeDefined());
  });

  it("Save is disabled until a key is typed, and never displays the typed value back as saved state", async () => {
    mockMountStatus(false, false);
    await renderConnectionSection();

    const saveKey = await screen.findByRole("button", { name: "Save Groq API key" });
    expect(saveKey).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Groq API key"), { target: { value: "gsk_test_key" } });
    expect(saveKey).toHaveProperty("disabled", false);
  });

  it("saving calls save_api_key with the typed key, then clears the input and shows 'set'", async () => {
    mockMountStatus(false, false);
    invoke.mockResolvedValueOnce(undefined); // save_api_key
    await renderConnectionSection();

    await waitFor(() => expect(screen.getByText("No API key is set yet.")).toBeDefined());

    const input = screen.getByLabelText("Groq API key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "gsk_test_key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Groq API key" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_api_key", { key: "gsk_test_key" }));
    await waitFor(() => expect(screen.getByText("API key is set.")).toBeDefined());
    expect(input.value).toBe("");
  });

  it("a save failure surfaces an error instead of silently closing", async () => {
    mockMountStatus(false, false);
    invoke.mockRejectedValueOnce(new Error("failed to write config file"));
    const onClose = vi.fn();
    await renderConnectionSection(onClose);

    await waitFor(() => expect(screen.getByText("No API key is set yet.")).toBeDefined());
    fireEvent.change(screen.getByLabelText("Groq API key"), { target: { value: "gsk_test_key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Groq API key" }));

    await waitFor(() => expect(screen.getByText("failed to write config file")).toBeDefined());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Close calls onClose", async () => {
    mockMountStatus(false, false);
    const onClose = vi.fn();
    await renderConnectionSection(onClose);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Light dismiss (2026-07-19): clicking the backdrop or pressing Escape
  // closes the dialog, same as the explicit Close button.
  it("clicking the backdrop calls onClose", async () => {
    mockMountStatus(false, false);
    const onClose = vi.fn();
    await renderConnectionSection(onClose);

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking inside the modal panel does not call onClose", async () => {
    mockMountStatus(false, false);
    const onClose = vi.fn();
    await renderConnectionSection(onClose);

    fireEvent.click(screen.getByText("Preferences"));
    fireEvent.click(screen.getByLabelText("Groq API key"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("pressing Escape calls onClose", async () => {
    mockMountStatus(false, false);
    const onClose = vi.fn();
    await renderConnectionSection(onClose);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("PreferencesView - database URL", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("shows 'not set' when no database URL is saved yet", async () => {
    mockMountStatus(false, false);
    await renderConnectionSection();

    await waitFor(() => expect(screen.getByText("No database URL is set yet.")).toBeDefined());
    expect(invoke).toHaveBeenCalledWith("get_database_url_status");
  });

  it("shows 'set' when a database URL is already saved", async () => {
    mockMountStatus(false, true);
    await renderConnectionSection();

    await waitFor(() => expect(screen.getByText("Database URL is set.")).toBeDefined());
  });

  it("Save is disabled until a URL is typed, and never displays the typed value back as saved state", async () => {
    mockMountStatus(false, false);
    await renderConnectionSection();

    const saveUrl = await screen.findByRole("button", { name: "Save database URL" });
    expect(saveUrl).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("PostgreSQL database URL"), {
      target: { value: "postgresql://user:pass@localhost:5432/voice_transcript" },
    });
    expect(saveUrl).toHaveProperty("disabled", false);
  });

  it("saving calls save_database_url with the typed URL, then clears the input and shows 'set'", async () => {
    mockMountStatus(false, false);
    invoke.mockResolvedValueOnce(undefined); // save_database_url
    await renderConnectionSection();

    await waitFor(() => expect(screen.getByText("No database URL is set yet.")).toBeDefined());

    const input = screen.getByLabelText("PostgreSQL database URL") as HTMLInputElement;
    const url = "postgresql://user:pass@localhost:5432/voice_transcript";
    fireEvent.change(input, { target: { value: url } });
    fireEvent.click(screen.getByRole("button", { name: "Save database URL" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_database_url", { url }));
    await waitFor(() => expect(screen.getByText("Database URL is set.")).toBeDefined());
    expect(input.value).toBe("");
  });

  it("a save failure surfaces an error instead of silently closing", async () => {
    mockMountStatus(false, false);
    invoke.mockRejectedValueOnce(new Error("Database URL must start with postgres:// or postgresql://"));
    const onClose = vi.fn();
    await renderConnectionSection(onClose);

    fireEvent.change(screen.getByLabelText("PostgreSQL database URL"), { target: { value: "mysql://bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Save database URL" }));

    await waitFor(() =>
      expect(screen.getByText("Database URL must start with postgres:// or postgresql://")).toBeDefined(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});

// 2026-09-30, user-reported: Tailscale was up, the DB port was reachable,
// and there was still no way to check DB connectivity from inside the app,
// or to see the real reason a connection was failing.
describe("PreferencesView - test connection", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("is clickable without typing a URL -- it tests the currently SAVED value, not the input field", async () => {
    mockMountStatus(false, true); // no key, database URL already set
    await renderConnectionSection();
    await waitFor(() => expect(screen.getByText("Database URL is set.")).toBeDefined());

    expect(screen.getByRole("button", { name: "Test connection" })).toHaveProperty("disabled", false);
  });

  it("calls test_database_connection and shows a success message when it connects", async () => {
    mockMountStatus(false, true);
    invoke.mockResolvedValueOnce({ connected: true }); // test_database_connection
    await renderConnectionSection();
    await waitFor(() => expect(screen.getByText("Database URL is set.")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("test_database_connection"));
    await waitFor(() => expect(screen.getByText("Connected")).toBeDefined());
  });

  it("shows the real underlying error when the connection fails, not a generic message", async () => {
    mockMountStatus(false, true);
    invoke.mockResolvedValueOnce({ connected: false, error: "connect ETIMEDOUT 100.122.25.26:5432" });
    await renderConnectionSection();
    await waitFor(() => expect(screen.getByText("Database URL is set.")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(screen.getByText("connect ETIMEDOUT 100.122.25.26:5432")).toBeDefined());
    expect(screen.queryByText("Connected")).toBeNull();
  });

  it("reports clearly when no database URL is configured at all", async () => {
    mockMountStatus(false, false);
    invoke.mockResolvedValueOnce({ connected: false, error: "DATABASE_URL is not set." });
    await renderConnectionSection();
    await waitFor(() => expect(screen.getByText("No database URL is set yet.")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(screen.getByText("DATABASE_URL is not set.")).toBeDefined());
  });

  it("a failed IPC call itself (not a connection result) still surfaces an error, not a crash", async () => {
    mockMountStatus(false, true);
    invoke.mockRejectedValueOnce(new Error("sidecar not found"));
    await renderConnectionSection();
    await waitFor(() => expect(screen.getByText("Database URL is set.")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(screen.getByText("sidecar not found")).toBeDefined());
  });
});

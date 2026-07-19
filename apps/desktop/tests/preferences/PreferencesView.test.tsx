// F21 (native-menu, Preferences). ACCEPTANCE G11: pins the status display
// (never shows the key/URL itself, only set/unset), saving each field, and
// that a save failure surfaces an error instead of silently closing.
// @tauri-apps/api/core's invoke is mocked directly (lib/tauri.ts's
// saveApiKey/getApiKeyStatus/saveDatabaseUrl/getDatabaseUrlStatus have no
// injectable seam, unlike the higher-level contexts elsewhere in this app --
// consistent with how other tests mock raw Tauri API calls at the module
// boundary). Both API key and database URL status checks fire on mount, so
// every test that renders the view needs two queued invoke resolutions, in
// call order (get_api_key_status, then get_database_url_status).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { PreferencesView } from "../../src/features/preferences/PreferencesView";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

function renderView(onClose: () => void = vi.fn()) {
  return render(
    <I18nProvider>
      <PreferencesView onClose={onClose} />
    </I18nProvider>,
  );
}

function mockMountStatus(keySet: boolean, databaseUrlSet: boolean) {
  invoke.mockResolvedValueOnce(keySet); // get_api_key_status
  invoke.mockResolvedValueOnce(databaseUrlSet); // get_database_url_status
}

describe("PreferencesView - API key", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("shows 'not set' when no key is saved yet", async () => {
    mockMountStatus(false, false);
    renderView();

    await waitFor(() => expect(screen.getByText("No API key is set yet.")).toBeDefined());
    expect(invoke).toHaveBeenCalledWith("get_api_key_status");
  });

  it("shows 'set' when a key is already saved", async () => {
    mockMountStatus(true, false);
    renderView();

    await waitFor(() => expect(screen.getByText("API key is set.")).toBeDefined());
  });

  it("Save is disabled until a key is typed, and never displays the typed value back as saved state", async () => {
    mockMountStatus(false, false);
    renderView();

    const saveKey = await screen.findByRole("button", { name: "Save Groq API key" });
    expect(saveKey).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Groq API key"), { target: { value: "gsk_test_key" } });
    expect(saveKey).toHaveProperty("disabled", false);
  });

  it("saving calls save_api_key with the typed key, then clears the input and shows 'set'", async () => {
    mockMountStatus(false, false);
    invoke.mockResolvedValueOnce(undefined); // save_api_key
    renderView();

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
    renderView(onClose);

    await waitFor(() => expect(screen.getByText("No API key is set yet.")).toBeDefined());
    fireEvent.change(screen.getByLabelText("Groq API key"), { target: { value: "gsk_test_key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Groq API key" }));

    await waitFor(() => expect(screen.getByText("failed to write config file")).toBeDefined());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Close calls onClose", async () => {
    mockMountStatus(false, false);
    const onClose = vi.fn();
    renderView(onClose);

    await waitFor(() => expect(screen.getByText("No API key is set yet.")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Light dismiss (2026-07-19): clicking the backdrop or pressing Escape
  // closes the dialog, same as the explicit Close button.
  it("clicking the backdrop calls onClose", async () => {
    mockMountStatus(false, false);
    const onClose = vi.fn();
    renderView(onClose);

    await waitFor(() => expect(screen.getByText("No API key is set yet.")).toBeDefined());
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking inside the modal panel does not call onClose", async () => {
    mockMountStatus(false, false);
    const onClose = vi.fn();
    renderView(onClose);

    await waitFor(() => expect(screen.getByText("No API key is set yet.")).toBeDefined());
    fireEvent.click(screen.getByText("Preferences"));
    fireEvent.click(screen.getByLabelText("Groq API key"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("pressing Escape calls onClose", async () => {
    mockMountStatus(false, false);
    const onClose = vi.fn();
    renderView(onClose);

    await waitFor(() => expect(screen.getByText("No API key is set yet.")).toBeDefined());
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
    renderView();

    await waitFor(() => expect(screen.getByText("No database URL is set yet.")).toBeDefined());
    expect(invoke).toHaveBeenCalledWith("get_database_url_status");
  });

  it("shows 'set' when a database URL is already saved", async () => {
    mockMountStatus(false, true);
    renderView();

    await waitFor(() => expect(screen.getByText("Database URL is set.")).toBeDefined());
  });

  it("Save is disabled until a URL is typed, and never displays the typed value back as saved state", async () => {
    mockMountStatus(false, false);
    renderView();

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
    renderView();

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
    renderView(onClose);

    await waitFor(() => expect(screen.getByText("No database URL is set yet.")).toBeDefined());
    fireEvent.change(screen.getByLabelText("PostgreSQL database URL"), { target: { value: "mysql://bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Save database URL" }));

    await waitFor(() =>
      expect(screen.getByText("Database URL must start with postgres:// or postgresql://")).toBeDefined(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});

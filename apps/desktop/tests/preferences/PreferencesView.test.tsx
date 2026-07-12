// F21 (native-menu, Preferences). ACCEPTANCE G11: pins the status display
// (never shows the key itself, only set/unset), saving a key, and that a
// save failure surfaces an error instead of silently closing.
// @tauri-apps/api/core's invoke is mocked directly (lib/tauri.ts's
// saveApiKey/getApiKeyStatus have no injectable seam, unlike the
// higher-level contexts elsewhere in this app -- consistent with how other
// tests mock raw Tauri API calls at the module boundary).
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

describe("PreferencesView", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("shows 'not set' when no key is saved yet", async () => {
    invoke.mockResolvedValueOnce(false);
    renderView();

    await waitFor(() => expect(screen.getByText("No API key is set yet.")).toBeDefined());
    expect(invoke).toHaveBeenCalledWith("get_api_key_status");
  });

  it("shows 'set' when a key is already saved", async () => {
    invoke.mockResolvedValueOnce(true);
    renderView();

    await waitFor(() => expect(screen.getByText("API key is set.")).toBeDefined());
  });

  it("Save is disabled until a key is typed, and never displays the typed value back as saved state", async () => {
    invoke.mockResolvedValueOnce(false);
    renderView();

    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true));

    fireEvent.change(screen.getByLabelText("Groq API key"), { target: { value: "gsk_test_key" } });
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
  });

  it("saving calls save_api_key with the typed key, then clears the input and shows 'set'", async () => {
    invoke.mockResolvedValueOnce(false); // get_api_key_status on mount
    invoke.mockResolvedValueOnce(undefined); // save_api_key
    renderView();

    await waitFor(() => expect(screen.getByText("No API key is set yet.")).toBeDefined());

    const input = screen.getByLabelText("Groq API key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "gsk_test_key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_api_key", { key: "gsk_test_key" }));
    await waitFor(() => expect(screen.getByText("API key is set.")).toBeDefined());
    expect(input.value).toBe("");
  });

  it("a save failure surfaces an error instead of silently closing", async () => {
    invoke.mockResolvedValueOnce(false); // get_api_key_status
    invoke.mockRejectedValueOnce(new Error("failed to write config file"));
    const onClose = vi.fn();
    renderView(onClose);

    await waitFor(() => expect(screen.getByText("No API key is set yet.")).toBeDefined());
    fireEvent.change(screen.getByLabelText("Groq API key"), { target: { value: "gsk_test_key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("failed to write config file")).toBeDefined());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Close calls onClose", async () => {
    invoke.mockResolvedValueOnce(false);
    const onClose = vi.fn();
    renderView(onClose);

    await waitFor(() => expect(screen.getByText("No API key is set yet.")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

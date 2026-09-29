// Settings > Custom dictionary (SPEC.md > Custom dictionary). Pins CRUD and
// import through DictionarySection -- invoke() is mocked directly (same
// convention as PreferencesView.test.tsx: this component has no injectable
// seam, unlike the higher-level *Context providers elsewhere in this app).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { DictionarySection } from "../../src/features/preferences/DictionarySection";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

// No `open` mock here -- the file-picker dialog is driven entirely inside
// the Rust import_dictionary_file command (a tauri-capability-reviewer
// fix: an earlier version took a webview-supplied path, which any script
// could invoke() with an arbitrary local path, e.g. this app's own secret
// config files). From the webview's side, import is just one invoke() call
// that resolves to the result or null (user cancelled).
const confirmDialog = vi.fn(async (..._args: unknown[]) => true);
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: (...args: unknown[]) => confirmDialog(...args),
}));

function renderSection() {
  return render(
    <I18nProvider>
      <DictionarySection />
    </I18nProvider>,
  );
}

function entry(overrides: Partial<{ id: number; word: string; replacement: string }> = {}) {
  return {
    id: 1,
    word: "スパークル",
    replacement: "SPARQL",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("DictionarySection", () => {
  beforeEach(() => {
    invoke.mockReset();
    confirmDialog.mockReset();
    confirmDialog.mockResolvedValue(true);
  });

  it("lists entries fetched on mount", async () => {
    invoke.mockResolvedValueOnce([entry()]);
    renderSection();

    await waitFor(() => expect(screen.getByText("スパークル")).toBeDefined());
    expect(screen.getByText("SPARQL")).toBeDefined();
    expect(invoke).toHaveBeenCalledWith("list_dictionary");
  });

  it("shows the empty state when there are no entries", async () => {
    invoke.mockResolvedValueOnce([]);
    renderSection();
    await waitFor(() => expect(screen.getByText("No dictionary entries yet")).toBeDefined());
  });

  it("adding a word calls add_dictionary_entry and prepends it to the list", async () => {
    invoke.mockResolvedValueOnce([]); // list_dictionary
    invoke.mockResolvedValueOnce(entry({ id: 5, word: "cloud.md", replacement: "CLAUDE.md" })); // add_dictionary_entry
    renderSection();
    await waitFor(() => expect(screen.getByText("No dictionary entries yet")).toBeDefined());

    fireEvent.change(screen.getByLabelText("Word"), { target: { value: "cloud.md" } });
    fireEvent.change(screen.getByLabelText("Replacement"), { target: { value: "CLAUDE.md" } });
    fireEvent.click(screen.getByRole("button", { name: "Add word" }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("add_dictionary_entry", { request: { word: "cloud.md", replacement: "CLAUDE.md" } }),
    );
    await waitFor(() => expect(screen.getByText("cloud.md")).toBeDefined());
  });

  it("adding a word flashes an 'Added' confirmation on the add button (user-reported: silent otherwise)", async () => {
    invoke.mockResolvedValueOnce([]); // list_dictionary
    invoke.mockResolvedValueOnce(entry({ id: 5, word: "cloud.md", replacement: "CLAUDE.md" })); // add_dictionary_entry
    renderSection();
    await waitFor(() => expect(screen.getByText("No dictionary entries yet")).toBeDefined());

    fireEvent.change(screen.getByLabelText("Word"), { target: { value: "cloud.md" } });
    fireEvent.change(screen.getByLabelText("Replacement"), { target: { value: "CLAUDE.md" } });
    fireEvent.click(screen.getByRole("button", { name: "Add word" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Added" })).toBeDefined());
  });

  it("Add word is disabled until both fields are filled", async () => {
    invoke.mockResolvedValueOnce([]);
    renderSection();
    await waitFor(() => expect(screen.getByText("No dictionary entries yet")).toBeDefined());

    const addBtn = screen.getByRole("button", { name: "Add word" });
    expect(addBtn).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Word"), { target: { value: "a" } });
    expect(addBtn).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Replacement"), { target: { value: "b" } });
    expect(addBtn).toHaveProperty("disabled", false);
  });

  it("editing a row calls update_dictionary_entry and reflects the new values", async () => {
    invoke.mockResolvedValueOnce([entry()]);
    invoke.mockResolvedValueOnce(entry({ replacement: "SPARQL-updated" })); // update_dictionary_entry
    renderSection();
    await waitFor(() => expect(screen.getByText("スパークル")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Edit entry" }));
    const replacementInput = screen.getAllByLabelText("Replacement").find((el) => (el as HTMLInputElement).value === "SPARQL") as HTMLInputElement;
    fireEvent.change(replacementInput, { target: { value: "SPARQL-updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("update_dictionary_entry", {
        request: { id: 1, word: "スパークル", replacement: "SPARQL-updated" },
      }),
    );
    await waitFor(() => expect(screen.getByText("SPARQL-updated")).toBeDefined());
  });

  it("saving an edit flashes a checkmark next to the row (user-reported: silent otherwise)", async () => {
    invoke.mockResolvedValueOnce([entry()]);
    invoke.mockResolvedValueOnce(entry({ replacement: "SPARQL-updated" }));
    const { container } = renderSection();
    await waitFor(() => expect(screen.getByText("スパークル")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Edit entry" }));
    const replacementInput = screen.getAllByLabelText("Replacement").find((el) => (el as HTMLInputElement).value === "SPARQL") as HTMLInputElement;
    fireEvent.change(replacementInput, { target: { value: "SPARQL-updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(container.querySelector(".dictionary-saved-check")).not.toBeNull());
  });

  it("cancelling an edit discards the in-progress change", async () => {
    invoke.mockResolvedValueOnce([entry()]);
    renderSection();
    await waitFor(() => expect(screen.getByText("スパークル")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Edit entry" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("SPARQL")).toBeDefined();
    expect(invoke).not.toHaveBeenCalledWith("update_dictionary_entry", expect.anything());
  });

  it("deleting a row asks for confirmation, then calls delete_dictionary_entry and removes it", async () => {
    invoke.mockResolvedValueOnce([entry()]);
    invoke.mockResolvedValueOnce({ id: 1 }); // delete_dictionary_entry
    renderSection();
    await waitFor(() => expect(screen.getByText("スパークル")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Delete entry" }));

    await waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("delete_dictionary_entry", { id: 1 }));
    await waitFor(() => expect(screen.queryByText("スパークル")).toBeNull());
  });

  it("declining the confirmation does not delete the entry", async () => {
    confirmDialog.mockResolvedValue(false);
    invoke.mockResolvedValueOnce([entry()]);
    renderSection();
    await waitFor(() => expect(screen.getByText("スパークル")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Delete entry" }));

    await waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    expect(invoke).not.toHaveBeenCalledWith("delete_dictionary_entry", expect.anything());
    expect(screen.getByText("スパークル")).toBeDefined();
  });

  it("Import picks a file (via the Rust-driven dialog) and refreshes the list", async () => {
    invoke.mockResolvedValueOnce([]); // initial list_dictionary
    invoke.mockResolvedValueOnce({ inserted: 57, updated: 0, skipped: 0 }); // import_dictionary_file
    invoke.mockResolvedValueOnce([entry()]); // refreshed list_dictionary
    renderSection();
    await waitFor(() => expect(screen.getByText("No dictionary entries yet")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("import_dictionary_file"));
    await waitFor(() => expect(screen.getByText("スパークル")).toBeDefined());
    expect(screen.getByText("+57 / ~0")).toBeDefined();
  });

  it("does nothing when the import dialog is cancelled (import_dictionary_file resolves null)", async () => {
    invoke.mockResolvedValueOnce([]); // initial list_dictionary
    invoke.mockResolvedValueOnce(null); // import_dictionary_file, cancelled
    renderSection();
    await waitFor(() => expect(screen.getByText("No dictionary entries yet")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("import_dictionary_file"));
    // No refresh call beyond the initial mount fetch, and the empty state
    // is still showing (nothing was imported).
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(screen.getByText("No dictionary entries yet")).toBeDefined();
  });

  it("surfaces a real import error (e.g. an invalid file) without crashing", async () => {
    invoke.mockResolvedValueOnce([]); // initial list_dictionary
    invoke.mockRejectedValueOnce(new Error("Not a valid dictionary JSON file.")); // import_dictionary_file
    renderSection();
    await waitFor(() => expect(screen.getByText("No dictionary entries yet")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(screen.getByText("Not a valid dictionary JSON file.")).toBeDefined());
  });
});

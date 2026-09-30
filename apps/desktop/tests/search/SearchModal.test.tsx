// Search (SPEC.md > Search). Pins SearchModal's interactive layer: typing
// -> debounced results, highlighting, clicking/Enter opens the result in
// History (switching tabs and closing the modal), Escape/backdrop dismiss.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { NavProvider, useNav } from "../../src/features/nav/NavContext";
import { HistoryNavProvider, useHistoryNav } from "../../src/features/history/HistoryNavContext";
import { SearchModal } from "../../src/features/search/SearchModal";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: unknown) => invoke(command, args),
}));

function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    sourceFileName: "/audio/2GOMCP_meeting.m4a",
    startedAt: "2026-09-25T00:00:00.000Z",
    transcriptText: "本日は2GOMCPについて話しました。",
    matchedNotes: [],
    ...overrides,
  };
}

function NavProbe() {
  const { activeTab } = useNav();
  const { currentId } = useHistoryNav();
  return (
    <div>
      <p data-testid="active-tab">{activeTab}</p>
      <p data-testid="current-id">{currentId ?? ""}</p>
    </div>
  );
}

function renderModal(onClose = vi.fn()) {
  const utils = render(
    <I18nProvider>
      <NavProvider>
        <HistoryNavProvider>
          <SearchModal onClose={onClose} />
          <NavProbe />
        </HistoryNavProvider>
      </NavProvider>
    </I18nProvider>,
  );
  return { ...utils, onClose };
}

describe("SearchModal", () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows an empty-query hint and issues no search before anything is typed", () => {
    renderModal();
    expect(screen.getByText("Start typing to search.")).toBeDefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("searches after the debounce and renders a matching result", async () => {
    invoke.mockResolvedValue([makeResult()]);
    const { container } = renderModal();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "2GOMCP" } });
    await act(async () => vi.advanceTimersByTime(250));

    await waitFor(() =>
      expect(container.querySelector(".search-result-title")?.textContent).toBe("2GOMCP_meeting.m4a"),
    );
    expect(invoke).toHaveBeenCalledWith("search_history", { query: "2GOMCP" });
  });

  // 2026-09-30, user-requested: a custom title (History's rename pencil)
  // is itself searchable (db/history.ts's searchHistory), so it should be
  // what's shown here too -- not the raw filename that was actually
  // renamed away from.
  it("shows a custom title instead of the raw filename when one is set", async () => {
    invoke.mockResolvedValue([makeResult({ title: "Team standup" })]);
    const { container } = renderModal();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "standup" } });
    await act(async () => vi.advanceTimersByTime(250));

    await waitFor(() => expect(container.querySelector(".search-result-title")?.textContent).toBe("Team standup"));
  });

  it("highlights the matched term within the title and the snippet", async () => {
    invoke.mockResolvedValue([makeResult()]);
    const { container } = renderModal();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "2GOMCP" } });
    await act(async () => vi.advanceTimersByTime(250));
    await waitFor(() => expect(container.querySelectorAll(".search-highlight").length).toBeGreaterThan(0));

    const marks = [...container.querySelectorAll(".search-highlight")].map((m) => m.textContent);
    expect(marks).toContain("2GOMCP");
  });

  it("shows the matching note when the transcript body itself has no match", async () => {
    invoke.mockResolvedValue([
      makeResult({
        transcriptText: "この文には検索語を含みません。",
        matchedNotes: [{ quotedText: "xyz", note: "正しくはTogoMCP" }],
      }),
    ]);
    const { container } = renderModal();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "TogoMCP" } });
    await act(async () => vi.advanceTimersByTime(250));

    // "TogoMCP" itself renders as a separate highlighted <mark>, so the
    // full sentence is split across sibling nodes -- assert on the row's
    // combined text rather than a single getByText node match.
    await waitFor(() =>
      expect(container.querySelector(".search-result-snippet")?.textContent).toBe('"xyz" → 正しくはTogoMCP'),
    );
  });

  it("shows a no-results message when nothing matches", async () => {
    invoke.mockResolvedValue([]);
    renderModal();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "nope" } });
    await act(async () => vi.advanceTimersByTime(250));

    await waitFor(() => expect(screen.getByText("No matching transcripts")).toBeDefined());
  });

  it("clicking a result switches to History, opens the entry, and closes the modal", async () => {
    invoke.mockResolvedValue([makeResult({ id: 42 })]);
    const { onClose } = renderModal();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "2GOMCP" } });
    await act(async () => vi.advanceTimersByTime(250));
    await waitFor(() => expect(screen.getByRole("option")).toBeDefined());

    fireEvent.click(screen.getByRole("option"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("active-tab").textContent).toBe("history");
    expect(screen.getByTestId("current-id").textContent).toBe("42");
  });

  it("Enter opens the currently focused result", async () => {
    invoke.mockResolvedValue([makeResult({ id: 7 })]);
    const { onClose } = renderModal();

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "2GOMCP" } });
    await act(async () => vi.advanceTimersByTime(250));
    await waitFor(() => expect(screen.getByRole("option")).toBeDefined());

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("current-id").textContent).toBe("7");
  });

  it("ArrowDown/ArrowUp move the focused result without opening it", async () => {
    invoke.mockResolvedValue([makeResult({ id: 1 }), makeResult({ id: 2, sourceFileName: "/audio/second.m4a" })]);
    const { onClose } = renderModal();

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "2GOMCP" } });
    await act(async () => vi.advanceTimersByTime(250));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1].className).toContain("is-focused");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[0].className).toContain("is-focused");
  });

  it("Escape closes the modal", () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the backdrop closes the modal", () => {
    const { onClose, container } = renderModal();
    fireEvent.click(container.querySelector(".modal-overlay")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking inside the modal panel does not close it", () => {
    // role="dialog" is on the overlay itself (matches PreferencesView's own
    // structure) -- clicking IT is a backdrop click by definition, so this
    // targets the inner panel specifically, the same way a real click
    // inside the dialog's visible content would land.
    const { onClose, container } = renderModal();
    fireEvent.click(container.querySelector(".search-modal")!);
    fireEvent.click(screen.getByRole("textbox"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("the explicit Close button closes the modal", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("surfaces a search failure inline", async () => {
    invoke.mockRejectedValue(new Error("db unreachable"));
    renderModal();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "2GOMCP" } });
    await act(async () => vi.advanceTimersByTime(250));

    await waitFor(() => expect(screen.getByText("db unreachable")).toBeDefined());
  });
});

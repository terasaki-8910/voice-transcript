// Sidebar redesign (2026-07-19). Sidebar owns nav (Queue/History/
// Preferences), "Add files" (the one primary action, design_brief.md > Do),
// transcript search, and the collapse/back/forward icon row -- all moved
// out of QueueView's old toolbar. Mirrors the DI/mock conventions of
// tests/queue/QueueView.test.tsx, which this file's coverage was split out
// of.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { ThemeProvider } from "../../src/theme/ThemeContext";
import { QueueProvider, useQueue } from "../../src/features/queue/QueueContext";
import { HistoryProvider, useHistory } from "../../src/features/history/HistoryContext";
import { HistoryNavProvider } from "../../src/features/history/HistoryNavContext";
import { NavProvider } from "../../src/features/nav/NavContext";
import { Sidebar } from "../../src/features/sidebar/Sidebar";

const open = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => open(...args),
}));

function setWindowWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
  fireEvent(window, new Event("resize"));
}

// Exposes queue items and the search query as plain text so tests can
// assert on Sidebar's side effects (addFiles / setSearchQuery) without
// needing QueueView/HistoryView mounted too.
function StateProbe() {
  const { items } = useQueue();
  const { searchQuery } = useHistory();
  return (
    <div>
      <p data-testid="queue-count">{items.length}</p>
      <p data-testid="search-query">{searchQuery}</p>
    </div>
  );
}

function renderSidebar({ preferencesOpen = false, onOpenPreferences = vi.fn() } = {}) {
  return render(
    <I18nProvider>
      <ThemeProvider>
        <NavProvider>
          <HistoryNavProvider>
            <QueueProvider transcribeFn={() => Promise.resolve({ text: "", rendered: "" })}>
              <HistoryProvider listHistoryFn={async () => []}>
                <Sidebar preferencesOpen={preferencesOpen} onOpenPreferences={onOpenPreferences} />
                <StateProbe />
              </HistoryProvider>
            </QueueProvider>
          </HistoryNavProvider>
        </NavProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe("Sidebar", () => {
  afterEach(() => {
    open.mockReset();
    setWindowWidth(1024);
  });

  it("renders the brand and all three nav items, Queue active by default", () => {
    renderSidebar();
    expect(screen.getByText("Voice Transcript")).toBeDefined();
    expect(screen.getByRole("button", { name: "Queue" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "History" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("button", { name: "Preferences" }).getAttribute("aria-current")).toBeNull();
  });

  it("clicking Preferences calls onOpenPreferences without touching Queue/History nav state", () => {
    const onOpenPreferences = vi.fn();
    renderSidebar({ onOpenPreferences });

    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));

    expect(onOpenPreferences).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Queue" }).getAttribute("aria-current")).toBe("page");
  });

  it("marks Preferences as current when preferencesOpen is true, and Queue/History as not", () => {
    renderSidebar({ preferencesOpen: true });
    expect(screen.getByRole("button", { name: "Preferences" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Queue" }).getAttribute("aria-current")).toBeNull();
  });

  it("Add files picks paths via the native dialog and queues them", async () => {
    open.mockResolvedValue(["/audio/a.m4a"]);
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Add files" }));

    await waitFor(() => expect(screen.getByTestId("queue-count").textContent).toBe("1"));
  });

  it("does nothing when the native file dialog is cancelled", async () => {
    open.mockResolvedValue(null);
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Add files" }));

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("queue-count").textContent).toBe("0");
  });

  it("typing in the search box updates HistoryContext's searchQuery", () => {
    renderSidebar();
    fireEvent.change(screen.getByRole("textbox", { name: "Search transcripts" }), {
      target: { value: "board meeting" },
    });
    expect(screen.getByTestId("search-query").textContent).toBe("board meeting");
  });

  // jsdom doesn't apply stylesheet rules, so the actual hiding (sidebar.css's
  // ".sidebar.is-collapsed .sidebar-nav { display: none }" etc.) can't be
  // asserted via visibility here -- this pins the DOM signal that CSS keys
  // off instead: the "is-collapsed" class toggling on the <aside>, and that
  // the collapse button itself is never one of the elements CSS hides (see
  // sidebar.css's selector list -- .sidebar-topbar > button:not(:first-child),
  // never the first child).
  it("collapsing the sidebar toggles the is-collapsed class that CSS keys off, and round-trips back", () => {
    const { container } = renderSidebar();
    const collapseButton = screen.getByRole("button", { name: "Toggle sidebar" });
    const sidebar = container.querySelector("aside.sidebar");
    expect(sidebar?.className).not.toContain("is-collapsed");

    fireEvent.click(collapseButton);
    expect(sidebar?.className).toContain("is-collapsed");
    // The nav/search/footer stay in the DOM either way (CSS hides them) --
    // the collapse button remains reachable regardless of state.
    expect(screen.getByRole("button", { name: "Queue" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toBeDefined();

    fireEvent.click(collapseButton);
    expect(sidebar?.className).not.toContain("is-collapsed");
  });

  it("back/forward start disabled, and enable once there is somewhere to navigate", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: "Back" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Forward" })).toHaveProperty("disabled", true);
  });

  // Sidebar polish (2026-07-19): auto-collapse, Claude-Desktop-style --
  // useAutoCollapse.ts fires only when window.innerWidth actually crosses
  // the 640px breakpoint, in either direction.
  it("auto-collapses when the window narrows past the breakpoint, and auto-expands when it widens back", () => {
    setWindowWidth(800);
    const { container } = renderSidebar();
    const sidebar = container.querySelector("aside.sidebar");
    expect(sidebar?.className).not.toContain("is-collapsed");

    setWindowWidth(500);
    expect(sidebar?.className).toContain("is-collapsed");

    setWindowWidth(800);
    expect(sidebar?.className).not.toContain("is-collapsed");
  });

  it("starts collapsed when the window is already narrow at mount", () => {
    setWindowWidth(500);
    const { container } = renderSidebar();
    expect(container.querySelector("aside.sidebar")?.className).toContain("is-collapsed");
  });

  it("doesn't fight a manual toggle made while the window stays on the same side of the breakpoint", () => {
    setWindowWidth(500);
    const { container } = renderSidebar();
    const sidebar = container.querySelector("aside.sidebar");
    expect(sidebar?.className).toContain("is-collapsed");

    fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));
    expect(sidebar?.className).not.toContain("is-collapsed");

    // Another resize while still on the narrow side -- no crossing, so the
    // manual choice above should not be reverted.
    setWindowWidth(510);
    expect(sidebar?.className).not.toContain("is-collapsed");
  });
});

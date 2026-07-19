// Sidebar follow-up (2026-07-19): pins the back/forward stack semantics
// confirmed via Q&A -- back/forward navigate the sequence of individually
// opened ("View") History entries, not the Queue/History/Preferences nav.
// Driven directly through the context (not HistoryRow) so the stack
// algorithm itself -- push/truncate-on-new-navigation/close-without-
// truncating/no-duplicate-on-reopen -- is covered independent of the row UI.
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NavProvider, useNav } from "../../src/features/nav/NavContext";
import { HistoryNavProvider, useHistoryNav } from "../../src/features/history/HistoryNavContext";

function Inspector() {
  const { currentId, canGoBack, canGoForward, view, close, back, forward } = useHistoryNav();
  const { activeTab, setActiveTab } = useNav();
  return (
    <div>
      <p data-testid="current">{currentId ?? "none"}</p>
      <p data-testid="can-back">{String(canGoBack)}</p>
      <p data-testid="can-forward">{String(canGoForward)}</p>
      <p data-testid="active-tab">{activeTab}</p>
      <button onClick={() => setActiveTab("queue")}>to-queue</button>
      <button onClick={() => view(1)}>view-1</button>
      <button onClick={() => view(2)}>view-2</button>
      <button onClick={() => view(3)}>view-3</button>
      <button onClick={close}>close</button>
      <button onClick={back}>back</button>
      <button onClick={forward}>forward</button>
    </div>
  );
}

function renderInspector() {
  return render(
    <NavProvider>
      <HistoryNavProvider>
        <Inspector />
      </HistoryNavProvider>
    </NavProvider>,
  );
}

describe("HistoryNavContext", () => {
  it("starts with nothing viewed and both directions disabled", () => {
    renderInspector();
    expect(screen.getByTestId("current").textContent).toBe("none");
    expect(screen.getByTestId("can-back").textContent).toBe("false");
    expect(screen.getByTestId("can-forward").textContent).toBe("false");
  });

  it("view() opens the entry; a single entry has nowhere to go back/forward to", () => {
    renderInspector();
    fireEvent.click(screen.getByText("view-1"));
    expect(screen.getByTestId("current").textContent).toBe("1");
    expect(screen.getByTestId("can-back").textContent).toBe("false");
    expect(screen.getByTestId("can-forward").textContent).toBe("false");
  });

  it("viewing a second entry enables back but not forward", () => {
    renderInspector();
    fireEvent.click(screen.getByText("view-1"));
    fireEvent.click(screen.getByText("view-2"));
    expect(screen.getByTestId("current").textContent).toBe("2");
    expect(screen.getByTestId("can-back").textContent).toBe("true");
    expect(screen.getByTestId("can-forward").textContent).toBe("false");
  });

  it("back() then forward() round-trips through the stack", () => {
    renderInspector();
    fireEvent.click(screen.getByText("view-1"));
    fireEvent.click(screen.getByText("view-2"));

    fireEvent.click(screen.getByText("back"));
    expect(screen.getByTestId("current").textContent).toBe("1");
    expect(screen.getByTestId("can-back").textContent).toBe("false");
    expect(screen.getByTestId("can-forward").textContent).toBe("true");

    fireEvent.click(screen.getByText("forward"));
    expect(screen.getByTestId("current").textContent).toBe("2");
    expect(screen.getByTestId("can-back").textContent).toBe("true");
    expect(screen.getByTestId("can-forward").textContent).toBe("false");
  });

  it("close() clears the current entry without discarding the stack -- back() still works", () => {
    renderInspector();
    fireEvent.click(screen.getByText("view-1"));
    fireEvent.click(screen.getByText("view-2"));
    fireEvent.click(screen.getByText("close"));

    expect(screen.getByTestId("current").textContent).toBe("none");

    fireEvent.click(screen.getByText("back"));
    expect(screen.getByTestId("current").textContent).toBe("1");
    expect(screen.getByTestId("can-forward").textContent).toBe("true");
  });

  it("reopening the entry already at the pointer after close() does not duplicate it in the stack", () => {
    renderInspector();
    fireEvent.click(screen.getByText("view-1"));
    fireEvent.click(screen.getByText("close"));
    fireEvent.click(screen.getByText("view-1"));

    expect(screen.getByTestId("current").textContent).toBe("1");
    expect(screen.getByTestId("can-back").textContent).toBe("false");
    expect(screen.getByTestId("can-forward").textContent).toBe("false");
  });

  it("viewing a new entry after going back truncates the discarded forward branch", () => {
    renderInspector();
    fireEvent.click(screen.getByText("view-1"));
    fireEvent.click(screen.getByText("view-2"));
    fireEvent.click(screen.getByText("back")); // now at entry 1, entry 2 is a forward branch
    fireEvent.click(screen.getByText("view-3")); // navigating away from 1 discards the old "2" branch

    expect(screen.getByTestId("current").textContent).toBe("3");
    expect(screen.getByTestId("can-back").textContent).toBe("true");
    expect(screen.getByTestId("can-forward").textContent).toBe("false");

    fireEvent.click(screen.getByText("back"));
    expect(screen.getByTestId("current").textContent).toBe("1");
    fireEvent.click(screen.getByText("forward"));
    expect(screen.getByTestId("current").textContent).toBe("3");
  });

  it("back()/forward() switch the active nav tab to History, even if Queue was showing", () => {
    renderInspector();
    fireEvent.click(screen.getByText("view-1"));
    fireEvent.click(screen.getByText("view-2"));
    fireEvent.click(screen.getByText("to-queue"));
    expect(screen.getByTestId("active-tab").textContent).toBe("queue");

    fireEvent.click(screen.getByText("back"));
    expect(screen.getByTestId("active-tab").textContent).toBe("history");
  });
});

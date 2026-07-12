// F21 (native-menu). Pins that each native menu event actually triggers the
// right webview-side action. `listen` is mocked to capture the registered
// handler per event name so the test can invoke it directly, simulating
// Rust's menu event handler emitting it -- the same shape jsdom would see
// from a real native menu click. pickFiles/pickSavePath/exportTranscript
// are injected (see useMenuEvents.ts's UseMenuEventsDeps), so no module
// mock is needed for those.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useMenuEvents } from "../../src/features/menu/useMenuEvents";
import { QueueProvider, useQueue } from "../../src/features/queue/QueueContext";
import { NavProvider, useNav } from "../../src/features/nav/NavContext";
import { SelectionProvider, useSelection } from "../../src/features/selection/SelectionContext";
import type { Selection } from "../../src/features/selection/SelectionContext";

type Handler = () => void;
const handlers = new Map<string, Handler>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, handler: Handler) => {
    handlers.set(event, handler);
    return Promise.resolve(() => handlers.delete(event));
  }),
}));

function fireMenuEvent(name: string) {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`no handler registered for ${name}`);
  handler();
}

interface HarnessProps {
  onOpenPreferences: () => void;
  pickFilesFn: () => Promise<string[]>;
  pickSavePathFn: (defaultFileName: string) => Promise<string | null>;
  exportTranscriptFn: (path: string, content: string) => Promise<void>;
  initialSelection?: Selection;
}

function Harness({ onOpenPreferences, pickFilesFn, pickSavePathFn, exportTranscriptFn, initialSelection }: HarnessProps) {
  useMenuEvents(onOpenPreferences, { pickFilesFn, pickSavePathFn, exportTranscriptFn });
  const { items } = useQueue();
  const { activeTab } = useNav();
  const { setSelection } = useSelection();

  return (
    <div>
      <p data-testid="active-tab">{activeTab}</p>
      <p data-testid="queue-count">{items.length}</p>
      {initialSelection && (
        <button type="button" onClick={() => setSelection(initialSelection)}>
          seed-selection
        </button>
      )}
    </div>
  );
}

function renderHarness(props: Partial<HarnessProps> = {}) {
  const defaults = {
    onOpenPreferences: vi.fn(),
    pickFilesFn: vi.fn(async () => [] as string[]),
    pickSavePathFn: vi.fn(async () => null as string | null),
    exportTranscriptFn: vi.fn(async () => {}),
  };
  const merged = { ...defaults, ...props };
  render(
    <NavProvider>
      <SelectionProvider>
        <QueueProvider transcribeFn={() => Promise.resolve({ text: "", rendered: "" })}>
          <Harness {...merged} />
        </QueueProvider>
      </SelectionProvider>
    </NavProvider>,
  );
  return merged;
}

describe("useMenuEvents", () => {
  beforeEach(() => {
    handlers.clear();
  });

  it("menu-add-files picks files and adds them to the queue", async () => {
    const pickFilesFn = vi.fn(async () => ["/audio/a.m4a"]);
    renderHarness({ pickFilesFn });

    await waitFor(() => expect(handlers.has("menu-add-files")).toBe(true));
    fireMenuEvent("menu-add-files");

    await waitFor(() => expect(screen.getByTestId("queue-count").textContent).toBe("1"));
    expect(pickFilesFn).toHaveBeenCalledTimes(1);
  });

  it("menu-open-history switches the active tab", async () => {
    renderHarness();

    await waitFor(() => expect(handlers.has("menu-open-history")).toBe(true));
    expect(screen.getByTestId("active-tab").textContent).toBe("queue");

    fireMenuEvent("menu-open-history");
    await waitFor(() => expect(screen.getByTestId("active-tab").textContent).toBe("history"));
  });

  it("menu-preferences calls the onOpenPreferences callback", async () => {
    const onOpenPreferences = vi.fn();
    renderHarness({ onOpenPreferences });

    await waitFor(() => expect(handlers.has("menu-preferences")).toBe(true));
    fireMenuEvent("menu-preferences");

    expect(onOpenPreferences).toHaveBeenCalledTimes(1);
  });

  it("menu-export does nothing when there is no current selection", async () => {
    const pickSavePathFn = vi.fn(async () => "/tmp/out.txt");
    renderHarness({ pickSavePathFn });

    await waitFor(() => expect(handlers.has("menu-export")).toBe(true));
    fireMenuEvent("menu-export");

    expect(pickSavePathFn).not.toHaveBeenCalled();
  });

  it("menu-export picks a save path and writes the current selection's text", async () => {
    const pickSavePathFn = vi.fn(async () => "/tmp/hello.txt");
    const exportTranscriptFn = vi.fn(async () => {});
    renderHarness({
      pickSavePathFn,
      exportTranscriptFn,
      initialSelection: { fileName: "hello", text: "hello world", format: "txt" },
    });

    await waitFor(() => expect(handlers.has("menu-export")).toBe(true));
    fireEvent.click(screen.getByText("seed-selection"));

    fireMenuEvent("menu-export");

    await waitFor(() => expect(pickSavePathFn).toHaveBeenCalledWith("hello.txt"));
    await waitFor(() => expect(exportTranscriptFn).toHaveBeenCalledWith("/tmp/hello.txt", "hello world"));
  });

  it("menu-export does not write when the save dialog is cancelled", async () => {
    const pickSavePathFn = vi.fn(async () => null);
    const exportTranscriptFn = vi.fn(async () => {});
    renderHarness({
      pickSavePathFn,
      exportTranscriptFn,
      initialSelection: { fileName: "hello", text: "hello world", format: "txt" },
    });

    await waitFor(() => expect(handlers.has("menu-export")).toBe(true));
    fireEvent.click(screen.getByText("seed-selection"));

    fireMenuEvent("menu-export");

    await waitFor(() => expect(pickSavePathFn).toHaveBeenCalled());
    expect(exportTranscriptFn).not.toHaveBeenCalled();
  });
});

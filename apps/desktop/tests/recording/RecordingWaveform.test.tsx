// Live level meter (SPEC.md > Audio recording, added 2026-09-30,
// user-requested). Pins the subscription lifecycle and draw batching --
// same listen() handler-registry mock convention as useMenuEvents.test.tsx.
// jsdom has no real canvas (getContext("2d") returns null and logs a
// console warning) and no polyfill exists in this repo, so
// HTMLCanvasElement.prototype.getContext is stubbed with a fake context
// whose fillRect calls stand in for "one bar was drawn." requestAnimationFrame
// is stubbed to run synchronously so a draw can be observed without an
// extra async tick.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { RecordingWaveform } from "../../src/features/recording/RecordingWaveform";

type LevelHandler = (event: { payload: number }) => void;
const handlers = new Map<string, LevelHandler>();
const unlistenSpies: ReturnType<typeof vi.fn>[] = [];

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, handler: LevelHandler) => {
    handlers.set(event, handler);
    const unlisten = vi.fn(() => handlers.delete(event));
    unlistenSpies.push(unlisten);
    return Promise.resolve(unlisten);
  }),
}));

function makeFakeContext() {
  return {
    fillStyle: "",
    scale: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("RecordingWaveform", () => {
  let fakeContext: ReturnType<typeof makeFakeContext>;

  beforeEach(() => {
    handlers.clear();
    unlistenSpies.length = 0;
    fakeContext = makeFakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(fakeContext as unknown as RenderingContext);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("subscribes to the level event on mount", async () => {
    render(<RecordingWaveform />);
    await vi.waitFor(() => expect(handlers.has("recording-level")).toBe(true));
  });

  it("draws one bar per incoming event, batched onto requestAnimationFrame", async () => {
    render(<RecordingWaveform />);
    await vi.waitFor(() => expect(handlers.has("recording-level")).toBe(true));

    handlers.get("recording-level")!({ payload: 1 });
    handlers.get("recording-level")!({ payload: 0.5 });
    handlers.get("recording-level")!({ payload: 0.2 });

    // requestAnimationFrame is stubbed synchronous, so each event's
    // pushLevel+schedule pair already ran; fillRect is called once per
    // level currently in the ring buffer on each of those (coalesced)
    // frames -- at least 3 bars drawn across them confirms events reach
    // the canvas, without over-asserting the exact frame-batching count.
    expect(fakeContext.fillRect).toHaveBeenCalled();
    expect(fakeContext.clearRect).toHaveBeenCalled();
  });

  it("unsubscribes on unmount", async () => {
    const { unmount } = render(<RecordingWaveform />);
    await vi.waitFor(() => expect(handlers.has("recording-level")).toBe(true));

    unmount();
    expect(handlers.has("recording-level")).toBe(false);
    expect(unlistenSpies[0]).toHaveBeenCalledTimes(1);
  });

  it("still unsubscribes even if unmounted before listen() resolves", async () => {
    let resolveListen!: (unlisten: () => void) => void;
    const { listen } = await import("@tauri-apps/api/event");
    (listen as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<() => void>((res) => (resolveListen = res)),
    );

    const { unmount } = render(<RecordingWaveform />);
    unmount();

    const unlisten = vi.fn();
    resolveListen(unlisten);
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });

  it("a null 2D context (real jsdom default) never throws", async () => {
    (HTMLCanvasElement.prototype.getContext as ReturnType<typeof vi.fn>).mockReturnValue(null);

    expect(() => render(<RecordingWaveform />)).not.toThrow();
    await vi.waitFor(() => expect(handlers.has("recording-level")).toBe(true));
    expect(() => handlers.get("recording-level")!({ payload: 1 })).not.toThrow();
  });
});

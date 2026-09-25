// This project imports describe/it/expect/afterEach explicitly from
// "vitest" everywhere rather than enabling `test.globals: true`, so
// @testing-library/react's own auto-cleanup (which only self-registers when
// it finds a GLOBAL afterEach) never fires on its own -- register it
// explicitly instead of flipping globals on for the whole test suite.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// jsdom doesn't implement matchMedia -- real Tauri webviews (WebKit/
// Chromium) do. Polyfill it so components that check
// prefers-color-scheme/prefers-reduced-motion don't crash under test.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}

// jsdom does no layout, so (unlike Element.getBoundingClientRect, which it
// does stub with a zero rect) it doesn't implement Range.getBoundingClientRect
// at all -- a real Tauri webview does. Transcript notes (features/notes/
// AnnotatedTranscript.tsx) position their popover from a selection Range's
// rect, so without this stub every test that drives a real Selection throws
// instead of exercising that code.
if (typeof Range !== "undefined" && !Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
}

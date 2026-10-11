// Shared helpers for the capture scripts: launching a mocked page, waiting
// for the real app to render, and driving a genuine mouse-based text
// selection (so note creation goes through the app's own mouseup listener
// instead of synthesizing a selection event).
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_SCRIPT = readFileSync(path.join(__dirname, "mock-tauri.js"), "utf8");

export const APP_URL = "http://localhost:5183/";
export const VIEWPORT = { width: 1200, height: 780 };

export async function openApp({ lang, theme, viewport = VIEWPORT, deviceScaleFactor = 2, browser }) {
  const ownBrowser = browser ?? (await chromium.launch());
  const context = await ownBrowser.newContext({
    viewport,
    deviceScaleFactor,
    locale: lang === "ja" ? "ja-JP" : "en-US",
  });

  await context.addInitScript(
    ({ lang, theme }) => {
      window.localStorage.setItem("voice-transcript-lang", lang);
      window.localStorage.setItem("voice-transcript-theme", theme);
    },
    { lang, theme },
  );
  await context.addInitScript(MOCK_SCRIPT);

  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[console] ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    errors.push(`[pageerror] ${err.message}`);
  });
  page.__errors = errors;

  await page.goto(APP_URL, { waitUntil: "load" });
  await page.waitForSelector(".brand", { timeout: 10000 });
  // Let the initial listHistory()/listDictionary()/etc. mock calls settle.
  await page.waitForTimeout(300);

  return { browser: ownBrowser, context, page, ownsBrowser: !browser };
}

export async function checkNoErrors(page, label) {
  const errors = page.__errors || [];
  if (errors.length > 0) {
    throw new Error(`Console errors during "${label}":\n${errors.join("\n")}`);
  }
}

// Selects the nth (0-based) occurrence of `substring` inside the text
// content of `containerSelector`, by computing a real DOM Range and then
// driving actual mouse down/move/up events over its bounding rects -- the
// same physical gesture a user performs, so the app's existing
// `document.addEventListener("mouseup", ...)` selection-to-note-popover
// wiring fires exactly as it would for a real user.
export async function selectSubstring(page, containerSelector, substring, occurrence = 0) {
  const rects = await page.evaluate(
    ({ containerSelector, substring, occurrence }) => {
      const container = document.querySelector(containerSelector);
      if (!container) throw new Error("container not found: " + containerSelector);
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let full = "";
      const nodes = [];
      let n;
      while ((n = walker.nextNode())) {
        nodes.push({ node: n, start: full.length });
        full += n.nodeValue;
      }
      let searchFrom = 0;
      let idx = -1;
      for (let i = 0; i <= occurrence; i++) {
        idx = full.indexOf(substring, searchFrom);
        if (idx === -1) break;
        searchFrom = idx + 1;
      }
      if (idx === -1) throw new Error("substring not found: " + substring);
      const endIdx = idx + substring.length;
      function locate(pos) {
        for (const entry of nodes) {
          const len = entry.node.nodeValue.length;
          if (pos >= entry.start && pos <= entry.start + len) {
            return { node: entry.node, offset: pos - entry.start };
          }
        }
        const last = nodes[nodes.length - 1];
        return { node: last.node, offset: last.node.nodeValue.length };
      }
      const startLoc = locate(idx);
      const endLoc = locate(endIdx);
      const range = document.createRange();
      range.setStart(startLoc.node, startLoc.offset);
      range.setEnd(endLoc.node, endLoc.offset);
      const rectList = Array.from(range.getClientRects());
      const first = rectList[0];
      const last = rectList[rectList.length - 1];
      return {
        x1: first.left + 1,
        y1: first.top + first.height / 2,
        x2: last.right - 1,
        y2: last.top + last.height / 2,
      };
    },
    { containerSelector, substring, occurrence },
  );

  await page.mouse.move(rects.x1, rects.y1);
  await page.mouse.down();
  await page.mouse.move((rects.x1 + rects.x2) / 2, (rects.y1 + rects.y2) / 2, { steps: 3 });
  await page.mouse.move(rects.x2, rects.y2, { steps: 3 });
  await page.mouse.up();
}

export async function emitEvent(page, eventName, payload) {
  await page.evaluate(({ eventName, payload }) => window.__mockEmit(eventName, payload), { eventName, payload });
}

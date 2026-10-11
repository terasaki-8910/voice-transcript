// Drives the real Voice Transcript desktop frontend (apps/desktop/src),
// running against the Vite dev server with Tauri's IPC mocked (see
// mock-tauri.js), to capture portfolio screenshots. Every interaction uses
// real DOM events (clicks, real mouse-drag text selection, keyboard) --
// nothing is injected directly into React state.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openApp, checkNoErrors, selectSubstring, emitEvent } from "./lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "out", "raw");
mkdirSync(OUT_DIR, { recursive: true });

const SEARCH_QUERY = "SPARQL TogoMCP";

function outPath(name) {
  return path.join(OUT_DIR, `${name}.png`);
}

async function shot(page, name) {
  await page.screenshot({ path: outPath(name) });
  console.log("captured", name);
}

async function withApp(browser, { lang, theme }, fn) {
  const { page, context } = await openApp({ browser, lang, theme });
  try {
    await fn(page);
    await checkNoErrors(page, `${lang}/${theme}`);
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------
// Individual shot routines
// ---------------------------------------------------------------------

async function gotoHistory(page) {
  await page.click(".sidebar-nav-item:nth-child(2)");
  await page.waitForSelector(".row", { timeout: 5000 });
  await page.waitForTimeout(150);
}

async function expandFirstHistoryRow(page) {
  // Entry 101 (the seminar recording with the TogoMCP note) is first in
  // the demo history list -- "View" expands it inline.
  await page.locator(".row").first().locator(".row-action.btn-link").first().click();
  await page.waitForSelector(".row-preview", { timeout: 5000 });
  await page.waitForTimeout(150);
}

async function shotHistoryNotes(browser, lang) {
  await withApp(browser, { lang, theme: "light" }, async (page) => {
    await gotoHistory(page);
    await expandFirstHistoryRow(page);
    // The annotated word ("2GOMCP", note: "TogoMCP の聞き間違い") sits in
    // the transcript's 3rd paragraph, past the collapsed preview's clip --
    // "Show full text" is real UI, not scroll trickery, so use it to bring
    // the highlight into view.
    await page.locator(".row-preview-toggle").first().click();
    await page.waitForSelector(".transcript-note", { timeout: 5000 });
    await page.locator(".transcript-note").first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await shot(page, `history-notes-${lang}`);
  });
}

async function shotNotePopover(browser, lang) {
  await withApp(browser, { lang, theme: "light" }, async (page) => {
    await gotoHistory(page);
    await expandFirstHistoryRow(page);
    // Real mouse-drag selection over the word "SPARQL" inside the
    // transcript body (a plain, un-annotated run of text), which fires
    // AnnotatedTranscript's own mouseup listener and opens the "new note"
    // popover exactly as a real user's selection would.
    await selectSubstring(page, ".row-preview", "SPARQL", 0);
    await page.waitForSelector(".note-popover textarea", { timeout: 5000 });
    const note = lang === "ja" ? "グラフクエリ言語。SQLとは別物。" : "A graph query language, distinct from SQL.";
    await page.fill(".note-popover textarea", note);
    // Let useClampedPopoverPosition's layout effect place+reveal it.
    await page.waitForTimeout(150);
    await shot(page, `note-popover-${lang}`);
  });
}

async function shotQueue(browser, lang) {
  await withApp(browser, { lang, theme: "dark" }, async (page) => {
    // Queue is the default tab. First batch: one file that resolves
    // quickly (done) followed by one that rejects quickly (failed).
    await page.click(".sidebar-create");
    await page.waitForFunction(
      () => document.querySelectorAll(".chip-done").length > 0 && document.querySelectorAll(".chip-failed").length > 0,
      { timeout: 8000 },
    );
    // Second batch: one file whose transcribe() call never resolves (held
    // "transcribing" for the life of this page) followed by one that
    // therefore never leaves "queued" -- the queue only ever processes one
    // item at a time (QueueContext's processingRef).
    await page.click(".sidebar-create");
    await page.waitForFunction(
      () => document.querySelectorAll(".chip-active").length > 0 && document.querySelectorAll(".chip-queued").length > 0,
      { timeout: 8000 },
    );
    await page.waitForTimeout(200);
    await shot(page, `queue-${lang}`);
  });
}

async function shotRecording(browser, lang) {
  await withApp(browser, { lang, theme: "dark" }, async (page) => {
    await page.click(".sidebar-record-btn");
    await page.waitForSelector(".recording-bar", { timeout: 5000 });
    // Feed ~3s of plausible speech levels (recording.rs ticks every 50ms;
    // linear peaks mostly in 0.03-0.35, matching levelMeter.ts's own
    // comment on real speech staying in that range) so the canvas shows a
    // real, non-flat waveform instead of a silent flat line.
    for (let i = 0; i < 60; i++) {
      const t = i / 60;
      const peak = 0.04 + 0.28 * Math.abs(Math.sin(t * Math.PI * 5)) * (0.5 + Math.random() * 0.5);
      await emitEvent(page, "recording-level", peak);
      await page.waitForTimeout(16);
    }
    // Let the elapsed-time ticker (real setInterval, 1/sec) advance to a
    // non-trivial, non-zero value.
    await page.waitForTimeout(4200);
    await shot(page, `recording-${lang}`);
  });
}

async function shotSearch(browser, lang) {
  await withApp(browser, { lang, theme: "light" }, async (page) => {
    await page.click(".sidebar-topbar button:nth-child(2)"); // open search modal
    await page.waitForSelector(".search-modal", { timeout: 5000 });
    await page.fill(".search-modal input[type=text]", SEARCH_QUERY);
    await page.waitForSelector(".search-result-row", { timeout: 5000 });
    // Debounce (250ms) + the mocked searchHistory's own small delay.
    await page.waitForFunction(
      () => document.querySelectorAll(".search-result-row").length >= 2,
      { timeout: 5000 },
    );
    await page.waitForTimeout(150);
    await shot(page, `search-${lang}`);
  });
}

async function openPreferences(page) {
  await page.click(".sidebar-nav-item:nth-child(3)");
  await page.waitForSelector(".settings-modal", { timeout: 5000 });
  await page.waitForTimeout(150);
}

async function shotSettingsVoice(browser, lang) {
  await withApp(browser, { lang, theme: "light" }, async (page) => {
    await openPreferences(page);
    // voiceInput is the default section. Switch source to "both" so the
    // output-device picker (normally hidden) also renders, for a fuller
    // screenshot of this section's real range of controls.
    await page.waitForSelector("#voice-input-source", { timeout: 5000 });
    await page.selectOption("#voice-input-source", "both");
    await page.waitForSelector("#voice-input-output", { timeout: 5000 });
    await page.waitForTimeout(150);
    await shot(page, `settings-voice-${lang}`);
  });
}

async function shotSettingsDictionary(browser, lang) {
  await withApp(browser, { lang, theme: "dark" }, async (page) => {
    await openPreferences(page);
    await page.click(".settings-nav-item:nth-child(2)");
    await page.waitForSelector(".dictionary-list .dictionary-row", { timeout: 5000 });
    await page.waitForTimeout(150);
    await shot(page, `settings-dictionary-${lang}`);
  });
}

async function shotSettingsConnection(browser, lang) {
  await withApp(browser, { lang, theme: "light" }, async (page) => {
    await openPreferences(page);
    await page.click(".settings-nav-item:nth-child(4)");
    const testLabel = lang === "ja" ? "接続テスト" : "Test connection";
    const successText = lang === "ja" ? "接続できました" : "Connected";
    await page.getByText(testLabel, { exact: true }).click();
    await page.getByText(successText, { exact: true }).waitFor({ timeout: 5000 });
    await shot(page, `settings-connection-${lang}`);
  });
}

async function shotBulkSelect(browser, lang) {
  await withApp(browser, { lang, theme: "light" }, async (page) => {
    await gotoHistory(page);
    const checkboxes = page.locator(".row-select");
    await checkboxes.nth(0).click();
    await checkboxes.nth(2).click({ modifiers: ["Shift"] });
    await page.waitForSelector(".history-bulk-bar", { timeout: 5000 });
    await page.waitForTimeout(150);
    await shot(page, `bulk-select-${lang}`);
  });
}

// ---------------------------------------------------------------------

async function main() {
  const browser = await chromium.launch();
  const langs = ["ja", "en"];
  try {
    for (const lang of langs) {
      if (process.env.ONLY === "queue") { await shotQueue(browser, lang); continue; }
      await shotHistoryNotes(browser, lang);
      await shotNotePopover(browser, lang);
      await shotQueue(browser, lang);
      await shotRecording(browser, lang);
      await shotSearch(browser, lang);
      await shotSettingsVoice(browser, lang);
      await shotSettingsDictionary(browser, lang);
      await shotSettingsConnection(browser, lang);
      await shotBulkSelect(browser, lang);
    }
  } finally {
    await browser.close();
  }
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

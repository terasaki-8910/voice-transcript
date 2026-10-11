// Records the README hero loop: open History, expand an entry, select a word
// and attach a note (saved with Cmd+Enter), then search across history.
// Every step is a real mouse/keyboard action against the real UI (IPC mocked
// by mock-tauri.js). A visible cursor overlay is injected only so viewers can
// follow the pointer; headless video has none. Needs `pnpm --filter desktop dev`.
//   node flow.mjs ja|en   -> out/_flow-<lang>/*.webm, then for the README:
//   ffmpeg -ss 0.6 -i <webm> -vf "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" -loop 0 ../demo-<lang>.gif
import { chromium } from "playwright";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectSubstring } from "./lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lang = process.argv[2] ?? "ja";
const VIEW = { width: 1200, height: 780 };
const dir = path.join(__dirname, "out", `_flow-${lang}`);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const CURSOR = `
(() => {
  const add = () => {
    const c = document.createElement("div");
    c.id = "__cursor";
    c.style.cssText = "position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);transition:transform 60ms linear";
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.5 15 L11.5 21.5 L14 20.4 L11 14 L17 14 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    document.addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
  };
  if (document.body) add(); else document.addEventListener("DOMContentLoaded", add);
})();`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, recordVideo: { dir, size: VIEW }, locale: lang === "ja" ? "ja-JP" : "en-US" });
await ctx.addInitScript(({ lang }) => {
  localStorage.setItem("voice-transcript-lang", lang);
  localStorage.setItem("voice-transcript-theme", "light");
}, { lang });
await ctx.addInitScript(readFileSync(path.join(__dirname, "mock-tauri.js"), "utf8"));
await ctx.addInitScript(CURSOR);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

let pos = { x: 600, y: 420 };
async function glide(x, y, steps = 18) {
  await page.mouse.move(x, y, { steps });
  pos = { x, y };
}
async function clickOn(locator, pause = 250) {
  const b = await locator.boundingBox();
  await glide(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(pause);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

await page.goto("http://localhost:5183/", { waitUntil: "load" });
await page.waitForSelector(".brand");
await page.mouse.move(pos.x, pos.y);
await page.waitForTimeout(900);

// 1. History tab, expand the seminar entry.
await clickOn(page.locator(".sidebar-nav-item").nth(1));
await page.waitForSelector(".row");
await page.waitForTimeout(700);
await clickOn(page.locator(".row").first().locator(".row-action.btn-link").first());
await page.waitForSelector(".row-preview");
await page.waitForTimeout(900);

// 2. Select a word and attach a note, saved with Cmd+Enter.
const start = await page.evaluate(() => {
  const root = document.querySelector(".row-preview");
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const i = n.nodeValue.indexOf("SPARQL");
    if (i >= 0) {
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
      const b = r.getBoundingClientRect(); return { x: b.left + 1, y: b.top + b.height / 2 };
    }
  }
  return null;
});
await glide(start.x, start.y, 22);
await page.waitForTimeout(300);
await selectSubstring(page, ".row-preview", "SPARQL", 0);
await page.waitForSelector(".note-popover textarea");
await page.waitForTimeout(500);
const note = lang === "ja" ? "グラフクエリ言語。SQLとは別物" : "A graph query language, not SQL";
await page.locator(".note-popover textarea").pressSequentially(note, { delay: 70 });
await page.waitForTimeout(600);
await page.keyboard.press("Meta+Enter");
await page.waitForTimeout(1300);

// 3. Search titles, transcripts and notes at once.
await clickOn(page.locator(".sidebar-topbar button").nth(1));
await page.waitForSelector(".search-modal");
await page.waitForTimeout(400);
await page.locator(".search-modal input[type=text]").pressSequentially("SPARQL TogoMCP", { delay: 95 });
await page.waitForFunction(() => document.querySelectorAll(".search-result-row").length >= 2);
await page.waitForTimeout(1200);
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(1800);

const video = page.video();
await ctx.close();
await browser.close();
if (errors.length) throw new Error(errors.join("\n"));
console.log(await video.path());

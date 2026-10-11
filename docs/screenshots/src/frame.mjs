// Wraps each raw screenshot in a simple macOS-style window frame (traffic
// lights, centered title, rounded corners, soft shadow, transparent PNG
// background) by rendering a small HTML page with Playwright
// (omitBackground: true) -- no canvas/image-editing library needed.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, "out", "raw");
const OUT_DIR = path.join(__dirname, "out", "framed");
mkdirSync(OUT_DIR, { recursive: true });

// CSS pixels (the raw screenshots are 1200x780 CSS px at deviceScaleFactor
// 2 -- i.e. 2400x1560 physical px, which we display at native 1200x780 CSS
// size here so the whole wrapper is itself re-rendered at 2x for a crisp
// result).
const CONTENT_W = 1200;
const CONTENT_H = 780;
const TITLEBAR_H = 40;
const MARGIN = 56;
const RADIUS = 10;

const DARK_SHOTS = new Set(["queue", "recording", "settings-dictionary"]);

function themeFor(baseName) {
  // baseName like "history-notes-ja" -> strip trailing -ja/-en to find the
  // shot key used in DARK_SHOTS.
  const key = baseName.replace(/-(ja|en)$/, "");
  return DARK_SHOTS.has(key) ? "dark" : "light";
}

function htmlFor(imgDataUri, theme) {
  const titlebarBg = theme === "dark" ? "#2b2b2f" : "#e4e4e6";
  const titlebarBorder = theme === "dark" ? "#1c1c1f" : "#d2d2d4";
  const titleColor = theme === "dark" ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.6)";
  const shadow =
    theme === "dark"
      ? "0 30px 70px rgba(0,0,0,0.65), 0 2px 10px rgba(0,0,0,0.45)"
      : "0 30px 70px rgba(0,0,0,0.30), 0 2px 10px rgba(0,0,0,0.12)";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: ${CONTENT_W + MARGIN * 2}px;
    height: ${CONTENT_H + TITLEBAR_H + MARGIN * 2}px;
    background: transparent;
  }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
  }
  .window {
    width: ${CONTENT_W}px;
    border-radius: ${RADIUS}px;
    overflow: hidden;
    box-shadow: ${shadow};
    background: ${titlebarBg};
  }
  .titlebar {
    height: ${TITLEBAR_H}px;
    background: ${titlebarBg};
    border-bottom: 1px solid ${titlebarBorder};
    position: relative;
    display: flex;
    align-items: center;
    padding: 0 14px;
  }
  .dots { display: flex; gap: 8px; }
  .dot { width: 12px; height: 12px; border-radius: 50%; }
  .dot.red { background: #ff5f57; }
  .dot.yellow { background: #febc2e; }
  .dot.green { background: #28c840; }
  .title {
    position: absolute;
    left: 0;
    right: 0;
    text-align: center;
    font-size: 13px;
    font-weight: 600;
    color: ${titleColor};
    letter-spacing: 0.01em;
    pointer-events: none;
  }
  .content img {
    display: block;
    width: ${CONTENT_W}px;
    height: ${CONTENT_H}px;
  }
</style>
</head>
<body>
  <div class="window">
    <div class="titlebar">
      <div class="dots">
        <div class="dot red"></div>
        <div class="dot yellow"></div>
        <div class="dot green"></div>
      </div>
      <div class="title">Voice Transcript</div>
    </div>
    <div class="content"><img src="${imgDataUri}"></div>
  </div>
</body>
</html>`;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: CONTENT_W + MARGIN * 2, height: CONTENT_H + TITLEBAR_H + MARGIN * 2 },
    deviceScaleFactor: 2,
  });

  const files = readdirSync(RAW_DIR).filter((f) => f.endsWith(".png"));
  for (const file of files) {
    const baseName = file.replace(/\.png$/, "");
    const theme = themeFor(baseName);
    const imgBuffer = readFileSync(path.join(RAW_DIR, file));
    const dataUri = `data:image/png;base64,${imgBuffer.toString("base64")}`;
    const html = htmlFor(dataUri, theme);
    const tmpHtmlPath = path.join(OUT_DIR, `_tmp-${baseName}.html`);
    writeFileSync(tmpHtmlPath, html);
    await page.goto(`file://${tmpHtmlPath}`);
    await page.waitForTimeout(50);
    const outPath = path.join(OUT_DIR, `${baseName}.png`);
    await page.screenshot({ path: outPath, omitBackground: true });
    console.log("framed", baseName);
  }

  await browser.close();
  // Clean up temp HTML files.
  for (const file of readdirSync(OUT_DIR)) {
    if (file.startsWith("_tmp-")) {
      try {
        const fs = await import("node:fs");
        fs.unlinkSync(path.join(OUT_DIR, file));
      } catch {}
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

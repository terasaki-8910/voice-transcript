// Renders a captured CLI run (stderr log + stdout) as a terminal-window PNG
// (docs/screenshots/cli-demo.png). The output is a real run, captured first:
//   transcribe a.m4a --format srt > out.srt 2> err.txt
//   node term.mjs ../../screenshots/cli-demo.png "transcribe a.m4a --format srt" err.txt out.srt
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const [,, outFile, cmd, errFile, outFileTxt] = process.argv;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const err = readFileSync(errFile, "utf8").trimEnd().split("\n").map((l) => `<div class="log">${esc(l)}</div>`).join("");
const out = readFileSync(outFileTxt, "utf8").trimEnd().split("\n").map((l) =>
  /-->/.test(l) ? `<div class="ts">${esc(l)}</div>` : /^\d+$/.test(l) ? `<div class="idx">${esc(l)}</div>` : `<div>${esc(l) || "&nbsp;"}</div>`).join("");
// Same geometry as docs/screenshots/src/frame.mjs (1200x780 content, 40 px
// title bar, 56 px margin) so it pairs side by side with the app screenshots.
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
html,body{width:1312px;height:932px;background:transparent}
body{display:flex;align-items:center;justify-content:center}
.win{width:1200px;height:820px;border-radius:10px;overflow:hidden;background:#16181d;box-shadow:0 30px 70px rgba(0,0,0,.65),0 2px 10px rgba(0,0,0,.45)}
.bar{height:40px;background:#2b2b2f;border-bottom:1px solid #1c1c1f;display:flex;align-items:center;padding:0 14px;position:relative}
.dot{width:12px;height:12px;border-radius:50%;margin-right:8px}
.title{position:absolute;left:0;right:0;text-align:center;font:500 13px -apple-system,sans-serif;color:rgba(255,255,255,.75)}
.body{font:21px/1.6 "SF Mono",Menlo,"Hiragino Sans",monospace;color:#e6e6e6;padding:26px 30px}
.prompt b{color:#3fcfc9;font-weight:600}
.log{color:#8b9099}.ts{color:#7fb0ff}.idx{color:#8b9099}
</style></head><body><div class="win" id="win"><div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><div class="title">Terminal</div></div>
<div class="body"><div class="prompt"><b>$</b> ${esc(cmd)}</div>${err}<div style="height:14px"></div>${out}</div></div></body></html>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1312, height: 932 }, deviceScaleFactor: 2 });
await p.setContent(html);
await p.screenshot({ path: outFile, omitBackground: true });
await b.close();
console.log("wrote", outFile);

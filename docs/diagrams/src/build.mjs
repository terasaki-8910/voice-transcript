// Renders the README diagrams (docs/diagrams/*.png) from the specs in specs.mjs.
// Each diagram is laid out as absolutely positioned HTML, edges are routed in the
// page from the rendered element boxes, and Playwright screenshots the canvas once
// per theme (light/dark) at 2x.
//
//   cd docs/diagrams/src && npm install && npm run build   (writes ../*.png)
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import * as si from "simple-icons";
import feather from "feather-icons";
import { chromium } from "playwright";
import { diagrams } from "./specs.mjs";

const outDir = resolve(process.argv[2] ?? "../");
mkdirSync(outDir, { recursive: true });

const THEMES = {
  light: {
    bg: "#ffffff", ink: "#1f2328", muted: "#59636e", line: "#818b98",
    groupBg: "#f6f8fa", groupBorder: "#d1d9e0", card: "#ffffff", cardBorder: "#d1d9e0",
    accent: "#127a79", accentSoft: "rgba(18,122,121,0.07)", accentInk: "#ffffff",
    neutralTile: "#57606a", darkBrandBorder: "transparent",
  },
  dark: {
    bg: "#0d1117", ink: "#e6edf3", muted: "#9198a1", line: "#7d8590",
    groupBg: "#151b23", groupBorder: "#3d444d", card: "#0d1117", cardBorder: "#3d444d",
    accent: "#3fcfc9", accentSoft: "rgba(63,207,201,0.07)", accentInk: "#06201f",
    neutralTile: "#3d444d", darkBrandBorder: "#3d444d",
  },
};

function luminance(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// "si:Rust" -> simple-icons brand glyph on its brand color.
// "fe:mic"  -> Feather stroke glyph on a neutral (or accent) tile.
function iconSvg(ref, theme, { accent = false } = {}) {
  const [kind, name] = ref.split(":");
  if (kind === "si") {
    const icon = si[`si${name}`];
    if (!icon) throw new Error(`missing simple-icon ${name}`);
    const hex = icon.hex;
    const glyph = luminance(hex) > 0.45 ? "#111111" : "#ffffff";
    const border = luminance(hex) < 0.02 ? theme.darkBrandBorder : "transparent";
    return {
      bg: `#${hex}`, border,
      svg: `<svg viewBox="0 0 24 24" fill="${glyph}"><path d="${icon.path}"/></svg>`,
    };
  }
  const fe = feather.icons[name];
  if (!fe) throw new Error(`missing feather icon ${name}`);
  const glyph = accent ? theme.accentInk : "#ffffff";
  return {
    bg: accent ? theme.accent : theme.neutralTile, border: "transparent",
    svg: fe.toSvg({ stroke: glyph, "stroke-width": 2, width: 24, height: 24 }),
  };
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tile(ref, theme, size, opts = {}) {
  const ic = iconSvg(ref, theme, opts);
  return `<div class="tile" style="width:${size}px;height:${size}px;background:${ic.bg};border-color:${ic.border};border-radius:${Math.round(size * 0.24)}px">
    <div class="glyph" style="width:${Math.round(size * 0.56)}px;height:${Math.round(size * 0.56)}px">${ic.svg}</div></div>`;
}

function render(spec, theme) {
  const parts = [];
  for (const g of spec.groups ?? []) {
    const icons = (g.icons ?? []).map((r) => tile(r, theme, 22)).join("");
    parts.push(`<div class="group ${g.style ?? ""}" id="${g.id}" style="left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px">
      <div class="ghead">${icons}<span class="gtitle">${esc(g.title)}</span>${g.sub ? `<span class="gsub">${esc(g.sub)}</span>` : ""}</div></div>`);
  }
  for (const n of spec.nodes ?? []) {
    const size = n.size ?? 52;
    const subs = (n.sub ?? []).map((s) => `<div class="nsub">${esc(s)}</div>`).join("");
    parts.push(`<div class="node" id="${n.id}" style="left:${n.x}px;top:${n.y - size / 2}px;${n.w ? `width:${n.w}px;` : ""}">
      ${tile(n.icon, theme, size, { accent: n.accent })}
      <div class="ntitle">${esc(n.title)}</div>${subs}</div>`);
  }
  for (const s of spec.steps ?? []) {
    const subs = (s.sub ?? []).map((t) => `<div class="ssub">${esc(t)}</div>`).join("");
    const num = s.num ? `<span class="snum">${esc(s.num)}</span>` : "";
    parts.push(`<div class="step ${s.kind ?? ""}" id="${s.id}" style="left:${s.x}px;top:${s.y}px;width:${s.w ?? 200}px;${s.h ? `height:${s.h}px;` : ""}">
      ${s.icon ? tile(s.icon, theme, 34, { accent: s.kind === "decision" || s.accent }) : ""}
      <div class="sbody"><div class="stitle">${num}${esc(s.title)}</div>${subs}</div></div>`);
  }
  for (const l of spec.lists ?? []) {
    const items = l.items.map((it) => `<div class="litem">${tile(it.icon, theme, 26)}<div><div class="ltitle">${esc(it.title)}</div><div class="lsub">${esc(it.sub)}</div></div></div>`).join("");
    parts.push(`<div class="list" id="${l.id}" style="left:${l.x}px;top:${l.y}px;width:${l.w}px">
      <div class="lhead">${esc(l.title)}</div><div class="litems" style="grid-template-columns:repeat(${l.cols ?? 1},1fr)">${items}</div></div>`);
  }
  for (const r of spec.rows ?? []) {
    const chips = r.items.map((it) => `<div class="chip">${tile(it.icon, theme, 36)}<div><div class="ctitle">${esc(it.title)}</div><div class="csub">${esc(it.sub ?? "")}</div></div></div>`).join("");
    parts.push(`<div class="row" style="left:${r.x}px;top:${r.y}px;width:${r.w}px">
      <div class="rlabel"><div class="rtitle">${esc(r.title)}</div><div class="rsub">${esc(r.sub)}</div></div>
      <div class="chips">${chips}</div></div>`);
  }
  for (const t of spec.texts ?? []) {
    parts.push(`<div class="free ${t.cls ?? ""}" style="left:${t.x}px;top:${t.y}px;${t.w ? `width:${t.w}px;` : ""}">${esc(t.text)}</div>`);
  }

  const css = `
  :root{--bg:${theme.bg};--ink:${theme.ink};--muted:${theme.muted};--line:${theme.line};
    --gbg:${theme.groupBg};--gbd:${theme.groupBorder};--card:${theme.card};--cbd:${theme.cardBorder};
    --accent:${theme.accent};--asoft:${theme.accentSoft}}
  *{box-sizing:border-box;margin:0}
  body{background:var(--bg);font-family:-apple-system,"SF Pro Text","Helvetica Neue",Arial,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
  #canvas{position:relative;background:var(--bg);overflow:hidden}
  .group{position:absolute;border:1.5px solid var(--gbd);border-radius:14px;background:var(--gbg)}
  .group.inner{background:var(--bg)}
  .group.dashed{border-style:dashed;border-color:var(--accent);background:var(--asoft)}
  .group.plain{background:transparent}
  .ghead{position:absolute;left:14px;top:12px;display:flex;align-items:center;gap:8px;white-space:nowrap}
  .ghead .tile{flex:none}
  .gtitle{font-size:14px;font-weight:650;letter-spacing:.1px}
  .gsub{font-size:12.5px;color:var(--muted)}
  .tile{display:flex;align-items:center;justify-content:center;border:1.5px solid transparent;flex:none}
  .glyph svg{width:100%;height:100%;display:block}
  .node{position:absolute;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;text-align:center;width:max-content;max-width:230px}
  .node .tile{margin-bottom:8px}
  .ntitle{font-size:15px;font-weight:650;line-height:1.25}
  .nsub{font-size:12.5px;color:var(--muted);line-height:1.4}
  .step{position:absolute;display:flex;gap:11px;align-items:flex-start;padding:13px 14px;border:1.5px solid var(--cbd);border-radius:12px;background:var(--card)}
  .step.decision{border-color:var(--accent);border-style:dashed;background:var(--asoft)}
  .step.terminal{border-radius:26px}
  .step.bar{border-color:var(--accent);background:var(--asoft);align-items:center;padding:10px 14px}
  .step.bar .stitle{font-size:14px}
  .step.bar .ssub{margin-top:1px}
  .stitle{font-size:14.5px;font-weight:650;line-height:1.3;margin-top:1px}
  .snum{display:inline-block;min-width:18px;color:var(--accent);font-variant-numeric:tabular-nums}
  .ssub{font-size:12.5px;color:var(--muted);line-height:1.42;margin-top:2px}
  .list{position:absolute;border:1.5px solid var(--cbd);border-radius:12px;background:var(--card);padding:12px 14px 6px}
  .lhead{font-size:13px;font-weight:650;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px}
  .litems{display:grid;column-gap:18px}
  .litem{display:flex;gap:10px;align-items:flex-start;margin-bottom:12px}
  .ltitle{font-size:13.5px;font-weight:600;line-height:1.3}
  .lsub{font-size:12px;color:var(--muted);line-height:1.38}
  .row{position:absolute;display:flex;align-items:center;gap:18px;padding:14px 16px;border:1.5px solid var(--gbd);border-radius:14px;background:var(--gbg)}
  .rlabel{width:170px;flex:none}
  .rtitle{font-size:15px;font-weight:650}
  .rsub{font-size:12.5px;color:var(--muted);line-height:1.38;margin-top:2px}
  .chips{display:flex;flex-wrap:wrap;gap:10px 12px}
  .chip{display:flex;align-items:center;gap:9px;padding:7px 12px 7px 7px;border:1.5px solid var(--cbd);border-radius:11px;background:var(--card);min-width:150px}
  .ctitle{font-size:13.5px;font-weight:650;white-space:nowrap}
  .csub{font-size:11.5px;color:var(--muted);white-space:nowrap}
  .free{position:absolute;font-size:12.5px;color:var(--muted);line-height:1.4}
  .free.title{font-size:13px;font-weight:650;color:var(--ink)}
  .elabel{position:absolute;transform:translate(-50%,-50%);font-size:12px;line-height:1.3;color:var(--ink);background:var(--bg);padding:2px 7px;border-radius:6px;white-space:nowrap;text-align:center;display:flex;align-items:center;gap:6px}
  .elabel.accent{color:var(--accent);font-weight:600}
  .elabel .tile{border-radius:5px}
  svg.edges{position:absolute;left:0;top:0;pointer-events:none;overflow:visible}
  `;

  const edgesJson = JSON.stringify(spec.edges ?? []);
  const labelIcons = {};
  for (const e of spec.edges ?? []) if (e.labelIcon) labelIcons[e.labelIcon] = tile(e.labelIcon, theme, 18);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
  <div id="canvas" style="width:${spec.width}px;height:${spec.height}px">${parts.join("\n")}
  <svg class="edges" width="${spec.width}" height="${spec.height}"><defs>
    <marker id="arr" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${theme.line}"/></marker>
    <marker id="arrA" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${theme.accent}"/></marker>
  </defs></svg></div>
  <script>
  const EDGES = ${edgesJson};
  const LABEL_ICONS = ${JSON.stringify(labelIcons)};
  const canvas = document.getElementById("canvas");
  const cr = canvas.getBoundingClientRect();
  function box(id){
    const el = document.getElementById(id); if(!el) throw new Error("no element "+id);
    const r = el.getBoundingClientRect();
    const t = el.classList.contains("node") ? el.querySelector(".tile").getBoundingClientRect() : r;
    return { l:r.left-cr.left, r:r.right-cr.left, t:r.top-cr.top, b:r.bottom-cr.top,
             tl:t.left-cr.left, tr:t.right-cr.left, tt:t.top-cr.top, tb:t.bottom-cr.top, node: el.classList.contains("node") };
  }
  function anchor(spec, side, off){
    if (Array.isArray(spec)) return { x: spec[0], y: spec[1] };
    const b = box(spec); off = off || 0; const gap = b.node ? 5 : 0;
    const cy = b.node ? (b.tt+b.tb)/2 : (b.t+b.b)/2, cx = (b.l+b.r)/2;
    if (side==="left")  return { x:(b.node?b.tl:b.l)-gap, y:cy+off };
    if (side==="right") return { x:(b.node?b.tr:b.r)+gap, y:cy+off };
    if (side==="top")   return { x:cx+off, y:(b.node?b.tt:b.t)-gap };
    return { x:cx+off, y:b.b+gap };
  }
  function route(a, as, z, zs, via){
    if (via) return [a, ...via.map(p=>({x:p[0]==null?NaN:p[0], y:p[1]==null?NaN:p[1]})), z];
    const h = s => s==="left"||s==="right";
    if (Math.abs(a.x-z.x)<1 || Math.abs(a.y-z.y)<1) return [a,z];
    if (h(as) && h(zs)) { const mx=(a.x+z.x)/2; return [a,{x:mx,y:a.y},{x:mx,y:z.y},z]; }
    if (!h(as) && !h(zs)) { const my=(a.y+z.y)/2; return [a,{x:a.x,y:my},{x:z.x,y:my},z]; }
    return h(as) ? [a,{x:z.x,y:a.y},z] : [a,{x:a.x,y:z.y},z];
  }
  function fill(pts){ // via points may give only x or only y: inherit from neighbours
    for (let i=1;i<pts.length-1;i++){
      if (isNaN(pts[i].x)) pts[i].x = pts[i-1].x;
      if (isNaN(pts[i].y)) pts[i].y = pts[i-1].y;
    }
    return pts;
  }
  function pathD(pts, rad){
    let d = "M"+pts[0].x+","+pts[0].y;
    for (let i=1;i<pts.length-1;i++){
      const p=pts[i-1], c=pts[i], n=pts[i+1];
      const d1=Math.hypot(c.x-p.x,c.y-p.y), d2=Math.hypot(n.x-c.x,n.y-c.y);
      const r=Math.min(rad,d1/2,d2/2);
      const ax=c.x+(p.x-c.x)*r/d1, ay=c.y+(p.y-c.y)*r/d1;
      const bx=c.x+(n.x-c.x)*r/d2, by=c.y+(n.y-c.y)*r/d2;
      d += " L"+ax+","+ay+" Q"+c.x+","+c.y+" "+bx+","+by;
    }
    const z=pts[pts.length-1]; return d+" L"+z.x+","+z.y;
  }
  const svg = document.querySelector("svg.edges");
  for (const e of EDGES){
    const a = anchor(e.from, e.fromSide||"right", e.fromOff);
    const z = anchor(e.to, e.toSide||"left", e.toOff);
    const pts = fill(route(a, e.fromSide||"right", z, e.toSide||"left", e.via));
    const path = document.createElementNS("http://www.w3.org/2000/svg","path");
    const accent = e.style && e.style.includes("accent");
    path.setAttribute("d", pathD(pts, 10));
    path.setAttribute("fill","none");
    path.setAttribute("stroke", accent ? "${theme.accent}" : "${theme.line}");
    path.setAttribute("stroke-width", accent ? 2.2 : 1.7);
    if (e.style && e.style.includes("dashed")) path.setAttribute("stroke-dasharray","5 4");
    if (!e.noArrow) path.setAttribute("marker-end", accent ? "url(#arrA)" : "url(#arr)");
    if (e.both) path.setAttribute("marker-start", accent ? "url(#arrA)" : "url(#arr)");
    svg.appendChild(path);
    if (e.label){
      let lx, ly;
      if (e.labelAt) { lx=e.labelAt[0]; ly=e.labelAt[1]; }
      else { // midpoint of the longest segment
        let best=0, bi=0; for (let i=0;i<pts.length-1;i++){ const L=Math.hypot(pts[i+1].x-pts[i].x,pts[i+1].y-pts[i].y); if(L>best){best=L;bi=i;} }
        lx=(pts[bi].x+pts[bi+1].x)/2; ly=(pts[bi].y+pts[bi+1].y)/2;
      }
      const div=document.createElement("div");
      div.className="elabel"+(accent?" accent":"");
      div.style.left=lx+"px"; div.style.top=ly+"px";
      div.innerHTML=(e.labelIcon?LABEL_ICONS[e.labelIcon]:"")+"<span>"+e.label.split("\\n").map(s=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;")).join("<br>")+"</span>";
      canvas.appendChild(div);
    }
  }
  window.__done = true;
  </script></body></html>`;
}

const browser = await chromium.launch();
const only = process.env.ONLY;
for (const spec of diagrams) {
  if (only && spec.name !== only) continue;
  for (const [themeName, theme] of Object.entries(THEMES)) {
    const page = await browser.newPage({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setContent(render(spec, theme));
    await page.waitForFunction(() => window.__done === true);
    if (errors.length) throw new Error(`${spec.name}/${themeName}: ${errors.join("; ")}`);
    const file = `${outDir}/${spec.name}-${themeName}.png`;
    await page.locator("#canvas").screenshot({ path: file });
    console.log("wrote", file);
    await page.close();
  }
}
await browser.close();

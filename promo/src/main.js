// DrawY — a sixty-second film. Every frame is a pure function of time: render(t).
import {
  W, H, BEAT, clamp, lerp, prog, ease, window_, random, svg, div, img, pic, css, attr, show,
  handLine, pathOf, Ink, Sketcher, CUES, cue, cueStroke,
} from "./lib.js";
import { Pencil, Cursor, cursorAt, Caption, sparkSvg, LANTERN, Finder, paperGrain } from "./hud.js";
import { makeSolar, makeWater, makeLeaf, makeApples, makeLLM, makeHeart, makeSilk, makeRed, makePage } from "./drawings.js";

const f1 = (n) => Math.round(n * 10) / 10;
const DURATION = 60;
const stage = document.getElementById("stage");

await document.fonts.ready;
const FACES = [
  '600 60px "Noto Serif SC"',
  '500 40px "Noto Serif SC"',
  '400 30px "LXGW WenKai"',
  '400 30px "Noto Sans SC"',
  '500 30px "Noto Sans SC"',
  'italic 400 34px "Instrument Serif"',
  '500 150px "Fraunces"',
];

// ---------- shared SVG filters ----------
const defsSvg = svg("svg", { width: 0, height: 0, style: "position:absolute" }, stage);
defsSvg.innerHTML = `
<defs>
  <filter id="graphite" x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.45" result="m"/>
    <feComposite in="SourceGraphic" in2="m" operator="in" result="g"/>
    <feDisplacementMap in="g" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="wash" x="-10%" y="-20%" width="120%" height="140%">
    <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="9" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="26" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feGaussianBlur in="d" stdDeviation="1.4"/>
  </filter>
  <filter id="softShadow" x="-20%" y="-20%" width="140%" height="150%">
    <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#3c2d14" flood-opacity="0.14"/>
  </filter>
  <filter id="penShadow" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="5"/>
  </filter>
  <filter id="mblur" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feGaussianBlur id="mblurG" stdDeviation="0 0" edgeMode="duplicate"/>
  </filter>
</defs>`;
const mblurG = defsSvg.querySelector("#mblurG");

// ---------- layers ----------
function layer(bg) {
  const el = div("layer", stage);
  if (bg) el.style.background = bg;
  const world = div("world", el);
  return { el, world };
}
const desk = layer();
const water = layer("#faf9f5");
const leaf = layer("#faf9f5");
const mural = layer("#ebe5d6");
const hudEl = div("hud", stage);

/** A camera: page point p lands on screen at (p - c) * z + centre + (ox, oy). */
const project = (cam, p) => [(p[0] - cam.cx) * cam.z + W / 2 + (cam.ox || 0), (p[1] - cam.cy) * cam.z + H / 2 + (cam.oy || 0)];
function aim(L, cam) {
  css(L.world, "transform", `translate(${f1(W / 2 + (cam.ox || 0))}px, ${f1(H / 2 + (cam.oy || 0))}px) scale(${Math.round(cam.z * 10000) / 10000}) translate(${f1(-cam.cx)}px, ${f1(-cam.cy)}px)`);
}
const logLerp = (a, b, k) => Math.exp(lerp(Math.log(a), Math.log(b), k));

// =====================================================================================
// Act I — a tangle of pencil lines that pulls itself into the composer.
// =====================================================================================
const deskPage = makePage(desk.world, 0, 0);
const dots = div("page dotted", deskPage.page, { left: 0, top: 0, backgroundColor: "transparent" });
deskPage.page.insertBefore(dots, deskPage.page.firstChild);

const CX = 960,
  CY = 500;
const tangleR = random(3);
const TN = 2200;
const tanglePts = [];
for (let i = 0; i <= TN; i++) {
  const s = i / TN;
  const cx = CX + 200 * Math.sin(2 * Math.PI * 1.15 * s + 0.4) + 90 * Math.sin(2 * Math.PI * 2.7 * s + 1.1);
  const cy = CY + 80 * Math.sin(2 * Math.PI * 0.9 * s + 1.7) + 45 * Math.sin(2 * Math.PI * 2.3 * s);
  const rad = 60 + 70 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 3.7 * s + 0.5)) + 22 * Math.sin(2 * Math.PI * 9.1 * s);
  const a = 2 * Math.PI * 27 * s + Math.sin(s * 53) * 0.35;
  tanglePts.push([cx + rad * Math.cos(a) * 1.25 + (tangleR() - 0.5) * 7, cy + rad * Math.sin(a) * 0.92 + (tangleR() - 0.5) * 7]);
}
// a tail where the pencil comes in
const tail = [[1500, 860], [1350, 760], [1220, 640]];
const tangleAll = [...tail.map((p) => p), ...tanglePts];
const T_DRAW0 = 0.45,
  T_DRAW1 = 4.55;
const tangle = new Ink(deskPage.front, pathOf(tangleAll), T_DRAW0, T_DRAW1, { stroke: "#45413a", "stroke-width": 2.3, filter: "url(#graphite)" }, (x) => x);
cueStroke(T_DRAW0, T_DRAW1, 1.15, "scribble");
const morphPath = svg("path", { fill: "none", stroke: "#45413a", "stroke-width": 2.3, "stroke-linejoin": "round", "stroke-linecap": "round" }, deskPage.front);

// the composer's outline, where the tangle ends up
const HOME = { x: 500, y: 455, w: 920, h: 196, r: 40 };
const DOCK = { x: 600, y: 958, w: 720, h: 78, r: 39 };
function roundedRect({ x, y, w, h, r }, n) {
  // points round the rect, starting at the left end of its top edge, clockwise
  const seg = [];
  const per = 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r;
  const at = (d) => {
    const L1 = w - 2 * r,
      A = (Math.PI * r) / 2,
      L2 = h - 2 * r;
    const parts = [
      [L1, (u) => [x + r + u * L1, y]],
      [A, (u) => [x + w - r + Math.sin((u * Math.PI) / 2) * r, y + r - Math.cos((u * Math.PI) / 2) * r]],
      [L2, (u) => [x + w, y + r + u * L2]],
      [A, (u) => [x + w - r + Math.cos((u * Math.PI) / 2) * r, y + h - r + Math.sin((u * Math.PI) / 2) * r]],
      [L1, (u) => [x + w - r - u * L1, y + h]],
      [A, (u) => [x + r - Math.sin((u * Math.PI) / 2) * r, y + h - r + Math.cos((u * Math.PI) / 2) * r]],
      [L2, (u) => [x, y + h - r - u * L2]],
      [A, (u) => [x + r - Math.cos((u * Math.PI) / 2) * r, y + r - Math.sin((u * Math.PI) / 2) * r]],
    ];
    for (const [len, fn] of parts) {
      if (d <= len) return fn(d / len);
      d -= len;
    }
    return [x + r, y];
  };
  for (let i = 0; i <= n; i++) seg.push(at(((i / n) * per) % per));
  return seg;
}
const RECT = roundedRect(HOME, tangleAll.length - 1);
// start the outline where the tangle's own loops would rather go: rotate the target
const ROT = Math.floor(RECT.length * 0.62);
const RECT2 = RECT.map((_, i) => RECT[(i + ROT) % RECT.length]);
const M0 = 5.1,
  M1 = 7.25;
cue(M0, "morph", { dur: M1 - M0 });

// question marks around the tangle
const qs = [
  [640, 300, -14, 1.5],
  [1290, 270, 12, 2.1],
  [1340, 690, -8, 2.8],
  [600, 700, 16, 3.4],
].map(([x, y, rot, t]) => {
  const el = svg("text", { x: 0, y: 0, "font-size": 96, fill: "#45413a", style: "font-family:'Instrument Serif',serif;font-style:italic", filter: "url(#graphite)" }, deskPage.front);
  el.textContent = "?";
  cue(t, "pop");
  return { el, x, y, rot, t };
});

// ---------- the composer ----------
const comp = div("composer", hudEl);
const homeBox = div("", comp, { position: "absolute", inset: "0" });
const field = div("field", homeBox);
const typed = document.createElement("span");
const caret = document.createElement("span");
caret.className = "caret";
const ph = document.createElement("span");
ph.className = "placeholder";
ph.textContent = "想把什么画出来？";
field.append(typed, caret, ph);
const tools = div("tools", homeBox);
tools.innerHTML = `
  <span class="tool"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#5e5d59" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span>
  <span class="tool chip"><img src="${pic("apple-crayon")}"/>画风 · 自动</span>
  <span class="gap"></span>`;
const sendBtn = div("send", tools);
sendBtn.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>`;
const dockBox = div("dock", comp);
const dockSpark = sparkSvg(dockBox, 34);
const statusBox = div("status", dockBox);
const stopBtn = div("stop", dockBox);
stopBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18"><rect x="2" y="2" width="14" height="14" rx="3" fill="#fff"/></svg>`;
const sendSmall = div("stop", dockBox);
sendSmall.innerHTML = sendBtn.innerHTML.replace('width="28" height="28"', 'width="24" height="24"');
sendSmall.style.position = "absolute";
sendSmall.style.right = "12px";
const PROMPT = "太阳系是如何运转的？";
const keyTimes = [];
{
  const r = random(12);
  let t = 8.1;
  for (const _ of PROMPT) {
    keyTimes.push(t);
    cue(t, "key");
    t += 0.11 + r() * 0.09;
  }
}
const SEND = 10.0;
cue(SEND, "click");
cue(SEND + 0.12, "send");
const STATUSES = [
  [10.45, "正在理解你的想法…", true],
  [11.25, "定下创作简报", true],
  [12.7, "起稿 · 太阳系的构图", true],
  [17.4, "显影图片 · 7 张", true],
  [19.4, "落笔 · 轨道与名字", true],
  [22.5, "查看画布", true],
  [24.3, "地球太小 → 放大，再添上月球", true],
  [26.5, "完成 ✓", false],
  [28.75, "展开“地球”场景，保持作品风格。", true],
  [31.0, "落笔 · 地球上的水循环", true],
  [33.55, "展开“树”场景，保持作品风格。", true],
  [35.6, "落笔 · 一片叶子里的光合作用", true],
  [38.0, "完成 ✓", false],
];
const statusEls = STATUSES.map(([, s]) => {
  const el = document.createElement("span");
  el.textContent = s;
  statusBox.appendChild(el);
  return el;
});

// ---------- title and scene path ----------
const crumbs = div("crumbs", hudEl);
const lanternMark = svg("svg", { width: 40, height: 40, viewBox: "0 0 24 24", style: "overflow:visible" }, crumbs);
lanternMark.innerHTML = `<circle cx="12" cy="13.6" r="5.2" fill="#e9a93a" opacity=".16"/><g fill="none" stroke="#d97757" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${LANTERN.frame.map((d) => `<path d="${d}"/>`).join("")}${LANTERN.rays.map((d) => `<path d="${d}" stroke="#e9a93a" stroke-width="1.6"/>`).join("")}<path d="${LANTERN.candle}" fill="#d97757" fill-opacity=".85" stroke-width=".9"/><path d="${LANTERN.flame}" fill="#e9a93a" stroke="#e08f2c" stroke-width=".7"/></g>`;
const crumbMain = div("seg", crumbs);
crumbMain.textContent = "太阳系是如何运转的";
const crumbSegs = ["地球上的水循环", "光合作用"].map((s) => {
  const el = div("seg sub", crumbs);
  el.innerHTML = `<span class="sep">›</span>${s}`;
  return el;
});

// =====================================================================================
// Act II — the brief, the sketch, the drawing, a second look. (desk layer)
// =====================================================================================
const SOLAR_T0 = 10.8;
const solar = makeSolar(deskPage.front.parentNode, { cues: true, T0: SOLAR_T0, freeze: 28.7 - SOLAR_T0 });
// solar builds its own page; keep the desk's sheet as its paper
solar.page.style.background = "transparent";
/** Earth on the desk, in film time. */
const earthAbs = (t) => solar.earthAt(t - SOLAR_T0);
const earthRAbs = (t) => solar.earthR(t - SOLAR_T0);

// =====================================================================================
// Act III — into Earth, into the tree.
// =====================================================================================
const WATER_T0 = 29.2,
  LEAF_T0 = 33.85;
const waterD = makeWater(water.world, { cues: true, T0: WATER_T0 });
const leafD = makeLeaf(leaf.world, { cues: true, T0: LEAF_T0 });

// =====================================================================================
// Act IV — the mural: styles, a montage, and everything at once.
// =====================================================================================
const G = 160;
const tileAt = (row, col) => [col * (W + G), row * (H + G)];
const tileC = (row, col) => [col * (W + G) + W / 2, row * (H + G) + H / 2];
const shadowTile = (p) => (p.style.boxShadow = "0 2px 4px rgba(60,45,20,.06), 0 30px 70px rgba(60,45,20,.16)");
const tiles = [];
const addTile = (row, col, make, opts) => {
  const [x, y] = tileAt(row, col);
  const d = make(mural.world, { x, y, ...opts });
  shadowTile(d.page);
  tiles.push({ d, row, col, T0: opts.T0 ?? 0, final: opts.final });
  return d;
};
const APPLES_T0 = 40.0,
  LLM_T0 = 45.25,
  HEART_T0 = 46.5,
  SILK_T0 = 47.75,
  RED_T0 = 49.0;
addTile(0, 0, makeSolar, { title: true, final: true });
addTile(0, 1, makeWater, { title: true, final: true });
addTile(0, 2, makeLeaf, { title: true, final: true });
const applesD = addTile(1, 0, makeApples, { cues: true, T0: APPLES_T0, title: true });
const llmD = addTile(2, 0, makeLLM, { cues: true, T0: LLM_T0 });
const heartD = addTile(2, 1, makeHeart, { cues: true, T0: HEART_T0 });
const silkD = addTile(2, 2, makeSilk, { cues: true, T0: SILK_T0 });
const redD = addTile(1, 2, makeRed, { cues: true, T0: RED_T0 });

// ---------- the centre tile: the lantern is lit ----------
const [LX0, LY0] = tileAt(1, 1);
const endPage = makePage(mural.world, LX0, LY0);
shadowTile(endPage.page);
const glow = div("", endPage.page, { position: "absolute", inset: "0", background: "radial-gradient(60% 70% at 37% 42%, rgba(233,169,58,.34), rgba(233,169,58,.08) 55%, transparent 75%)", opacity: 0 });
endPage.page.insertBefore(glow, endPage.page.firstChild);
const LS = 11.5; // lantern scale: 24 units → 276 px
const LAN = { x: 528, y: 262 };
const lanG = svg("g", { transform: `translate(${LAN.x} ${LAN.y}) scale(${LS})` }, endPage.front);
const glowC = svg("circle", { cx: 12, cy: 13.6, r: 5.2, fill: "#e9a93a", opacity: 0 }, lanG);
const endSk = new Sketcher();
const LAN_T0 = 53.95;
const lanStyle = { stroke: "#d97757", "stroke-width": 1.55 };
const lanInks = LANTERN.frame.map((d, i) => {
  const t0 = LAN_T0 + i * 0.13;
  cueStroke(t0, t0 + 0.12, 0.9);
  return endSk.add(new Ink(lanG, d, t0, t0 + 0.12, lanStyle));
});
const candle = endSk.add(new Ink(lanG, LANTERN.candle, LAN_T0 + 0.95, LAN_T0 + 1.02, { ...lanStyle, "stroke-width": 0.9, fill: "none" }));
const candleFill = svg("path", { d: LANTERN.candle, fill: "#d97757", opacity: 0 }, lanG);
const IGNITE = 55.0;
cue(IGNITE, "ignite");
const rayInks = LANTERN.rays.map((d, i) => new Ink(lanG, d, IGNITE + 0.08 + i * 0.05, IGNITE + 0.2 + i * 0.05, { stroke: "#e9a93a", "stroke-width": 1.6 }));
const flame = svg("path", { d: LANTERN.flame, fill: "#e9a93a", stroke: "#e08f2c", "stroke-width": 0.7, style: "transform-origin:12.1px 15.6px; transform-box: view-box" }, lanG);
// project a lantern point to the page, for the pencil
const lanPt = (p) => [LAN.x + p[0] * LS, LAN.y + p[1] * LS];
const brand = div("brandline", endPage.page, { left: "860px", top: "300px" });
const name = div("name", brand);
const nameChars = [..."DrawY"].map((c) => {
  const s = document.createElement("span");
  s.textContent = c;
  name.appendChild(s);
  return s;
});
const tagline = new Caption(endPage.page, { zh: "每个想法，都值得探索", en: "Every idea is worth exploring.", t0: 55.85, t1: 999, y: 600, marks: ["探索"], size: 64 });
const cta = div("composer", endPage.page, { left: "560px", top: "790px", width: "800px", height: "84px", borderRadius: "42px" });
cta.innerHTML = `<div style="position:absolute;left:34px;top:0;line-height:84px;font-size:30px;color:#a8a499"><span class="caret" style="display:inline-block;width:2.5px;height:34px;background:#141413;vertical-align:-7px;margin-right:6px"></span>想把什么画出来？</div>
<div class="send" style="position:absolute;right:12px;top:12px;width:60px;height:60px;border-radius:50%;background:#141413;display:grid;place-items:center">${sendBtn.innerHTML}</div>`;
const ctaCaret = cta.querySelector(".caret");
const url = div("", endPage.page, { position: "absolute", left: "0", width: "1920px", top: "920px", textAlign: "center", fontFamily: "'Instrument Serif', serif", fontSize: "34px", color: "#8b887f", letterSpacing: ".02em" });
url.textContent = "github.com/Ezio2000/DrawY";

// ---------- HUD things ----------
const captions = [
  { zh: "脑子里有个想法，", en: "You have an idea,", t0: 0.7, t1: 3.55 },
  { zh: "可它还是一团乱线。", en: "but it's still a tangle.", t0: 3.7, t1: 6.6, marks: ["乱线"] },
  { zh: "说给 DrawY 听。", en: "Tell DrawY.", t0: 7.35, t1: 10.1, marks: ["DrawY"] },
  { zh: "它先听懂你，", en: "It listens first,", t0: 10.55, t1: 12.9, marks: ["听懂"] },
  { zh: "再一笔一笔，画出来。", en: "then draws it, stroke by stroke.", t0: 13.0, t1: 17.2, marks: ["一笔一笔"] },
  { zh: "草稿显影，成画。", en: "The sketch develops into a picture.", t0: 17.45, t1: 22.25, marks: ["显影"] },
  { zh: "画完，它会自己看一遍，再改好。", en: "Then it looks at its own work, and makes it better.", t0: 22.5, t1: 27.3, marks: ["再改好"] },
  { zh: "每一处，都能点开。", en: "Every part opens up.", t0: 27.55, t1: 31.2, marks: ["点开"] },
  { zh: "一层一层，越看越深。", en: "Layer by layer, deeper and deeper.", t0: 31.45, t1: 38.6, marks: ["越看越深"] },
  { zh: "同一个想法，十种画风。", en: "One idea. Ten styles.", t0: 40.1, t1: 44.85, marks: ["十种画风"] },
  { zh: "好奇什么，就画什么。", en: "Whatever you're curious about.", t0: 45.05, t1: 49.85, marks: ["好奇"] },
].map((c) => new Caption(hudEl, c));

// the rim of the window a dive opens into the next scene
const ring = div("", stage, { position: "absolute", borderRadius: "50%", pointerEvents: "none", boxShadow: "0 0 0 3px rgba(217,119,87,.55), 0 0 0 10px rgba(217,119,87,.12), inset 0 0 40px rgba(60,45,20,.12)" });
stage.insertBefore(ring, hudEl);
let ringShown = false;
function portal(x, y, R, a) {
  ringShown = a > 0.01;
  if (!ringShown) return;
  css(ring, "left", f1(x - R) + "px");
  css(ring, "top", f1(y - R) + "px");
  css(ring, "width", f1(2 * R) + "px");
  css(ring, "height", f1(2 * R) + "px");
  css(ring, "opacity", String(f1(a * 100) / 100));
}
const finder = new Finder(hudEl, "查看画布");
const cursor = new Cursor(hudEl);
const pencil = new Pencil(hudEl);
paperGrain(stage);
div("vignette", stage);
cue(22.65, "finder");
cue(23.65, "shutter");
cue(26.3, "shutter");
cue(28.55, "click");
cue(28.75, "dive", { dur: 1.4 });
cue(33.4, "click");
cue(33.55, "dive", { dur: 1.2 });
cue(38.8, "whip");
const PANS = [45.0, 46.25, 47.5, 48.75];
PANS.forEach((t) => cue(t, "pan"));
cue(50.0, "reveal", { dur: 2.0 });
cue(52.6, "zoomin", { dur: 1.4 });

// =====================================================================================
// Cameras
// =====================================================================================
const DIVE1 = [28.75, 30.15],
  DIVE2 = [33.55, 34.75];
const S1 = 0.062,
  S2 = 0.15;
function deskCam(t) {
  const k = ease.inOut2(prog(t, 12, 28.5));
  const base = { cx: lerp(960, 1000, k), cy: lerp(540, 552, k), z: lerp(1, 1.05, k) };
  const u = prog(t, DIVE1[0], DIVE1[1]);
  if (u <= 0) return base;
  const e = earthAbs(t);
  const zEnd = 1 / S1;
  const zu = ease.in2(u) * 0.35 + ease.inOut(u) * 0.65;
  return {
    cx: lerp(base.cx, e.x, ease.out(prog(u, 0, 0.7))),
    cy: lerp(base.cy, e.y, ease.out(prog(u, 0, 0.7))),
    z: logLerp(base.z, zEnd, zu),
  };
}
function waterCam(t) {
  const k = ease.inOut2(prog(t, 30.2, 33.4));
  const base = { cx: 960, cy: 540, z: lerp(1, 1.025, k) };
  if (t < DIVE1[1]) {
    // carried inside Earth by the desk camera
    const dc = deskCam(t),
      e = earthAbs(t);
    const [ex, ey] = project(dc, [e.x, e.y]);
    return { cx: 960, cy: 540, z: S1 * dc.z, ox: ex - W / 2, oy: ey - H / 2 };
  }
  const u = prog(t, DIVE2[0], DIVE2[1]);
  if (u <= 0) return base;
  const zu = ease.in2(u) * 0.35 + ease.inOut(u) * 0.65;
  const T = waterD.tree;
  return {
    cx: lerp(base.cx, T[0], ease.out(prog(u, 0, 0.7))),
    cy: lerp(base.cy, T[1], ease.out(prog(u, 0, 0.7))),
    z: logLerp(base.z, 1 / S2, zu),
  };
}
const WHIP = [38.8, 39.4];
function leafCam(t) {
  if (t < DIVE2[1]) {
    const wc = waterCam(t),
      T = waterD.tree;
    const [tx, ty] = project(wc, T);
    return { cx: 960, cy: 540, z: S2 * wc.z, ox: tx - W / 2, oy: ty - H / 2 };
  }
  const k = ease.inOut2(prog(t, 34.8, 38.8));
  return { cx: 960, cy: 540, z: lerp(1, 1.03, k), ox: -2600 * ease.in(prog(t, WHIP[0], WHIP[1])) };
}
const ZFULL = 0.272;
function muralCam(t) {
  const c10 = tileC(1, 0);
  let cam = { cx: c10[0], cy: c10[1], z: 1, ox: 2600 * (1 - ease.out(prog(t, 39.25, 40.0))) };
  if (t >= 40) cam = { cx: c10[0], cy: c10[1], z: lerp(1, 1.02, prog(t, 40, 45)) };
  const path = [tileC(1, 0), tileC(2, 0), tileC(2, 1), tileC(2, 2), tileC(1, 2)];
  if (t >= 45) {
    let c = path[0];
    PANS.forEach((p0, i) => {
      const u = ease.inOut(prog(t, p0, p0 + 0.45));
      if (t >= p0) c = [lerp(path[i][0], path[i + 1][0], u), lerp(path[i][1], path[i + 1][1], u)];
    });
    cam = { cx: c[0], cy: c[1], z: 1 };
  }
  if (t >= 50) {
    const u = ease.inOut(prog(t, 50, 51.9));
    const mid = tileC(1, 1),
      from = tileC(1, 2);
    const drift = prog(t, 51.9, 52.6);
    cam = { cx: lerp(from[0], mid[0], ease.inOut2(prog(t, 50, 51.6))), cy: lerp(from[1], mid[1], u), z: logLerp(1, ZFULL, u) * (1 + 0.02 * drift) };
  }
  if (t >= 52.6) {
    const mid = tileC(1, 1);
    const u = ease.inOut(prog(t, 52.6, 54.0));
    cam = { cx: mid[0], cy: mid[1], z: logLerp(ZFULL * 1.02, 1, u) * (1 + 0.035 * ease.inOut2(prog(t, 54, 60))) };
  }
  return cam;
}

/** Blur along the direction a camera is moving fast. */
function motionBlur(L, camFn, t) {
  const a = camFn(t),
    b = camFn(t + 1 / 60);
  const pa = project(a, [a.cx, a.cy]);
  // screen speed of the paper under the centre
  const dx = ((b.cx - a.cx) * a.z - ((b.ox || 0) - (a.ox || 0))) * 60;
  const dy = ((b.cy - a.cy) * a.z - ((b.oy || 0) - (a.oy || 0))) * 60;
  const sx = Math.min(40, Math.abs(dx) / 260),
    sy = Math.min(40, Math.abs(dy) / 260);
  if (sx < 0.8 && sy < 0.8) {
    css(L.el, "filter", "none");
    return;
  }
  attr(mblurG, "stdDeviation", `${f1(sx)} ${f1(sy)}`);
  css(L.el, "filter", "url(#mblur)");
}

// =====================================================================================
// render(t)
// =====================================================================================
function render(t) {
  ringShown = false;
  // ---------------- desk ----------------
  const deskOn = t < DIVE1[1] + 0.02;
  show(desk.el, deskOn);
  if (deskOn) {
    const dc = deskCam(t);
    aim(desk, dc);
    css(dots, "opacity", String(f1(prog(t, 10.3, 11.1) * 100) / 100));
    // tangle, drawing then pulling into the outline
    const mu = prog(t, M0, M1);
    if (mu <= 0) {
      show(tangle.el, true);
      show(morphPath, false);
      tangle.update(t);
    } else {
      show(tangle.el, false);
      const n = tangleAll.length;
      const pts = tangleAll.map((p, i) => {
        const k = ease.inOut(clamp(mu * 1.7 - 0.7 * (1 - i / n)));
        const q = RECT2[i];
        return [lerp(p[0], q[0], k), lerp(p[1], q[1], k)];
      });
      const done = prog(t, M1 - 0.1, M1 + 0.35);
      show(morphPath, done < 1);
      attr(morphPath, "d", pathOf(pts));
      attr(morphPath, "stroke", done > 0 ? "#cfc9bb" : "#45413a");
      attr(morphPath, "opacity", String(f1((1 - done) * 100) / 100));
      attr(morphPath, "filter", mu < 0.6 ? "url(#graphite)" : "");
    }
    qs.forEach((q) => {
      const p = ease.back(prog(t, q.t, q.t + 0.35));
      const out = ease.in2(prog(t, 5.0, 5.6));
      attr(q.el, "transform", `translate(${q.x} ${f1(q.y - out * 40)}) rotate(${q.rot}) scale(${f1(p * 100) / 100})`);
      attr(q.el, "opacity", String(f1(clamp(p) * (1 - out) * 100) / 100));
    });
    solar.update(t - SOLAR_T0);
  }

  // ---------------- water ----------------
  const waterOn = t > DIVE1[0] + 0.15 && t < DIVE2[1] + 0.02;
  show(water.el, waterOn);
  if (waterOn) {
    const wc = waterCam(t);
    aim(water, wc);
    waterD.update(t - WATER_T0);
    const u = prog(t, DIVE1[0], DIVE1[1]);
    if (u < 1) {
      const dc = deskCam(t),
        e = earthAbs(t);
      const [ex, ey] = project(dc, [e.x, e.y]);
      const R = earthRAbs(t) * dc.z * lerp(1, 3.2, ease.in2(u));
      css(water.el, "clipPath", `circle(${f1(R)}px at ${f1(ex)}px ${f1(ey)}px)`);
      css(water.el, "opacity", String(f1(ease.inOut2(prog(u, 0.16, 0.42)) * 100) / 100));
      portal(ex, ey, R, ease.inOut2(prog(u, 0.16, 0.42)) * (1 - prog(u, 0.75, 0.95)));
    } else {
      css(water.el, "clipPath", "none");
      css(water.el, "opacity", "1");
    }
  }

  // ---------------- leaf ----------------
  const leafOn = t > DIVE2[0] + 0.12 && t < WHIP[1] + 0.02;
  show(leaf.el, leafOn);
  if (leafOn) {
    const lc = leafCam(t);
    aim(leaf, lc);
    leafD.update(t - LEAF_T0);
    const u = prog(t, DIVE2[0], DIVE2[1]);
    if (u < 1) {
      const wc = waterCam(t);
      const [tx, ty] = project(wc, waterD.tree);
      const R = 140 * wc.z * lerp(1, 1.9, ease.in2(u));
      css(leaf.el, "clipPath", `circle(${f1(R)}px at ${f1(tx)}px ${f1(ty)}px)`);
      css(leaf.el, "opacity", String(f1(ease.inOut2(prog(u, 0.08, 0.32)) * 100) / 100));
      portal(tx, ty, R, ease.inOut2(prog(u, 0.08, 0.32)) * (1 - prog(u, 0.75, 0.95)));
    } else {
      css(leaf.el, "clipPath", "none");
      css(leaf.el, "opacity", "1");
    }
    motionBlur(leaf, leafCam, t);
  }

  // ---------------- mural ----------------
  const muralOn = t > 39.2;
  show(mural.el, muralOn);
  if (muralOn) {
    const mc = muralCam(t);
    aim(mural, mc);
    if (t < 50) motionBlur(mural, muralCam, t);
    else css(mural.el, "filter", "none");
    for (const tl of tiles) tl.d.update(tl.final ? t + 40 : t - tl.T0);
    // the lantern
    endSk.update(t);
    candle.update(t);
    attr(candleFill, "opacity", String(f1(prog(t, LAN_T0 + 0.98, LAN_T0 + 1.15) * 85) / 100));
    rayInks.forEach((r) => r.update(t));
    const fl = ease.spring(prog(t, IGNITE, IGNITE + 0.7));
    const flick = 1 + 0.04 * Math.sin(t * 13) + 0.03 * Math.sin(t * 7.3);
    css(flame, "transform", `scale(${f1(fl * flick * 100) / 100}, ${f1(fl * (2 - flick) * 100) / 100})`);
    attr(flame, "opacity", String(f1(clamp(fl) * 100) / 100));
    const gl = ease.out(prog(t, IGNITE, IGNITE + 0.9));
    attr(glowC, "opacity", String(f1(gl * 22) / 100));
    attr(glowC, "r", f1(5.2 + 2.5 * gl + 0.3 * Math.sin(t * 6)));
    css(glow, "opacity", String(f1((ease.out(prog(t, IGNITE, IGNITE + 0.5)) * 0.9 - 0.35 * ease.inOut2(prog(t, IGNITE + 0.5, IGNITE + 2.2))) * 100) / 100));
    nameChars.forEach((c, i) => {
      const p = ease.out(prog(t, IGNITE + 0.15 + i * 0.07, IGNITE + 0.75 + i * 0.07));
      css(c, "opacity", String(f1(p * 100) / 100));
      css(c, "transform", `translateY(${f1((1 - p) * 40)}px)`);
      css(c, "filter", p < 1 ? `blur(${f1((1 - p) * 8)}px)` : "none");
    });
    tagline.update(t);
    const cp = ease.out(prog(t, 56.85, 57.5));
    css(cta, "opacity", String(f1(cp * 100) / 100));
    css(cta, "transform", `translateY(${f1((1 - cp) * 30)}px)`);
    css(ctaCaret, "opacity", (t - 57.3) % 1 < 0.55 ? "1" : "0");
    css(url, "opacity", String(f1(prog(t, 57.4, 58.0) * 100) / 100));
  }

  // ---------------- composer ----------------
  const compOn = t > 7.1 && t < WHIP[0] + 0.4;
  show(comp, compOn);
  if (compOn) {
    const appear = ease.out(prog(t, 7.15, 7.6));
    const g = ease.inOut(prog(t, SEND + 0.15, SEND + 0.9));
    const geo = {};
    for (const k of ["x", "y", "w", "h", "r"]) geo[k] = lerp(HOME[k], DOCK[k], g);
    const whipOut = ease.in2(prog(t, WHIP[0], WHIP[0] + 0.35));
    css(comp, "left", f1(geo.x) + "px");
    css(comp, "top", f1(geo.y + whipOut * 160) + "px");
    css(comp, "width", f1(geo.w) + "px");
    css(comp, "height", f1(geo.h) + "px");
    css(comp, "borderRadius", f1(geo.r) + "px");
    css(comp, "opacity", String(f1(appear * (1 - whipOut) * 100) / 100));
    const homeA = 1 - prog(t, SEND + 0.3, SEND + 0.5);
    css(homeBox, "opacity", String(f1(homeA * ease.out(prog(t, 7.35, 7.8)) * 100) / 100));
    const n = keyTimes.filter((k) => t >= k).length;
    typed.textContent = PROMPT.slice(0, n);
    show(ph, n === 0);
    css(caret, "opacity", n > 0 && n < PROMPT.length ? "1" : (t % 1) < 0.55 ? "1" : "0");
    const press = t > SEND - 0.06 && t < SEND + 0.14 ? Math.sin(prog(t, SEND - 0.06, SEND + 0.14) * Math.PI) : 0;
    css(sendBtn, "transform", `scale(${f1((1 - 0.12 * press) * 100) / 100})`);
    css(sendBtn, "opacity", n === PROMPT.length ? "1" : "0.25");
    css(dockBox, "opacity", String(f1(prog(t, SEND + 0.45, SEND + 0.75) * 100) / 100));
    // status line
    let cur = -1;
    STATUSES.forEach(([s], i) => t >= s && (cur = i));
    statusEls.forEach((el, i) => {
      const s = STATUSES[i][0];
      const inP = ease.out(prog(t, s, s + 0.35));
      const next = STATUSES[i + 1];
      const outP = next ? ease.in2(prog(t, next[0], next[0] + 0.25)) : 0;
      show(el, t >= s - 0.01 && outP < 1);
      css(el, "transform", `translateY(${f1((1 - inP) * 24 - outP * 24)}px)`);
      css(el, "opacity", String(f1(inP * (1 - outP) * 100) / 100));
    });
    const working = cur >= 0 && STATUSES[cur][2];
    dockSpark.twinkle(t, working);
    show(stopBtn, working);
    show(sendSmall, !working);
  }

  // ---------------- title and scene path ----------------
  const crOn = t > 10.6 && t < WHIP[0] + 0.4;
  show(crumbs, crOn);
  if (crOn) {
    const a = ease.out(prog(t, 10.6, 11.2)) * (1 - ease.in2(prog(t, WHIP[0], WHIP[0] + 0.3)));
    css(crumbs, "opacity", String(f1(a * 100) / 100));
    css(crumbs, "transform", `translateY(${f1((1 - ease.out(prog(t, 10.6, 11.2))) * -12)}px)`);
    [29.7, 34.3].forEach((s, i) => {
      const p = ease.out(prog(t, s, s + 0.45));
      show(crumbSegs[i], p > 0);
      css(crumbSegs[i], "opacity", String(f1(p * 100) / 100));
      css(crumbSegs[i], "transform", `translateX(${f1((1 - p) * 30)}px)`);
    });
  }

  show(ring, ringShown);
  // ---------------- captions ----------------
  captions.forEach((c) => c.update(t));

  // ---------------- viewfinder ----------------
  if (t > 22.55 && t < 27.0) {
    const dc = deskCam(t);
    const e = earthAbs(t);
    const whole = (() => {
      const [x0, y0] = project(dc, [560, 300]),
        [x1, y1] = project(dc, [1680, 820]);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    })();
    const [ex, ey] = project(dc, [e.x, e.y]);
    const near = { x: ex - 150, y: ey - 120, w: 300, h: 240 };
    const toNear = ease.inOut(prog(t, 23.0, 23.55));
    const toWhole = ease.inOut(prog(t, 25.7, 26.15));
    const mix = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k) });
    const box = mix(mix(whole, near, toNear), whole, toWhole);
    const alpha = window_(t, 22.55, 27.0, 0.25, 0.35);
    const flash = Math.max(1 - prog(t, 23.65, 23.95), 0) * (t >= 23.65 ? 1 : 0) + Math.max(1 - prog(t, 26.3, 26.6), 0) * (t >= 26.3 ? 1 : 0);
    finder.update({ ...box, alpha, flash, label: t > 26.2 ? "再看一遍 ✓" : t > 23.6 ? "查看画布 · 地球" : "查看画布" });
  } else finder.update(null);

  // ---------------- cursor ----------------
  const c1 = cursorAt(t, {
    from: [1560, 930],
    t0: 27.7,
    t1: 28.45,
    tc: 28.55,
    out: 28.75,
    target: (tt) => {
      const e = earthAbs(tt);
      return project(deskCam(tt), [e.x + 4, e.y + 4]);
    },
  });
  const c2 = cursorAt(t, { from: [1400, 960], to: [880, 520], t0: 32.65, t1: 33.3, tc: 33.4, out: 33.6 });
  cursor.update(c1 || c2);

  // ---------------- pencil ----------------
  pencil.update(pencilAt(t));
}

/** Where the pencil is, from whichever drawing is being drawn. */
function pencilAt(t) {
  // the tangle
  if (t < 5.2) {
    if (t < T_DRAW0 - 0.45) return null;
    if (t <= T_DRAW1) {
      const enter = prog(t, 0, T_DRAW0);
      const p = tangle.point(Math.max(t, T_DRAW0));
      const from = [1900, 1100];
      return t < T_DRAW0
        ? { x: lerp(from[0], p[0], ease.out(enter)), y: lerp(from[1], p[1], ease.out(enter)), lift: 1 - enter }
        : { x: p[0], y: p[1], lift: 0 };
    }
    const end = tangle.point(T_DRAW1);
    const u = ease.in2(prog(t, T_DRAW1 + 0.1, 5.15));
    return { x: lerp(end[0], 2100, u), y: lerp(end[1], 1250, u), lift: Math.min(1, prog(t, T_DRAW1, T_DRAW1 + 0.15)) };
  }
  const sources = [
    { sk: solar.sketcher, T0: SOLAR_T0, cam: deskCam, off: [0, 0], on: [10.5, 25.0] },
    { sk: waterD.sketcher, T0: WATER_T0, cam: waterCam, off: [0, 0], on: [30.3, 32.6] },
    { sk: leafD.sketcher, T0: LEAF_T0, cam: leafCam, off: [0, 0], on: [35.0, 38.7] },
  ];
  for (const s of sources) {
    if (t < s.on[0] || t > s.on[1]) continue;
    const p = s.sk.pencil(t - s.T0);
    if (p) {
      const [x, y] = project(s.cam(t), [p.at[0] + s.off[0], p.at[1] + s.off[1]]);
      return { x, y, lift: p.down ? 0 : p.lift ?? 0.6 };
    }
  }
  // montage tiles
  if (t > 45.1 && t < 50.0) {
    const mc = muralCam(t);
    for (const tl of tiles) {
      if (!tl.d.sketcher || tl.final || t < tl.T0 - 0.2 || t > tl.T0 + 1.25) continue;
      const p = tl.d.sketcher.pencil(t - tl.T0, 0.15);
      if (!p) continue;
      const [ox, oy] = tileAt(tl.row, tl.col);
      const [x, y] = project(mc, [ox + p.at[0], oy + p.at[1]]);
      return { x, y, lift: p.down ? 0 : p.lift ?? 0.6 };
    }
  }
  // the pencil waits on the empty sheet while the wall is shown
  if (t > 51.0 && t < LAN_T0) {
    const mc = muralCam(t);
    const q = lanPt(lanInks[0].point(LAN_T0));
    const [x, y] = project(mc, [LX0 + q[0], LY0 + q[1]]);
    const bob = Math.sin(t * 3.2) * 6;
    return { x, y: y + bob * (1 - prog(t, LAN_T0 - 0.3, LAN_T0)), lift: 1 - prog(t, LAN_T0 - 0.25, LAN_T0), alpha: prog(t, 51.0, 51.5), scale: lerp(0.55, 1, ease.inOut(prog(t, 52.6, 54.0))) };
  }
  // the lantern
  if (t > LAN_T0 - 0.6 && t < IGNITE + 0.9) {
    const mc = muralCam(t);
    const p = endSk.pencil(t, 0.2);
    if (p && t < LAN_T0 + 1.1) {
      const q = lanPt(p.at);
      const [x, y] = project(mc, [LX0 + q[0], LY0 + q[1]]);
      return { x, y, lift: p.down ? 0 : p.lift ?? 0.6 };
    }
    // after the candle, the pencil steps away
    const last = lanPt(candle.point(candle.t1));
    const [x0, y0] = project(mc, [LX0 + last[0], LY0 + last[1]]);
    const u = ease.in2(prog(t, LAN_T0 + 1.1, IGNITE + 0.6));
    return { x: lerp(x0, 2150, u), y: lerp(y0, 1300, u), lift: 1 };
  }
  return null;
}

// =====================================================================================
// Running: in the renderer, frames are asked for; in a browser, it plays.
// =====================================================================================
const allText = stage.textContent + PROMPT + STATUSES.map((s) => s[1]).join("") + "DrawY每个想法都值得探索";
await Promise.all(FACES.map((f) => document.fonts.load(f, allText)));
await document.fonts.ready;
await Promise.all([...document.images].map((im) => (im.complete ? im.decode().catch(() => {}) : new Promise((r) => (im.onload = im.onerror = r)))));

window.__duration = DURATION;
window.__cues = CUES.slice().sort((a, b) => a.t - b.t);
window.__render = (t) => render(t);
window.__ready = true;

const params = new URLSearchParams(location.search);
if (params.has("t")) render(parseFloat(params.get("t")));
else if (!params.has("still")) {
  const start = performance.now() - (parseFloat(params.get("from") || "0") * 1000);
  const loop = () => {
    const t = ((performance.now() - start) / 1000) % DURATION;
    render(t);
    requestAnimationFrame(loop);
  };
  loop();
}

// 《请勿触摸》 — a fifty-five-second film for DrawY. Every frame is a pure function of time:
// render(t). A coffee still life hangs in a gallery over a sign that says do not touch; the
// sign is edited to say 请你动手, and the work opens: a bean leads to where coffee comes
// from, a request opens the roast, and the whole work leaves on a phone.
import { W, H, clamp, lerp, prog, ease, window_, random, svg, div, css, attr, show, Ink, Sketcher, CUES, cue, cueStroke } from "../src/lib.js";
import { Pencil, Cursor, Caption, sparkSvg, LANTERN, paperGrain } from "../src/hud.js";
import { makeCover, makeJourney, makeRoast, HERO, DRUM, STATION_BOX } from "./art.js";

const f1 = (n) => Math.round(n * 10) / 10;
const a2 = (n) => String(Math.round(clamp(n) * 100) / 100);
const DURATION = 55;
const stage = document.getElementById("stage");

await document.fonts.ready;
const FACES = [
  '600 60px "Noto Serif SC"',
  '500 40px "Noto Serif SC"',
  '600 96px "Noto Serif SC"',
  '400 30px "LXGW WenKai"',
  '400 30px "Noto Sans SC"',
  '500 30px "Noto Sans SC"',
  'italic 400 34px "Instrument Serif"',
  '400 34px "Instrument Serif"',
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

// ---------- icons (Lucide, ISC licence) ----------
const ICONS = {
  undo: ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"],
  redo: ["m15 14 5-5-5-5", "M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"],
  pencil: ["M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z", "m15 5 4 4"],
  download: ["M12 15V3", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5"],
  history: ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5", "M12 7v5l4 2"],
  copy: ['<rect width="14" height="14" x="8" y="8" rx="2"/>', "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"],
  front: ["M5 3h14", "m18 13-6-6-6 6", "M12 7v14"],
  back: ["M12 17V3", "m6 11 6 6 6-6", "M19 21H5"],
  group: ["M3 7V5c0-1.1.9-2 2-2h2", "M17 3h2c1.1 0 2 .9 2 2v2", "M21 17v2c0 1.1-.9 2-2 2h-2", "M7 21H5c-1.1 0-2-.9-2-2v-2", '<rect width="7" height="5" x="7" y="7" rx="1"/>', '<rect width="7" height="5" x="10" y="12" rx="1"/>'],
  trash: ["M3 6h18", "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"],
  image: ['<rect width="18" height="18" x="3" y="3" rx="2"/>', '<circle cx="9" cy="9" r="2"/>', "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"],
  share: ["M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8", "m16 6-4-4-4 4", "M12 2v13"],
  filecode: ["M10 12.5 8 15l2 2.5", "m14 12.5 2 2.5-2 2.5", "M14 2v4a2 2 0 0 0 2 2h4", "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"],
  filetext: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4", "M10 9H8", "M16 13H8", "M16 17H8"],
  scan: ["M3 7V5a2 2 0 0 1 2-2h2", "M17 3h2a2 2 0 0 1 2 2v2", "M21 17v2a2 2 0 0 1-2 2h-2", "M7 21H5a2 2 0 0 1-2-2v-2"],
  x: ["M18 6 6 18", "m6 6 12 12"],
  hand: ["M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2", "M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2", "M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8", "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"],
};
const iconBody = (name) => ICONS[name].map((p) => (p.startsWith("<") ? p : `<path d="${p}"/>`)).join("");
const icon = (name, size = 26, color = "#5e5d59", sw = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${iconBody(name)}</svg>`;
const SPARK = `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M10.6 3.3c.6 4.2 2.4 6.6 7 7.6-4.4 1-6.4 3.3-7 7.8-.8-4.4-2.9-6.7-7.1-7.7 4.4-1 6.3-3.4 7.1-7.7z" fill="#d97757"/><path d="M18.7 14.2c.3 1.4.9 2.1 2.4 2.4-1.4.3-2.1 1.1-2.4 2.5-.3-1.4-1-2.2-2.4-2.5 1.4-.3 2.1-1 2.4-2.4z" fill="#e9a93a"/></svg>`;

// ---------- layers, bottom to top ----------
function layer(bg, parent = stage) {
  const el = div("layer", parent);
  if (bg) el.style.background = bg;
  const world = div("world", el);
  return { el, world };
}
const table = layer("#ece6d8");
const gallery = layer("#e6e0d5");
const fore = layer();
const phoneEl = div("phone", stage);
const cardBack = div("filecard", stage);
const journey = layer("#faf9f5");
const roast = layer("#faf9f5");
const endL = div("endcard", stage);
const ring = div("", stage, { position: "absolute", borderRadius: "50%", pointerEvents: "none", boxShadow: "0 0 0 3px rgba(217,119,87,.55), 0 0 0 10px rgba(217,119,87,.12), inset 0 0 40px rgba(60,45,20,.12)" });
const hudEl = div("hud", stage);
stage.style.background = "#000";

/** A camera: page point p lands on screen at (p - c) * z + centre + (ox, oy). */
const project = (cam, p) => [(p[0] - cam.cx) * cam.z + W / 2 + (cam.ox || 0), (p[1] - cam.cy) * cam.z + H / 2 + (cam.oy || 0)];
function aim(world, cam) {
  css(world, "transform", `translate(${f1(W / 2 + (cam.ox || 0))}px, ${f1(H / 2 + (cam.oy || 0))}px) scale(${Math.round(cam.z * 10000) / 10000}) translate(${f1(-cam.cx)}px, ${f1(-cam.cy)}px)`);
}
const logLerp = (a, b, k) => Math.exp(lerp(Math.log(a), Math.log(b), k));
/** The outer camera of a dive `u` of the way into `target`, where the inner page is `S` big. */
function dive(base, target, S, u) {
  const zu = ease.in2(u) * 0.35 + ease.inOut(u) * 0.65;
  const k = ease.out(prog(u, 0, 0.7));
  return { cx: lerp(base.cx, target[0], k), cy: lerp(base.cy, target[1], k), z: logLerp(base.z, 1 / S, zu), ox: base.ox, oy: base.oy };
}
/** The inner page's camera, carried by the outer one. */
function innerOf(outer, target, S) {
  const [tx, ty] = project(outer, target);
  return { cx: W / 2, cy: H / 2, z: S * outer.z, ox: tx - W / 2, oy: ty - H / 2 };
}

// =====================================================================================
// The gallery
// =====================================================================================
const GW = gallery.world;
div("wall", GW);
div("spot", GW);
div("floor", GW);
div("baseboard", GW);
const PS = 0.4,
  FX = 576,
  FY = 214;
const coverPt = (p) => [FX + p[0] * PS, FY + p[1] * PS];
const frame = div("frame", GW, { left: FX - 78 + "px", top: FY - 78 + "px", width: 768 + 156 + "px", height: 432 + 156 + "px" });
div("mat", frame);
div("bevel", frame, { left: "78px", top: "78px", right: "78px", bottom: "78px" });
const art = div("", GW, { position: "absolute", left: FX + "px", top: FY + "px", width: "1920px", height: "1080px", transform: `scale(${PS})`, transformOrigin: "0 0" });
const coverG = makeCover(art);
const wallLabel = div("walllabel", GW, { left: "1468px", top: "600px" });
wallLabel.innerHTML = `<b>一杯咖啡，从哪里来？</b><span>DrawY · 2026<br/>纸上作品</span>`;

// the sign
const plaque = div("plaque", GW, { left: "810px", top: "735px", width: "300px", height: "170px" });
for (const [x, y] of [[10, 10], [283, 10], [10, 153], [283, 153]]) div("screw", plaque, { left: x + "px", top: y + "px" });
const signIcon = svg("svg", { class: "icon", viewBox: "-1 -1 26 26" }, plaque);
const signRing = svg("circle", { cx: 12, cy: 12, r: 11, fill: "none", stroke: "#c0392b", "stroke-width": 2 }, signIcon);
const handG = svg("g", {}, signIcon);
const handInner = svg("g", { transform: "translate(12 12.4) scale(.6) translate(-12 -12)", fill: "none", stroke: "#3a352c", "stroke-width": 2.6, "stroke-linecap": "round", "stroke-linejoin": "round" }, handG);
handInner.innerHTML = iconBody("hand");
const slash = svg("path", { d: "M4.3 4.3L19.7 19.7", stroke: "#c0392b", "stroke-width": 2, "stroke-linecap": "round", "stroke-dasharray": "22 22" }, signIcon);
const hl = div("hl", plaque);
const zhEl = div("zh", plaque);
const zhSpans = [0, 1, 2, 3].map(() => {
  const s = document.createElement("span");
  s.className = "ch";
  zhEl.appendChild(s);
  return s;
});
const caretEl = div("caret", plaque);
const enEl = div("en", plaque);
enEl.innerHTML = `PLEASE <span class="dn" style="white-space:pre">DO NOT </span>TOUCH`;
const dn = enEl.querySelector(".dn");

// the rope in front, on its own layer so it moves faster than the wall
const FWs = svg("svg", { width: 1920, height: 1300, viewBox: "0 0 1920 1300", style: "position:absolute;left:0;top:0;overflow:visible" }, fore.world);
const brass = svg("linearGradient", { id: "brass", x1: 0, y1: 0, x2: 1, y2: 0 }, FWs);
[[0, "#8a6a32"], [0.45, "#ecd391"], [1, "#9c7838"]].forEach(([o, c]) => svg("stop", { offset: o, "stop-color": c }, brass));
const ropeInk = svg("path", { fill: "none", stroke: "#3a2622", "stroke-width": 22, "stroke-linecap": "round" }, FWs);
const ropeRed = svg("path", { fill: "none", stroke: "#8f2d2d", "stroke-width": 16, "stroke-linecap": "round" }, FWs);
const ropeHi = svg("path", { fill: "none", stroke: "#b84a48", "stroke-width": 4, "stroke-linecap": "round", transform: "translate(0 -4)", opacity: 0.8 }, FWs);
for (const x of [640, 1280]) {
  svg("ellipse", { cx: x, cy: 1116, rx: 64, ry: 15, fill: "#3a2a10", opacity: 0.18 }, FWs);
  svg("ellipse", { cx: x, cy: 1108, rx: 52, ry: 13, fill: "url(#brass)", stroke: "#5a4420", "stroke-width": 2 }, FWs);
  svg("rect", { x: x - 9, y: 880, width: 18, height: 228, fill: "url(#brass)", stroke: "#5a4420", "stroke-width": 2 }, FWs);
  svg("circle", { cx: x, cy: 872, r: 17, fill: "url(#brass)", stroke: "#5a4420", "stroke-width": 2 }, FWs);
}
const hookA = svg("circle", { cx: 640, cy: 886, r: 9, fill: "url(#brass)", stroke: "#5a4420", "stroke-width": 2 }, FWs);
const hookB = svg("circle", { r: 9, fill: "url(#brass)", stroke: "#5a4420", "stroke-width": 2 }, FWs);
FWs.appendChild(hookA);

// =====================================================================================
// The works
// =====================================================================================
const J0 = 11.1,
  R0 = 28.2;
const jM = makeJourney(journey.world, { cues: true, T0: J0 });
const rM = makeRoast(roast.world, { cues: true, T0: R0 });

// the phone, with the exported page inside: a 1920×1080 stage of its own, scaled
const PH = { x: 340, y: 300 };
const screen = div("screen", phoneEl);
div("cam", phoneEl);
const PSC = 556 / 1080;
const vstage = div("", screen, { position: "absolute", left: f1((1196 - 1920 * PSC) / 2) + "px", top: "0", width: "1920px", height: "1080px", transform: `scale(${PSC})`, transformOrigin: "0 0", overflow: "hidden" });
const pCover = layer("#faf9f5", vstage);
const pJourney = layer("#faf9f5", vstage);
// the phone's screen is wider than the page; let what is zoomed run to its edges
vstage.style.overflow = "visible";
pCover.el.style.overflow = "visible";
pJourney.el.style.overflow = "visible";
const cP = makeCover(pCover.world);
const jP = makeJourney(pJourney.world, {});
const pRing = div("", vstage, { position: "absolute", borderRadius: "50%", boxShadow: "0 0 0 5px rgba(217,119,87,.55), 0 0 0 16px rgba(217,119,87,.12)" });

// the file the work becomes
cardBack.innerHTML = `<span class="ico" style="top:438px">${icon("filecode", 44, "#c15f3c", 1.8)}</span><div class="name" style="top:436px">咖啡的来历.html</div><div class="sub" style="top:482px">可交互网页 · 3 个场景 · 离线也能打开</div>`;

// =====================================================================================
// HUD: the canvas page's own controls, and the hands that use them
// =====================================================================================
const crumbs = div("crumbs", hudEl);
const lanternMark = svg("svg", { width: 40, height: 40, viewBox: "0 0 24 24", style: "overflow:visible" }, crumbs);
lanternMark.innerHTML = `<circle cx="12" cy="13.6" r="5.2" fill="#e9a93a" opacity=".16"/><g fill="none" stroke="#d97757" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${LANTERN.frame.map((d) => `<path d="${d}"/>`).join("")}${LANTERN.rays.map((d) => `<path d="${d}" stroke="#e9a93a" stroke-width="1.6"/>`).join("")}<path d="${LANTERN.candle}" fill="#d97757" fill-opacity=".85" stroke-width=".9"/><path d="${LANTERN.flame}" fill="#e9a93a" stroke="#e08f2c" stroke-width=".7"/></g>`;
const crumbMain = div("seg", crumbs);
crumbMain.textContent = "一杯咖啡，从哪里来";
const crumbSegs = ["咖啡的来历", "烘焙"].map((s) => {
  const el = div("seg sub", crumbs);
  el.innerHTML = `<span class="sep">›</span>${s}`;
  return el;
});
const toolbar = div("toolbar", hudEl);
const tbBtns = ["undo", "redo", "pencil", "download", "history"].map((n) => {
  const b = div("b", toolbar);
  b.innerHTML = icon(n, 26);
  return b;
});
const EXPORT_BTN = [1560 + 28 + 3 * 62, 62];
const menu = div("menu", hudEl);
menu.innerHTML = `<div class="head">导出与分享</div>
<div class="row">${icon("image", 28)}<b>PNG 原图</b><span>高清，保留全部细节</span></div>
<div class="row">${icon("image", 28)}<b>JPG 小图</b><span>体积小，适合聊天发送</span></div>
<div class="row solo">${icon("copy", 28)}<b>复制图片</b></div>
<div class="row solo">${icon("share", 28)}<b>分享…</b></div>
<div class="more">更多格式</div>
<div class="row" id="htmlrow">${icon("filecode", 28, "#c15f3c")}<b>可交互网页</b><span>单个 HTML 文件，浏览器打开即可探索</span></div>
<div class="row">${icon("filetext", 28)}<b>PDF</b><span>矢量，适合打印和放大</span></div>`;
const htmlRow = menu.querySelector("#htmlrow");
const HTML_ROW = [1600, 518];

// selection marks
const hoverBox = div("selbox hover", hudEl);
const selBox = div("selbox", hudEl);
[[0, 0], [50, 0], [100, 0], [100, 50], [100, 100], [50, 100], [0, 100], [0, 50]].forEach(([x, y]) => {
  const h = document.createElement("i");
  h.style.left = x + "%";
  h.style.top = y + "%";
  selBox.appendChild(h);
});
const selBar = div("selbar", hudEl);
selBar.innerHTML = `<span class="b">${icon("copy", 24)}</span><span class="b">${icon("front", 24)}</span><span class="b">${icon("back", 24)}</span><span class="b">${icon("group", 24)}</span><span class="sep"></span><span class="ask">${SPARK}让 AI 修改</span><span class="sep"></span><span class="b">${icon("trash", 24)}</span>`;
const askChip = selBar.querySelector(".ask");
function box(el, r, alpha) {
  if (!r || alpha <= 0.005) return show(el, false);
  show(el, true);
  css(el, "left", f1(r.x) + "px");
  css(el, "top", f1(r.y) + "px");
  css(el, "width", f1(r.w) + "px");
  css(el, "height", f1(r.h) + "px");
  css(el, "opacity", a2(alpha));
}
const rectOf = (cam, x, y, w, h) => {
  const [x0, y0] = project(cam, [x, y]),
    [x1, y1] = project(cam, [x + w, y + h]);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

// the composer, docked under the canvas
const comp = div("composer", hudEl);
const dockBox = div("dock", comp);
const dockSpark = sparkSvg(dockBox, 34);
const statusBox = div("status", dockBox);
const stopBtn = div("stop", dockBox);
stopBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18"><rect x="2" y="2" width="14" height="14" rx="3" fill="#fff"/></svg>`;
const SEND_SVG = (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>`;
const sendSmall = div("stop", dockBox, { position: "absolute", right: "12px", opacity: "0.3" });
sendSmall.innerHTML = SEND_SVG(24);
const askBox = div("ask", comp);
const quote = div("quote", askBox);
quote.innerHTML = `${icon("scan", 22, "#c15f3c")}已选中 · ③ 烘焙<span style="margin-left:6px;display:inline-flex">${icon("x", 18, "#c15f3c")}</span>`;
const askField = div("askfield", askBox);
const typed = document.createElement("span");
const caret = document.createElement("span");
caret.className = "caret";
const ph = document.createElement("span");
ph.className = "placeholder";
ph.textContent = "要怎样修改选中的部分？";
askField.append(typed, caret, ph);
const askSend = div("send", askBox, { position: "absolute", right: "16px", bottom: "16px" });
askSend.innerHTML = SEND_SVG(28);
const DOCK = { x: 600, y: 958, w: 720, h: 78, r: 39 };
const ASK = { x: 470, y: 842, w: 980, h: 194, r: 34 };
const SEND_BTN = [ASK.x + ASK.w - 16 - 28, ASK.y + ASK.h - 16 - 28];
const PROMPT = "烘焙这一步，再讲细一点：火候怎样改变味道？";
const keyTimes = [];
{
  const r = random(17);
  let t = 24.65;
  for (const _ of PROMPT) {
    keyTimes.push(t);
    cue(t, "key");
    t += 0.07 + r() * 0.04;
  }
}
const SEND = 26.85;
const STATUSES = [
  [9.4, "继续探索，或修改这幅作品", false, true],
  [27.1, "展开“烘焙”，保持作品风格。", true],
  [28.6, "落笔 · 烘焙曲线与风味", true],
  [31.9, "显影 · 三种烘焙度", true],
  [34.05, "完成 ✓", false],
];
const statusEls = STATUSES.map(([, s, , idle]) => {
  const el = document.createElement("span");
  el.textContent = s;
  if (idle) el.style.color = "#a8a499";
  statusBox.appendChild(el);
  return el;
});

// captions
const captions = [
  { zh: "点开一颗咖啡豆，", en: "Click a coffee bean,", t0: 9.95, t1: 12.1, marks: ["咖啡豆"] },
  { zh: "走进它的来历。", en: "and step into where it came from.", t0: 12.45, t1: 16.0, marks: ["来历"] },
  { zh: "让理解，有一条路径。", en: "Understanding, with a path to follow.", t0: 16.35, t1: 21.6, marks: ["路径"] },
  { zh: "对哪一步好奇，", en: "Curious about one step?", t0: 22.65, t1: 24.85, marks: ["好奇"] },
  { zh: "就提出新的要求。", en: "Ask for more.", t0: 25.0, t1: 27.4, marks: ["新的要求"] },
  { zh: "它接着展开细节。", en: "It unfolds the details.", t0: 28.75, t1: 33.9, marks: ["细节"] },
  { zh: "整件作品，一起带走。", en: "Then take the whole work with you.", t0: 38.3, t1: 41.85, marks: ["带走"] },
  { zh: "在哪儿打开，都还能点。", en: "Open it anywhere. It still responds.", t0: 42.15, t1: 44.75, marks: ["还能点"] },
].map((c) => new Caption(hudEl, c));

// hands
const ibeam = div("abs", hudEl);
ibeam.innerHTML = `<svg width="40" height="60" viewBox="-10 -16 20 32" style="position:absolute;left:-20px;top:-30px;overflow:visible;filter:drop-shadow(0 3px 4px rgba(0,0,0,.16))"><path d="M-6 -13h3.5l2.5 2.2 2.5-2.2H6M0 -10.8v21.6M-6 13h3.5l2.5-2.2 2.5 2.2H6" fill="none" stroke="#fff" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M-6 -13h3.5l2.5 2.2 2.5-2.2H6M0 -10.8v21.6M-6 13h3.5l2.5-2.2 2.5 2.2H6" fill="none" stroke="#141413" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const touchEl = div("touch", hudEl);
const cursor = new Cursor(hudEl);
const pencil = new Pencil(hudEl);
paperGrain(stage);
div("vignette", stage);

// =====================================================================================
// The end card: DrawY, 请你动手。
// =====================================================================================
const endGlow = div("", endL, { position: "absolute", inset: "0", background: "radial-gradient(56% 62% at 36% 37%, rgba(233,169,58,.32), rgba(233,169,58,.07) 55%, transparent 75%)", opacity: 0 });
const endSvg = svg("svg", { width: 1920, height: 1080, viewBox: "0 0 1920 1080", style: "position:absolute;left:0;top:0;overflow:visible" }, endL);
const LS = 11.5,
  LAN = { x: 528, y: 262 };
const lanG = svg("g", { transform: `translate(${LAN.x} ${LAN.y}) scale(${LS})` }, endSvg);
const glowC = svg("circle", { cx: 12, cy: 13.6, r: 5.2, fill: "#e9a93a", opacity: 0 }, lanG);
const endSk = new Sketcher();
const LAN_T0 = 50.15;
const lanStyle = { stroke: "#d97757", "stroke-width": 1.55 };
const lanInks = LANTERN.frame.map((d, i) => {
  const t0 = LAN_T0 + i * 0.12;
  cueStroke(t0, t0 + 0.11, 0.9);
  return endSk.add(new Ink(lanG, d, t0, t0 + 0.11, lanStyle));
});
const candle = endSk.add(new Ink(lanG, LANTERN.candle, LAN_T0 + 0.88, LAN_T0 + 0.95, { ...lanStyle, "stroke-width": 0.9, fill: "none" }));
const candleFill = svg("path", { d: LANTERN.candle, fill: "#d97757", opacity: 0 }, lanG);
const IGNITE = 51.25;
cue(IGNITE, "ignite");
const rayInks = LANTERN.rays.map((d, i) => new Ink(lanG, d, IGNITE + 0.08 + i * 0.05, IGNITE + 0.2 + i * 0.05, { stroke: "#e9a93a", "stroke-width": 1.6 }));
const flame = svg("path", { d: LANTERN.flame, fill: "#e9a93a", stroke: "#e08f2c", "stroke-width": 0.7, style: "transform-origin:12.1px 15.6px; transform-box: view-box" }, lanG);
const lanPt = (p) => [LAN.x + p[0] * LS, LAN.y + p[1] * LS];
const nameEl = div("name", endL, { left: "860px", top: "300px" });
const nameChars = [..."DrawY"].map((c) => {
  const s = document.createElement("span");
  s.textContent = c;
  nameEl.appendChild(s);
  return s;
});
const endZh = div("zh", endL, { top: f1(650 - 57.6) + "px" });
[..."请你动手"].forEach((c) => {
  const s = document.createElement("span");
  s.className = "ch";
  s.textContent = c;
  endZh.appendChild(s);
});
const DOT = { x: 1186, y: 683 };
const DOT_T0 = 52.05;
const dot = endSk.add(new Ink(endSvg, handEllipseDot(DOT.x, DOT.y, 10), DOT_T0, DOT_T0 + 0.2, { stroke: "#141413", "stroke-width": 4.6 }));
cueStroke(DOT_T0, DOT_T0 + 0.2, 0.7);
function handEllipseDot(x, y, r) {
  const P = [];
  for (let i = 0; i <= 26; i++) {
    const a = -2.2 + (i / 26) * (Math.PI * 2 + 0.5);
    const k = 1 + 0.06 * Math.sin(a * 2 + 1);
    P.push(`${f1(x + Math.cos(a) * r * k)} ${f1(y + Math.sin(a) * r * 0.94 * k)}`);
  }
  return "M" + P.join("L");
}
const endEn = div("en", endL, { top: "748px" });
endEn.textContent = "Please, touch.";
const endUrl = div("url", endL, { top: "948px" });
endUrl.textContent = "github.com/Ezio2000/DrawY";

// =====================================================================================
// Cues the timeline itself makes
// =====================================================================================
cue(0, "room", { dur: 8.2 });
cue(0.9, "footstep");
cue(1.55, "footstep");
cue(2.2, "footstep");
cue(4.0, "click");
cue(4.17, "click");
cue(4.45, "select", { dur: 0.5 });
const TYPE_AT = [5.35, 5.7, 6.05, 6.4];
cue(5.25, "key");
TYPE_AT.forEach((t) => [-0.25, -0.17, -0.09, 0].forEach((d) => cue(t + d, "key")));
cue(6.75, "erase", { dur: 0.4 });
cue(7.28, "commit");
cue(7.5, "unhook");
cue(8.06, "thud");
cue(10.75, "click");
cue(10.95, "dive", { dur: 1.35 });
cue(22.5, "click");
cue(22.55, "select", { dur: 0.3 });
cue(23.95, "click");
cue(SEND, "click");
cue(SEND + 0.1, "send");
cue(27.25, "dive", { dur: 1.2 });
cue(34.8, "zoomout", { dur: 1.2 });
cue(36.75, "click");
cue(36.8, "menu");
cue(37.85, "click");
cue(38.0, "fold", { dur: 1.0 });
cue(38.5, "card");
cue(39.55, "fly", { dur: 0.8 });
cue(39.4, "phone", { dur: 0.8 });
cue(40.35, "open");
cue(41.55, "tap");
cue(41.7, "dive", { dur: 1.0, gain: 0.55 });
cue(44.8, "whip");
cue(44.95, "room", { dur: 5.0 });
cue(47.5, "push", { dur: 2.2 });

// =====================================================================================
// Cameras
// =====================================================================================
const DIVE1 = [10.95, 12.3],
  DIVE2 = [27.25, 28.45],
  BACK2 = [34.8, 36.0];
const S1 = 0.07 * PS,
  S2 = 0.1;
const HERO_G = coverPt([HERO.x, HERO.y]);
const RETURN = 44.9;
const ZSIGN = 2.2,
  ZEND = 2.4,
  CY_END = 812 - 110 / ZEND;
function galleryBase(t) {
  if (t >= RETURN) {
    let cam = { cx: 960, cy: 560, z: lerp(0.95, 0.99, ease.inOut2(prog(t, 45.0, 47.5))) };
    const u = ease.inOut(prog(t, 47.5, 49.6));
    if (u > 0) cam = { cx: 960, cy: lerp(560, CY_END, u), z: logLerp(0.99, ZEND, u) };
    return cam;
  }
  let cam = { cx: 960, cy: 560, z: lerp(0.92, 0.97, ease.inOut2(prog(t, 0, 2.7))) };
  const a = ease.inOut(prog(t, 2.5, 3.8));
  if (a > 0) cam = { cx: 960, cy: lerp(560, 805, a), z: logLerp(0.97, ZSIGN, a) };
  if (t > 3.8) cam.z *= 1 + 0.012 * ease.inOut2(prog(t, 3.8, 7.6));
  const b = ease.inOut(prog(t, 7.65, 9.8));
  if (b > 0) cam = { cx: 960, cy: lerp(805, 430, b), z: logLerp(ZSIGN * 1.012, 1 / PS, b) };
  if (t > 9.8) cam.z = (1 / PS) * (1 + 0.012 * ease.inOut2(prog(t, 9.8, 10.9)));
  return cam;
}
function galleryCam(t) {
  const base = galleryBase(t);
  const u = prog(t, DIVE1[0], DIVE1[1]);
  if (u <= 0 || t >= RETURN) return base;
  return dive(base, HERO_G, S1, u);
}
const jBase = (t) => ({ cx: 960, cy: 540, z: lerp(1, 1.02, ease.inOut2(prog(t, 12.3, 27))) });
function journeyCam(t) {
  if (t < DIVE1[1]) return innerOf(galleryCam(t), HERO_G, S1);
  const base = jBase(t);
  if (t >= BACK2[0]) {
    const u = 1 - prog(t, BACK2[0], BACK2[1]);
    return u > 0 ? dive(base, [DRUM.x, DRUM.y], S2 / 1.02, u) : base;
  }
  const u = prog(t, DIVE2[0], DIVE2[1]);
  return u > 0 ? dive(base, [DRUM.x, DRUM.y], S2, u) : base;
}
function roastCam(t) {
  if (t < DIVE2[1] || t > BACK2[0]) return innerOf(journeyCam(t), [DRUM.x, DRUM.y], S2);
  return { cx: 960, cy: 540, z: lerp(1, 1.02, ease.inOut2(prog(t, 28.45, 34.8))) };
}
const foreCam = (g) => ({ cx: g.cx, cy: g.cy, z: g.z * 1.2, ox: (g.ox || 0) * 1.25, oy: g.oy || 0 });

/** Blur along the direction a layer is moving fast. */
function blurBy(el, dx, dy) {
  const sx = Math.min(40, Math.abs(dx) / 260),
    sy = Math.min(40, Math.abs(dy) / 260);
  if (sx < 0.8 && sy < 0.8) return css(el, "filter", "none");
  attr(mblurG, "stdDeviation", `${f1(sx)} ${f1(sy)}`);
  css(el, "filter", "url(#mblur)");
}

// the file's flight: where the folded page is, and how big
function fileAt(t) {
  const a = ease.inOut(prog(t, 38.0, 39.0));
  let cx = 960,
    cy = lerp(540, 530, a),
    k = lerp(1, 0.36, a),
    rot = 0;
  const b = ease.in2(prog(t, 39.55, 40.35));
  if (b > 0) {
    cx = lerp(960, 960, b);
    cy = lerp(530, phoneY(t) + 300, b);
    k = logLerp(0.36, 0.05, b);
    rot = -6 * Math.sin(b * Math.PI);
  }
  return { cx, cy, k, rot };
}
const phoneY = (t) => lerp(1200, PH.y, ease.out(prog(t, 39.4, 40.2)));
const whipK = (t) => ease.inOut(prog(t, 44.8, 45.4));
const phoneX = (t) => PH.x - W * whipK(t);

// =====================================================================================
// A cursor that follows a route of waypoints and clicks where it is told to
// =====================================================================================
function route(t, { pts, clicks = [], on, off }) {
  if (t < on - 0.3 || t > off + 0.3) return null;
  const at = (p) => (typeof p === "function" ? p(t) : p);
  let x, y;
  if (t <= pts[0][0]) [x, y] = at(pts[0][1]);
  else if (t >= pts.at(-1)[0]) [x, y] = at(pts.at(-1)[1]);
  else
    for (let i = 0; i < pts.length - 1; i++) {
      const [ta, pa] = pts[i],
        [tb, pb, how] = pts[i + 1];
      if (t >= ta && t <= tb) {
        const k = ease.inOut(prog(t, ta, tb));
        const A = at(pa),
          B = at(pb);
        const d = Math.hypot(B[0] - A[0], B[1] - A[1]);
        x = lerp(A[0], B[0], k);
        y = lerp(A[1], B[1], k) - (how === "drag" ? 0 : Math.sin(k * Math.PI) * Math.min(60, d * 0.12));
        break;
      }
    }
  let press = 0,
    ripple = 0;
  for (const c of clicks) {
    if (t >= c - 0.08 && t <= c + 0.12) press = Math.max(press, Math.sin(prog(t, c - 0.08, c + 0.12) * Math.PI));
    if (t >= c && t < c + 0.55) ripple = prog(t, c, c + 0.55);
  }
  const alpha = Math.min(prog(t, on - 0.3, on), 1 - prog(t, off, off + 0.3));
  return { x, y, press, ripple, alpha };
}
const G = (x, y) => (tt) => project(galleryCam(tt), [x, y]);
const J = (x, y) => (tt) => project(journeyCam(tt), [x, y]);
const ROUTES = [
  { pts: [[2.9, [1500, 1010]], [3.75, G(905, 815)], [4.3, G(905, 815)], [4.45, G(874, 812)], [4.95, G(1046, 812), "drag"], [5.25, G(1066, 836)]], clicks: [4.0, 4.17], on: 2.9, off: 5.2, ibeam: 3.78 },
  { pts: [[10.0, [1500, 1000]], [10.6, G(HERO_G[0] + 8, HERO_G[1] + 6)]], clicks: [10.75], on: 10.0, off: 10.95 },
  {
    pts: [[21.7, [1520, 1010]], [22.35, J(1180, 540)], [23.3, J(1180, 540)], [23.85, () => askAt()], [24.05, () => askAt()], [24.7, [1540, 975]], [26.3, [1540, 975]], [26.75, SEND_BTN]],
    clicks: [22.5, 23.95, SEND],
    on: 21.7,
    off: 27.05,
  },
  { pts: [[36.0, [1560, 760]], [36.6, EXPORT_BTN], [37.2, EXPORT_BTN], [37.7, HTML_ROW]], clicks: [36.75, 37.85], on: 36.0, off: 38.0 },
];
let selBarW = 0,
  askOff = 0;
function selBarAt(t) {
  const r = rectOf(journeyCam(t), STATION_BOX.x, STATION_BOX.y, STATION_BOX.w, STATION_BOX.h);
  return { x: r.x + r.w / 2 - selBarW / 2, y: r.y - 84 };
}
const askAt = () => {
  const p = selBarAt(23.5);
  return [p.x + askOff, p.y + 32];
};

// =====================================================================================
// render(t)
// =====================================================================================
function render(t) {
  let ringOn = false;
  const portal = (x, y, R, a) => {
    ringOn = a > 0.01;
    if (!ringOn) return;
    css(ring, "left", f1(x - R) + "px");
    css(ring, "top", f1(y - R) + "px");
    css(ring, "width", f1(2 * R) + "px");
    css(ring, "height", f1(2 * R) + "px");
    css(ring, "opacity", a2(a));
  };

  // ---------------- gallery ----------------
  const galOn = t < DIVE1[1] + 0.02 || t > RETURN;
  show(gallery.el, galOn);
  show(fore.el, galOn && t < 9.4 || t > RETURN);
  if (galOn) {
    const gc = galleryCam(t);
    aim(GW, gc);
    const fc = foreCam(gc);
    aim(fore.world, fc);
    css(fore.el, "filter", "blur(1.6px)");
    // in from black at the start; pushed in from the right on the way back
    const inA = a2(ease.inOut2(prog(t, 0, 0.9)));
    css(gallery.el, "opacity", inA);
    css(fore.el, "opacity", inA);
    const sx = t > RETURN ? W * (1 - whipK(t)) : 0;
    css(gallery.el, "transform", sx ? `translateX(${f1(sx)}px)` : "none");
    css(fore.el, "transform", sx ? `translateX(${f1(sx * 1.15)}px)` : "none");
    if (t > RETURN && t < 45.5) blurBy(gallery.el, W * (whipK(t) - whipK(t + 1 / 60)) * 60, 0);
    else css(gallery.el, "filter", "none");
    const inCanvas = t > 9.3 && t < 12.5;
    coverG.update(t, {
      alive: t > RETURN ? 1 : ease.out(prog(t, 7.7, 8.5)),
      dots: inCanvas ? prog(t, 9.3, 10.0) : 0,
      hover: window_(t, 10.4, 11.0, 0.2, 0.15),
      press: t > 10.67 && t < 10.87 ? Math.sin(prog(t, 10.67, 10.87) * Math.PI) : 0,
    });
    // the sign
    let text = "请勿触摸",
      sel = null,
      caretAt = -1;
    if (t >= 4.45 && t < 5.25) sel = [0, 4 * ease.inOut2(prog(t, 4.45, 4.95))];
    if (t >= 5.25) {
      const n = TYPE_AT.filter((k) => t >= k).length;
      text = "请你动手".slice(0, n);
      caretAt = n;
    } else if (t >= 4.05 && t < 4.45) caretAt = 2;
    zhSpans.forEach((s, i) => {
      show(s, i < text.length);
      if (s.textContent !== (text[i] || "")) s.textContent = text[i] || "";
    });
    const N = text.length,
      left = 150 - N * 21.6;
    if (sel) {
      show(hl, true);
      css(hl, "left", f1(left + sel[0] * 43.2) + "px");
      css(hl, "width", f1((sel[1] - sel[0]) * 43.2) + "px");
    } else show(hl, false);
    const typing = TYPE_AT.some((k) => t > k - 0.3 && t < k + 0.1);
    const caretOn = caretAt >= 0 && t < 7.3 && (typing || (t * 1.8) % 1 < 0.55);
    show(caretEl, caretOn);
    if (caretOn) css(caretEl, "left", f1(left + caretAt * 43.2 - 1.3) + "px");
    // the English follows, and the slash comes off
    const fold = ease.inOut(prog(t, 6.75, 7.2));
    css(dn, "width", f1(DN_W * (1 - fold)) + "px");
    css(dn, "opacity", a2(1 - ease.out(prog(t, 6.75, 7.0))));
    css(slash, "strokeDashoffset", String(f1(22 * ease.inOut2(prog(t, 6.75, 7.1)))));
    const warm = ease.inOut2(prog(t, 6.85, 7.25));
    attr(signRing, "stroke", warm > 0 ? (warm < 1 ? mixC("#c0392b", "#d97757", warm) : "#d97757") : "#c0392b");
    const wave = t > 7.2 && t < 8.3 ? Math.sin((t - 7.2) * 13) * 14 * Math.exp(-(t - 7.2) * 2.4) : 0;
    attr(handG, "transform", `rotate(${f1(wave)} 12 19)`);
    // the rope comes off its hook
    const u = prog(t, 7.5, 8.05);
    const fall = ease.in2(u);
    const B0 = [1280, 886],
      B1 = [1062, 1100];
    let bx = (1 - fall) * (1 - fall) * B0[0] + 2 * (1 - fall) * fall * 1300 + fall * fall * B1[0];
    let by = (1 - fall) * (1 - fall) * B0[1] + 2 * (1 - fall) * fall * 1080 + fall * fall * B1[1];
    if (t > 8.05) by -= Math.abs(Math.sin((t - 8.05) * 12)) * 16 * Math.exp(-(t - 8.05) * 7);
    if (t > RETURN) (bx = B1[0]), (by = B1[1]);
    const k = t > RETURN ? 1 : ease.inOut2(prog(t, 7.5, 8.15));
    const c1 = [lerp(820, 652, k), lerp(1008, 1090, k)],
      c2 = [lerp(1100, 760, k), lerp(1008, 1106, k)];
    const d = `M640 886C${f1(c1[0])} ${f1(c1[1])} ${f1(c2[0])} ${f1(c2[1])} ${f1(bx)} ${f1(by)}`;
    attr(ropeInk, "d", d);
    attr(ropeRed, "d", d);
    attr(ropeHi, "d", d);
    attr(hookB, "cx", f1(bx));
    attr(hookB, "cy", f1(by));
  }

  // ---------------- journey ----------------
  const jOn = (t > DIVE1[0] + 0.12 && t < DIVE2[1] + 0.02) || (t > BACK2[0] - 0.02 && t < 40.45);
  show(journey.el, jOn);
  if (jOn) {
    const jc = journeyCam(t);
    aim(journey.world, jc);
    jM.update(t - J0);
    const u = prog(t, DIVE1[0], DIVE1[1]);
    if (u < 1) {
      const gc = galleryCam(t);
      const [ex, ey] = project(gc, HERO_G);
      const R = HERO.r * PS * gc.z * lerp(1, 2.6, ease.in2(u));
      css(journey.el, "clipPath", `circle(${f1(R)}px at ${f1(ex)}px ${f1(ey)}px)`);
      const a = ease.inOut2(prog(u, 0.16, 0.42));
      css(journey.el, "opacity", a2(a));
      portal(ex, ey, R, a * (1 - prog(u, 0.75, 0.95)));
    } else {
      css(journey.el, "clipPath", "none");
      const f = fileAt(t);
      css(journey.el, "opacity", a2(1 - prog(t, 40.22, 40.38)));
      if (t > 38.0) {
        css(journey.el, "transform", `translate(${f1(f.cx - 960)}px, ${f1(f.cy - 540)}px) rotate(${f1(f.rot)}deg) scale(${Math.round(f.k * 10000) / 10000})`);
        css(journey.el, "borderRadius", f1(16 / f.k) + "px");
      } else {
        css(journey.el, "transform", "none");
        css(journey.el, "borderRadius", "0px");
      }
    }
  }

  // ---------------- roast ----------------
  const rOn = t > DIVE2[0] + 0.1 && t < BACK2[1] - 0.1;
  show(roast.el, rOn);
  if (rOn) {
    const rc = roastCam(t);
    aim(roast.world, rc);
    rM.update(t - R0);
    let u = prog(t, DIVE2[0], DIVE2[1]);
    if (t >= BACK2[0]) u = 1 - prog(t, BACK2[0], BACK2[1]);
    if (u < 1) {
      const jc = journeyCam(t);
      const [ex, ey] = project(jc, [DRUM.x, DRUM.y]);
      const R = DRUM.r * jc.z * lerp(1, 2.6, ease.in2(u));
      css(roast.el, "clipPath", `circle(${f1(R)}px at ${f1(ex)}px ${f1(ey)}px)`);
      const a = ease.inOut2(prog(u, 0.12, 0.4));
      css(roast.el, "opacity", a2(a));
      portal(ex, ey, R, a * (1 - prog(u, 0.75, 0.95)));
    } else {
      css(roast.el, "clipPath", "none");
      css(roast.el, "opacity", "1");
    }
  }

  // ---------------- the file and the phone ----------------
  const tableOn = t > 37.9 && t < 45.45;
  show(table.el, tableOn);
  if (tableOn) css(table.el, "transform", `translateX(${f1(-W * whipK(t))}px)`);
  const cardOn = t > 38.6 && t < 40.4;
  show(cardBack, cardOn);
  if (cardOn) {
    const f = fileAt(t);
    const s = f.k / 0.36;
    css(cardBack, "width", "743px");
    css(cardBack, "height", "535px");
    css(cardBack, "transform", `translate(${f1(f.cx - 371.6 * s)}px, ${f1(f.cy - 220.4 * s)}px) rotate(${f1(f.rot)}deg) scale(${Math.round(s * 10000) / 10000})`);
    css(cardBack, "opacity", a2(Math.min(ease.out(prog(t, 38.62, 38.98)), 1 - prog(t, 40.22, 40.38))));
  }
  const phoneOn = t > 39.35 && t < 45.4;
  show(phoneEl, phoneOn);
  if (phoneOn) {
    const px = phoneX(t),
      py = phoneY(t);
    css(phoneEl, "transform", `translate(${f1(px)}px, ${f1(py)}px)`);
    if (t > 44.8) blurBy(phoneEl, (phoneX(t + 1 / 60) - px) * 60, 0);
    else css(phoneEl, "filter", "none");
    // what the screen shows: nothing, then the work opening from the file
    const open = ease.out(prog(t, 40.35, 40.85));
    css(vstage, "opacity", a2(open));
    css(vstage, "transform", `translate(${f1(960 * PSC * (1 - lerp(0.2, 1, open)))}px, ${f1(540 * PSC * (1 - lerp(0.2, 1, open)))}px) scale(${Math.round(PSC * lerp(0.2, 1, open) * 10000) / 10000})`);
    const pc = { cx: 960, cy: 540, z: 1 };
    const u = prog(t, 41.7, 42.7);
    const outer = u > 0 ? dive(pc, [HERO.x, HERO.y], 0.07, u) : pc;
    aim(pCover.world, outer);
    show(pCover.el, u < 1);
    cP.update(t, { alive: 1, press: t > 41.47 && t < 41.67 ? Math.sin(prog(t, 41.47, 41.67) * Math.PI) : 0 });
    const pjOn = u > 0.1;
    show(pJourney.el, pjOn);
    show(pRing, false);
    if (pjOn) {
      aim(pJourney.world, u < 1 ? innerOf(outer, [HERO.x, HERO.y], 0.07) : pc);
      jP.update(t - 38.8);
      if (u < 1) {
        const [ex, ey] = project(outer, [HERO.x, HERO.y]);
        const R = HERO.r * outer.z * lerp(1, 2.4, ease.in2(u));
        css(pJourney.el, "clipPath", `circle(${f1(R)}px at ${f1(ex)}px ${f1(ey)}px)`);
        const a = ease.inOut2(prog(u, 0.16, 0.42));
        css(pJourney.el, "opacity", a2(a));
        const ra = a * (1 - prog(u, 0.75, 0.95));
        if (ra > 0.01) {
          show(pRing, true);
          css(pRing, "left", f1(ex - R) + "px");
          css(pRing, "top", f1(ey - R) + "px");
          css(pRing, "width", f1(2 * R) + "px");
          css(pRing, "height", f1(2 * R) + "px");
          css(pRing, "opacity", a2(ra));
        }
      } else {
        css(pJourney.el, "clipPath", "none");
        css(pJourney.el, "opacity", "1");
      }
    }
  }
  // a fingertip on the phone
  {
    const tp = prog(t, 41.4, 41.9);
    if (tp > 0 && tp < 1) {
      show(touchEl, true);
      const sx = phoneX(t) + 22 + (1196 - 1920 * PSC) / 2 + (HERO.x + 6) * PSC,
        sy = phoneY(t) + 22 + (HERO.y + 6) * PSC;
      const R = 26 + 10 * ease.out(prog(t, 41.55, 41.9));
      css(touchEl, "left", f1(sx - R) + "px");
      css(touchEl, "top", f1(sy - R) + "px");
      css(touchEl, "width", f1(2 * R) + "px");
      css(touchEl, "height", f1(2 * R) + "px");
      css(touchEl, "opacity", a2(Math.min(ease.out(prog(t, 41.4, 41.5)), 1 - prog(t, 41.65, 41.9))));
    } else show(touchEl, false);
  }

  // ---------------- end card ----------------
  const endOn = t > 49.5;
  show(endL, endOn);
  if (endOn) {
    css(endL, "opacity", a2(ease.inOut2(prog(t, 49.55, 50.0))));
    endSk.update(t);
    candle.update(t);
    attr(candleFill, "opacity", a2(prog(t, LAN_T0 + 0.92, LAN_T0 + 1.08) * 0.85));
    rayInks.forEach((r) => r.update(t));
    const fl = ease.spring(prog(t, IGNITE, IGNITE + 0.7));
    const flick = 1 + 0.04 * Math.sin(t * 13) + 0.03 * Math.sin(t * 7.3);
    css(flame, "transform", `scale(${f1(fl * flick * 100) / 100}, ${f1(fl * (2 - flick) * 100) / 100})`);
    attr(flame, "opacity", a2(fl));
    const gl = ease.out(prog(t, IGNITE, IGNITE + 0.9));
    attr(glowC, "opacity", String(f1(gl * 22) / 100));
    attr(glowC, "r", f1(5.2 + 2.5 * gl + 0.3 * Math.sin(t * 6)));
    css(endGlow, "opacity", a2(ease.out(prog(t, IGNITE, IGNITE + 0.5)) * 0.9 - 0.35 * ease.inOut2(prog(t, IGNITE + 0.5, IGNITE + 2.2))));
    nameChars.forEach((c, i) => {
      const p = ease.out(prog(t, IGNITE + 0.15 + i * 0.07, IGNITE + 0.75 + i * 0.07));
      css(c, "opacity", a2(p));
      css(c, "transform", `translateY(${f1((1 - p) * 40)}px)`);
      css(c, "filter", p < 1 ? `blur(${f1((1 - p) * 8)}px)` : "none");
    });
    const ep = ease.out(prog(t, 52.45, 53.05));
    css(endEn, "opacity", a2(ep));
    css(endEn, "transform", `translateY(${f1((1 - ep) * 14)}px)`);
    css(endUrl, "opacity", a2(prog(t, 53.1, 53.7)));
  }

  // ---------------- HUD ----------------
  const hudA = ease.out(prog(t, 9.4, 10.0)) * (1 - ease.in2(prog(t, 37.95, 38.3)));
  const hudOn = hudA > 0.001 && t < 38.4;
  show(crumbs, hudOn);
  show(toolbar, hudOn);
  show(comp, hudOn);
  if (hudOn) {
    css(crumbs, "opacity", a2(hudA));
    css(toolbar, "opacity", a2(hudA));
    css(comp, "opacity", a2(hudA));
    css(crumbs, "transform", `translateY(${f1((1 - ease.out(prog(t, 9.4, 10.0))) * -12)}px)`);
    const segIn = [12.0, 28.1];
    crumbSegs.forEach((el, i) => {
      const p = ease.out(prog(t, segIn[i], segIn[i] + 0.45)) * (i === 1 ? 1 - ease.in2(prog(t, 35.0, 35.4)) : 1);
      show(el, p > 0.01);
      css(el, "opacity", a2(p));
      css(el, "transform", `translateX(${f1((1 - p) * 30)}px)`);
    });
    const press = t > 36.67 && t < 36.87 ? Math.sin(prog(t, 36.67, 36.87) * Math.PI) : 0;
    css(tbBtns[3], "transform", `scale(${f1((1 - 0.1 * press) * 100) / 100})`);
    tbBtns[3].classList.toggle("on", t > 36.7 && t < 38.0);
    // composer: docked, then asked about the selection, then working
    const gm = ease.inOut(prog(t, 24.05, 24.45)) * (1 - ease.inOut(prog(t, 26.95, 27.4)));
    for (const k of ["x", "y", "w", "h", "r"]) css(comp, k === "x" ? "left" : k === "y" ? "top" : k === "w" ? "width" : k === "h" ? "height" : "borderRadius", f1(lerp(DOCK[k], ASK[k], gm)) + "px");
    css(dockBox, "opacity", a2(1 - prog(gm, 0, 0.4)));
    css(askBox, "opacity", a2(prog(gm, 0.6, 1)));
    show(askBox, gm > 0.01);
    const n = keyTimes.filter((k) => t >= k).length;
    typed.textContent = PROMPT.slice(0, n);
    show(ph, n === 0);
    css(caret, "opacity", n > 0 && n < PROMPT.length ? "1" : (t % 1) < 0.55 ? "1" : "0");
    const sp = t > SEND - 0.06 && t < SEND + 0.14 ? Math.sin(prog(t, SEND - 0.06, SEND + 0.14) * Math.PI) : 0;
    css(askSend, "transform", `scale(${f1((1 - 0.12 * sp) * 100) / 100})`);
    css(askSend, "opacity", n === PROMPT.length ? "1" : "0.25");
    let cur = -1;
    STATUSES.forEach(([s], i) => t >= s && (cur = i));
    statusEls.forEach((el, i) => {
      const s = STATUSES[i][0];
      const inP = ease.out(prog(t, s, s + 0.35));
      const next = STATUSES[i + 1];
      const outP = next ? ease.in2(prog(t, next[0] - 0.3, next[0] - 0.05)) : 0;
      show(el, t >= s - 0.01 && outP < 1);
      css(el, "transform", `translateY(${f1((1 - inP) * 24 - outP * 24)}px)`);
      css(el, "opacity", a2(inP * (1 - outP)));
    });
    const working = cur >= 0 && STATUSES[cur][2];
    dockSpark.twinkle(t, working);
    show(stopBtn, working);
    show(sendSmall, !working);
  }
  // the export menu
  const mOn = t > 36.78 && t < 38.0;
  show(menu, mOn);
  if (mOn) {
    const p = ease.out(prog(t, 36.78, 37.05));
    const q = ease.in2(prog(t, 37.9, 38.0));
    css(menu, "opacity", a2(p * (1 - q)));
    css(menu, "transform", `translateY(${f1((1 - p) * -10)}px) scale(${f1((0.96 + 0.04 * p) * 1000) / 1000})`);
    htmlRow.classList.toggle("hot", t > 37.55);
  }
  // selection on the sign
  if (t > 3.5 && t < 7.6) {
    const gc = galleryCam(t);
    const r = rectOf(gc, 862, 782, 196, 60);
    box(hoverBox, r, window_(t, 3.55, 4.1, 0.15, 0.05));
    box(selBox, r, Math.min(ease.out(prog(t, 4.05, 4.2)), 1 - prog(t, 7.28, 7.5)));
  } else if (t > 22.4 && t < 27.4) {
    const jc = journeyCam(t);
    const r = rectOf(jc, STATION_BOX.x, STATION_BOX.y, STATION_BOX.w, STATION_BOX.h);
    box(hoverBox, r, window_(t, 22.25, 22.6, 0.12, 0.05));
    box(selBox, r, Math.min(ease.out(prog(t, 22.52, 22.7)), 1 - prog(t, 26.9, 27.2)));
  } else {
    box(hoverBox, null, 0);
    box(selBox, null, 0);
  }
  const barA = Math.min(ease.out(prog(t, 22.65, 22.95)), 1 - prog(t, 24.0, 24.25));
  if (barA > 0.005 && t < 24.3) {
    show(selBar, true);
    const p = selBarAt(t);
    css(selBar, "left", f1(p.x) + "px");
    css(selBar, "top", f1(p.y + (1 - barA) * 10) + "px");
    css(selBar, "opacity", a2(barA));
    const ap = t > 23.87 && t < 24.07 ? Math.sin(prog(t, 23.87, 24.07) * Math.PI) : 0;
    css(askChip, "transform", `scale(${f1((1 - 0.08 * ap) * 100) / 100})`);
    css(askChip, "background", t > 23.75 ? "rgba(217,119,87,.2)" : "rgba(217,119,87,.1)");
  } else show(selBar, false);

  show(ring, ringOn);
  captions.forEach((c) => c.update(t));

  // ---------------- hands ----------------
  let st = null,
    beam = false;
  for (const R of ROUTES) {
    const s = route(t, R);
    if (s) {
      st = s;
      beam = R.ibeam !== undefined && t > R.ibeam;
    }
  }
  if (st && beam) {
    cursor.update(null);
    show(ibeam, true);
    css(ibeam, "transform", `translate(${f1(st.x)}px, ${f1(st.y)}px) scale(${f1((1.5 - 0.15 * st.press) * 100) / 100})`);
    css(ibeam, "opacity", a2(st.alpha));
  } else {
    show(ibeam, false);
    cursor.update(st);
  }
  pencil.update(pencilAt(t));
}

/** Where the pencil is, from whatever is being drawn. */
function pencilAt(t) {
  if (t > 28.3 && t < 34.0) {
    const p = rM.sketcher.pencil(t - R0);
    if (p) {
      const [x, y] = project(roastCam(t), p.at);
      return { x, y, lift: p.down ? 0 : p.lift ?? 0.6 };
    }
  }
  if (t > LAN_T0 - 0.45 && t < DOT_T0 + 0.9) {
    const p = endSk.pencil(t, 0.2);
    // in from the lower right
    if (t < LAN_T0) {
      const q = lanPt(lanInks[0].point(LAN_T0));
      const u = ease.out(prog(t, LAN_T0 - 0.45, LAN_T0));
      return { x: lerp(2100, q[0], u), y: lerp(1200, q[1], u), lift: 1 - u };
    }
    if (p && t <= candle.t1 + 0.05) {
      const q = lanPt(p.at);
      return { x: q[0], y: q[1], lift: p.down ? 0 : p.lift ?? 0.6 };
    }
    // waits beside the words while the lamp lights, then signs off with a full stop
    const last = lanPt(candle.point(candle.t1));
    if (t < DOT_T0 - 0.35) {
      const u = ease.inOut2(prog(t, candle.t1, candle.t1 + 0.45));
      const rest = [DOT.x + 40, DOT.y + 70];
      return { x: lerp(last[0], rest[0], u), y: lerp(last[1], rest[1], u) + Math.sin(t * 3.4) * 5 * u, lift: 1 };
    }
    if (t < DOT_T0) {
      const u = ease.inOut2(prog(t, DOT_T0 - 0.35, DOT_T0));
      const q = dot.point(DOT_T0);
      return { x: lerp(DOT.x + 40, q[0], u), y: lerp(DOT.y + 70, q[1], u), lift: 1 - u };
    }
    if (t <= dot.t1) {
      const q = dot.point(t);
      return { x: q[0], y: q[1], lift: 0 };
    }
    const q = dot.point(dot.t1);
    const u = ease.in2(prog(t, dot.t1 + 0.05, dot.t1 + 0.65));
    return { x: lerp(q[0], 2150, u), y: lerp(q[1], 1300, u), lift: Math.min(1, prog(t, dot.t1, dot.t1 + 0.12)) };
  }
  return null;
}
function mixC(c1, c2, k) {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const A = p(c1),
    B = p(c2);
  return "#" + A.map((v, i) => Math.round(lerp(v, B[i], k)).toString(16).padStart(2, "0")).join("");
}

// =====================================================================================
// Running: in the renderer, frames are asked for; in a browser, it plays.
// =====================================================================================
const allText = stage.textContent + PROMPT + STATUSES.map((s) => s[1]).join("") + "请你动手请勿触摸。DrawY咖啡的来历烘焙";
await Promise.all(FACES.map((f) => document.fonts.load(f, allText)));
await document.fonts.ready;
const DN_W = dn.offsetWidth;
selBarW = selBar.offsetWidth || 444;
askOff = askChip.offsetLeft + askChip.offsetWidth / 2;
show(selBar, false);

window.__duration = DURATION;
window.__cues = CUES.slice().sort((a, b) => a.t - b.t);
window.__render = (t) => render(t);
window.__ready = true;

const params = new URLSearchParams(location.search);
if (params.has("t")) render(parseFloat(params.get("t")));
else if (!params.has("still")) {
  const start = performance.now() - parseFloat(params.get("from") || "0") * 1000;
  const loop = () => {
    render(((performance.now() - start) / 1000) % DURATION);
    requestAnimationFrame(loop);
  };
  loop();
}

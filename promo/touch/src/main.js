// 《请勿触摸》 — fifty-five seconds for DrawY. Every frame is a pure function of time.
//
// A museum at night. Under a painting of a cup of coffee, a brass plaque: 请勿触摸. A
// cursor edits the plaque to read 请你动手; the painting begins to steam. A bean in it opens
// along its crease, and inside is a handscroll of where coffee comes from. A request about
// one step opens the roaster's door and a page of detail rolls out. The whole scroll rolls up,
// is carried off on a phone, and still opens there. Back in the museum, the other pictures
// light up, and the plaque becomes the last card: DrawY · 请你动手。
import { W, H, clamp, lerp, prog, logLerp, ease, bell, press, rng, noise, drift, mixHex, el, sv, css, show, op, r1, r3, canvas, project, aim, camCtx, CUES, cue } from "./core.js";
import { ellipse, wash, ink, paper, sprite } from "./paint.js";
import { paintCover, paintHero, paintStudy, HERO, ring } from "./art.js";
import { paintJourney, drawJourney, walkCam, setDoor, SW, SH, ST, DOOR, ANCHOR } from "./journey.js";
import { paintRoast, drawRoast } from "./roast.js";

const DURATION = 55;
const stage = document.getElementById("stage");
const FACES = ['400 160px "Young Serif"', '700 46px "Noto Serif SC"', '400 40px "Noto Sans SC"', '500 40px "Noto Sans SC"', '400 80px "Ma Shan Zheng"', '500 26px "IBM Plex Mono"', '600 20px "Bricolage Grotesque"', '700 160px "Bricolage Grotesque"'];
const GLYPHS = "请勿触摸你动手点开一颗豆子走进它的来历整件作品一起带走在哪儿打开都还能点接着把细节画出来烘焙这一步再讲细讲一点火候怎样改变风味？，。已选中导出可交互网页咖啡的场景离线也能看果实处理冲煮红透了才采摘洗去果皮晒干决定热水带出香气与分钟约脱水梅纳反应发展生豆转黄烤面包一爆噼啪浅中深花香果酸焦糖坚果可可烟熏°C0123456789·ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz,.";
await Promise.all(FACES.map((f) => document.fonts.load(f, GLYPHS)));
await document.fonts.ready;

// ---------- paint everything once ----------
const COVER = paintCover();
const HEROART = paintHero(6);
const STUDIES = [paintStudy("cherries", 1), paintStudy("ring", 2)];
const JART = paintJourney();
const RART = paintRoast();

// =====================================================================================
// Timeline
// =====================================================================================
const T = {
  toPlaque: [2.5, 3.9],
  dbl: [4.15, 4.32],
  drag: [4.55, 5.05],
  types: [5.4, 5.75, 6.1, 6.45],
  enMorph: [6.6, 7.15],
  commit: 7.3,
  toMedium: [7.5, 9.2],
  steam: 7.6,
  toFill: [9.2, 10.4],
  click: 11.45,
  open: [11.5, 12.1],
  dive: [11.55, 12.9],
  J0: 12.9,
  overview: [21.0, 22.6],
  select: 23.25,
  prompt: 23.75,
  typing: 24.25,
  send: 26.85,
  toDoor: [27.25, 28.45],
  door: [28.0, 28.4],
  unroll: [28.4, 29.25],
  R0: 29.25,
  rollBack: [34.6, 35.45],
  fromDoor: [35.45, 36.5],
  chip: 36.6,
  chipClick: 37.05,
  rollUp: [37.25, 38.6],
  carry: [38.6, 40.25],
  phoneIn: [39.2, 40.0],
  phoneOpen: [40.25, 40.8],
  tap: 41.45,
  pOpen: [41.6, 42.45],
  pBack: [43.55, 44.05],
  push: [44.1, 45.0],
  pullBack: [45.0, 46.9],
  lights: [47.2, 47.7],
  toPlaque2: [48.4, 50.0],
  endIn: [49.85, 50.55],
  drop: 51.25,
  brand: 51.6,
};

// =====================================================================================
// Layers
// =====================================================================================
function layer(parent = stage) {
  const e = el("div", "layer", parent);
  const world = el("div", "world", e);
  return { el: e, world };
}
const gal = layer();
const air = canvas(W, H, stage, "screen");
const ag = air.getContext("2d");
const jc = canvas(W, H, stage, "screen");
const jg = jc.getContext("2d");
const rc = canvas(W, H, stage, "screen");
const rg = rc.getContext("2d");
const phoneL = el("div", "layer", stage);
const topC = canvas(W, H, stage, "screen");
const tgx = topC.getContext("2d");
const endL = el("div", "endcard", stage);
const hud = el("div", "layer", stage);
const grainC = canvas(960, 540, stage, "grain");
el("div", "vignette", stage);

// ---------- the gallery ----------
const GW = gal.world;
const plaster = (() => {
  const c = canvas(512, 512),
    g = c.getContext("2d"),
    im = g.createImageData(512, 512),
    r = rng(3);
  for (let i = 0; i < im.data.length; i += 4) {
    const v = 0.5 + (r() - 0.5) * 0.5 + 0.25 * noise((i / 4) % 512 / 37, 1) * noise(Math.floor(i / 4 / 512) / 41, 2);
    im.data[i] = im.data[i + 1] = im.data[i + 2] = 255 * v;
    im.data[i + 3] = 18;
  }
  g.putImageData(im, 0, 0);
  return c.toDataURL();
})();
const wall = el("div", "wall", GW);
wall.style.backgroundImage = `url(${plaster})`;
const PAINT = { x: 540, y: 183.75, w: 840, h: 472.5 };
const PS = PAINT.w / 1920;
const HERO_G = [PAINT.x + HERO.x * PS, PAINT.y + HERO.y * PS];
const CUP_G = [PAINT.x + 1080 * PS, PAINT.y + 470 * PS];
function pool(x, y, w, h, a, parent = GW) {
  const p = el("div", "pool", parent, { left: x - w / 2 + "px", top: y - h / 2 + "px", width: w + "px", height: h + "px", background: `radial-gradient(closest-side, rgba(255,224,178,${a}), rgba(255,214,160,${a * 0.35}) 55%, transparent)` });
  return p;
}
const mainPool = pool(960, 420, 1700, 1200, 0.3);
const plaquePool = pool(960, 842, 700, 260, 0.2);
el("div", "floor", GW);
el("div", "skirting", GW);
const floorGlow = el("div", "pool", GW, { left: "460px", top: "940px", width: "1000px", height: "160px", background: "radial-gradient(closest-side, rgba(255,220,170,0.12), transparent)" });
function makeFrame(cx, cy, w, h, img, scale) {
  const MAT = 64 * (w / 840),
    FR = 20 * (w / 840);
  const f = el("div", "frame", GW, { left: cx - w / 2 - MAT - FR + "px", top: cy - h / 2 - MAT - FR + "px", width: w + 2 * (MAT + FR) + "px", height: h + 2 * (MAT + FR) + "px" });
  el("div", "mat", f, { left: FR + "px", top: FR + "px", right: FR + "px", bottom: FR + "px" });
  const art = el("div", "art", f, { left: FR + MAT + "px", top: FR + MAT + "px", width: img.width + "px", height: img.height + "px", transform: `scale(${scale})` });
  art.appendChild(img);
  const shade = el("div", "shade", f, { left: FR + MAT + "px", top: FR + MAT + "px", width: w + "px", height: h + "px", background: "radial-gradient(90% 85% at 50% 30%, rgba(255,236,200,0.12), rgba(0,0,0,0) 60%, rgba(40,25,10,0.14))" });
  const dark = el("div", "dark", f, { opacity: 0 });
  return { f, art, shade, dark };
}
const mainFrame = makeFrame(960, 420, PAINT.w, PAINT.h, COVER, PS);
COVER.style.filter = "brightness(1.05) saturate(1.12) sepia(0.06)";
mainFrame.dark.remove();
// the hero bean, in two halves, over the painting
const heroBox = el("div", "abs", mainFrame.art, { left: HERO.x - HEROART.w / 2 + "px", top: HERO.y - HEROART.h / 2 + "px", width: HEROART.w + "px", height: HEROART.h + "px", transform: `rotate(${HERO.rot}rad)` });
const heroGlow = el("div", "abs", heroBox, { left: "0", top: "0", width: HEROART.w + "px", height: HEROART.h + "px", background: "radial-gradient(50% 18% at 50% 50%, rgba(255,250,232,1), rgba(255,226,170,0.75) 45%, transparent 75%)", opacity: 0 });
const heroTop = HEROART.top,
  heroBot = HEROART.bottom;
for (const c of [heroTop, heroBot]) {
  c.style.position = "absolute";
  c.style.left = "0";
  c.style.top = "0";
  c.style.width = HEROART.w + "px";
  c.style.height = HEROART.h + "px";
  heroBox.appendChild(c);
}
const sides = [
  { cx: -520, img: STUDIES[0], on: T.lights[0] },
  { cx: 2440, img: STUDIES[1], on: T.lights[1] },
].map((s) => {
  const w = 600,
    h = (w * s.img.height) / s.img.width;
  const fr = makeFrame(s.cx, 440, w, h, s.img, w / s.img.width);
  const p = pool(s.cx, 440, 1300, 1000, 0.26);
  GW.insertBefore(p, fr.f);
  return { ...s, fr, p };
});
// the plaque
const PLQ = { x: 790, y: 790, w: 340, h: 104 };
const plaque = el("div", "plaque", GW, { left: PLQ.x + "px", top: PLQ.y + "px", width: PLQ.w + "px", height: PLQ.h + "px" });
const CH = 52,
  ZH_FS = 46,
  ZH_CY = 830;
const hlEl = el("div", "hl", plaque, { top: ZH_CY - PLQ.y - 28 + "px", height: "56px" });
const zhEl = el("div", "zh", plaque, { top: ZH_CY - PLQ.y - 34 + "px", fontSize: ZH_FS + "px", lineHeight: "68px" });
const zhSpans = [0, 1, 2, 3].map(() => el("span", "ch", zhEl, { width: CH + "px" }));
const caretEl = el("div", "caret", plaque, { top: ZH_CY - PLQ.y - 24 + "px", height: "48px" });
const enEl = el("div", "en", plaque, { top: 870 - PLQ.y - 7 + "px", fontSize: "12px", letterSpacing: "0.34em" });
const glint = el("div", "glint", plaque, { left: "-200px" });
const EN_FROM = "PLEASE DO NOT TOUCH",
  EN_TO = "HANDS ON, PLEASE";

// =====================================================================================
// HUD
// =====================================================================================
const editBox = el("div", "edit", hud);
[[0, 0], [100, 0], [0, 100], [100, 100]].forEach(([x, y]) => el("i", "", editBox, { left: x + "%", top: y + "%" }));
const brackets = el("div", "brackets", hud);
for (let i = 0; i < 4; i++) el("i", "", brackets);
const selTag = el("div", "chip", hud);
selTag.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/></svg>已选中 · 烘焙`;
const SPARK = (c = "#fff", s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path d="M12 2.5c.7 4.7 2.8 7.4 8 8.6-5.2 1.2-7.3 3.9-8 8.9-.8-5-2.9-7.7-8-8.9 5.1-1.2 7.2-3.9 8-8.6z" fill="${c}"/></svg>`;
const promptEl = el("div", "prompt", hud, { top: "848px" });
promptEl.innerHTML = `<span class="tagq">${SPARK("#3b7bff", 18)}烘焙</span><span class="field"><span class="typed"></span><span class="caret"></span><span class="ph">想让这一步怎么变？</span></span><span class="send"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg></span>`;
const pTyped = promptEl.querySelector(".typed"),
  pCaret = promptEl.querySelector(".caret"),
  pPh = promptEl.querySelector(".ph"),
  pSend = promptEl.querySelector(".send");
const PROMPT = "烘焙这一步，再讲细一点：火候怎样改变风味？";
const keyTimes = [];
{
  const r = rng(17);
  let t = T.typing;
  for (const _ of PROMPT) {
    keyTimes.push(t);
    t += 0.075 + r() * 0.04;
  }
}
const SEND_BTN = [400 + 1120 - 14 - 32, 848 + 46];
const exportChip = el("div", "chip", hud, { left: "0", top: "0" });
exportChip.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>导出 · 可交互网页`;
// subtitles
const SUBS = [
  { zh: "点开一颗豆子，走进它的来历。", t0: 13.2, t1: 16.6, y: 1000, tone: "ink" },
  { zh: "它接着，把细节画出来。", t0: 29.7, t1: 33.6, y: 1012, tone: "ink" },
  { zh: "整件作品，一起带走。", t0: 37.5, t1: 40.8, y: 990, tone: "light" },
  { zh: "在哪儿打开，都还能点。", t0: 41.25, t1: 44.0, y: 990, tone: "light" },
].map((s) => {
  const e = el("div", "sub", hud, { top: s.y - 28 + "px" });
  s.chars = [...s.zh].map((ch) => {
    const sp = el("span", "", e);
    sp.textContent = ch;
    return sp;
  });
  e.style.color = s.tone === "ink" ? "#26180f" : "#f3ead9";
  e.style.textShadow = s.tone === "ink" ? "0 0 18px rgba(243,234,214,0.95), 0 0 4px rgba(243,234,214,0.9)" : "0 2px 18px rgba(0,0,0,0.6)";
  cue(s.t0, "sub");
  return { ...s, el: e };
});
// hands
const cursorEl = el("div", "abs", hud);
cursorEl.innerHTML = `<svg width="60" height="70" viewBox="-2 -2 30 36" style="position:absolute;left:-3px;top:-3px;overflow:visible;filter:drop-shadow(0 6px 10px rgba(0,0,0,.35))"><path d="M1 1 L1 25.5 L7.2 19.8 L11.4 29.4 L15.6 27.6 L11.6 18.4 L19.8 18.4 Z" fill="#fbfaf7" stroke="#16130f" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
const ibeamEl = el("div", "abs", hud);
ibeamEl.innerHTML = `<svg width="40" height="60" viewBox="-10 -16 20 32" style="position:absolute;left:-20px;top:-30px;overflow:visible;filter:drop-shadow(0 3px 6px rgba(0,0,0,.4))"><path d="M-6 -13h3.5l2.5 2.2 2.5-2.2H6M0 -10.8v21.6M-6 13h3.5l2.5-2.2 2.5 2.2H6" fill="none" stroke="#fff" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M-6 -13h3.5l2.5 2.2 2.5-2.2H6M0 -10.8v21.6M-6 13h3.5l2.5-2.2 2.5 2.2H6" fill="none" stroke="#16130f" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ringEl = el("div", "abs", hud, { borderRadius: "50%", border: "3px solid #3b7bff" });
const touchEl = el("div", "touchdot", hud);

// ---------- the phone ----------
const PH = { x: 340, y: 240, w: 1240, h: 600, sx: 22, sy: 22, sw: 1196, sh: 556 };
const phone = el("div", "phone", phoneL);
const pc = canvas(PH.sw, PH.sh, phone);
const pg = pc.getContext("2d");
el("div", "island", phone);

// ---------- the end card ----------
const endPaper = paper(W, H, { seed: 501, color: "#f2e8d4", mottle: 140, vignette: 0.14 });
endL.appendChild(endPaper);
const endC = canvas(W, H, endL);
const eg = endC.getContext("2d");
const Z_END = 120 / ZH_FS,
  END_CY = 640,
  CY_END = ZH_CY - (END_CY - H / 2) / Z_END,
  CH_END = CH * Z_END;
const endZh = el("div", "zh", endL, { top: END_CY - 0.75 * 120 + "px", fontSize: "120px", lineHeight: "180px" });
[..."请你动手"].forEach((c) => {
  const s = el("span", "ch", endZh, { width: CH_END + "px" });
  s.textContent = c;
});
const brandEl = el("div", "brand", endL, { top: "300px" });
const brandChars = [..."DrawY"].map((c) => {
  const s = el("span", "", brandEl);
  s.textContent = c;
  return s;
});
const DOT = { x: 960 + 2 * CH_END + 22, y: END_CY + 40 };
const stain = sprite(120, 120, 2, (g) => ring(g, 60, 60, 26, { seed: 31, width: 2.8, strength: 1.6, gap: 0.08, fill: 3, drops: 0, tone: "#7a4a22" }));

// film grain
{
  const g = grainC.getContext("2d"),
    im = g.createImageData(960, 540),
    r = rng(8);
  for (let i = 0; i < im.data.length; i += 4) {
    const v = 128 + (r() + r() + r() - 1.5) * 70;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
    im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  grainC.style.width = "2100px";
  grainC.style.height = "1200px";
  grainC.style.opacity = "0.16";
}

// =====================================================================================
// Cues the picture makes
// =====================================================================================
cue(0, "room", { dur: 7.6 });
[0.7, 1.45, 2.15].forEach((t) => cue(t, "footstep"));
cue(T.dbl[0], "click");
cue(T.dbl[1], "click");
cue(T.drag[0], "select", { dur: T.drag[1] - T.drag[0] });
cue(5.22, "key");
T.types.forEach((t) => [-0.24, -0.16, -0.08, 0].forEach((d) => cue(t + d, "key")));
cue(T.enMorph[0], "scramble", { dur: T.enMorph[1] - T.enMorph[0] });
cue(T.commit, "commit");
cue(7.5, "lightup");
cue(T.steam, "steam", { dur: 3 });
cue(T.click, "click");
cue(T.open[0], "seam");
cue(T.dive[0], "dive", { dur: T.dive[1] - T.dive[0] });
cue(T.J0 + 1.35, "plop");
cue(T.J0 + 1.6, "plop", { gain: 0.6 });
cue(T.J0 + 2.75, "splash");
cue(T.J0 + 3.05, "peel");
cue(T.J0 + 3.45, "tick");
cue(T.J0 + 4.55, "tick");
cue(T.J0 + 5.5, "rattle");
cue(T.J0 + 5.55, "fire", { dur: 1.2 });
cue(T.J0 + 6.2, "pop");
cue(T.J0 + 6.55, "tick");
cue(T.J0 + 7.95, "tick");
cue(T.J0 + 7.95, "pour", { dur: 1.0 });
cue(T.J0 + 8.3, "drip");
cue(T.overview[0], "pullback", { dur: 1.6 });
cue(T.select, "click");
cue(T.select + 0.05, "snap");
cue(T.prompt, "pill");
keyTimes.forEach((t) => cue(t, "key"));
cue(T.send, "click");
cue(T.send + 0.08, "send");
cue(T.toDoor[0] + 0.2, "dive", { dur: 1.0, gain: 0.8 });
cue(T.door[0], "creak");
cue(T.unroll[0], "unroll", { dur: T.unroll[1] - T.unroll[0] });
[0, 1, 2, 3, 4, 5, 6, 7, 8].forEach((i) => cue(T.R0 + 0.8 + i * 0.24, "bean", { k: i }));
cue(T.R0 + 0.8 + 5 * 0.24, "crack");
cue(T.R0 + 0.25, "draw", { dur: 1.65 });
cue(T.rollBack[0], "unroll", { dur: 0.85, back: 1 });
cue(T.fromDoor[0] + 0.3, "creak", { back: 1 });
cue(T.fromDoor[0], "pullback", { dur: 1.0 });
cue(T.chip, "pill");
cue(T.chipClick, "click");
cue(T.rollUp[0], "rollup", { dur: T.rollUp[1] - T.rollUp[0] });
cue(T.rollUp[1] - 0.05, "thock");
cue(T.carry[0] + 0.2, "fly", { dur: 1.2 });
cue(T.phoneIn[0], "phone", { dur: 0.8 });
cue(T.phoneOpen[0], "open");
cue(T.tap, "tap");
cue(T.pOpen[0], "seam", { gain: 0.6 });
cue(T.pBack[0], "pullback", { dur: 0.5, gain: 0.5 });
cue(T.push[0], "push", { dur: 0.9 });
cue(T.pullBack[0], "room", { dur: 5.0 });
cue(T.pullBack[0], "pullback", { dur: 1.8, gain: 0.7 });
cue(T.lights[0], "lamp");
cue(T.lights[1], "lamp");
cue(T.toPlaque2[0], "push", { dur: 1.6 });
cue(T.drop - 0.32, "fall");
cue(T.drop, "dropring");
cue(T.brand, "brand");

// =====================================================================================
// Cameras
// =====================================================================================
const FILL = { cx: 960, cy: 420, z: W / PAINT.w };
const WIDE = { cx: 960, cy: 520, z: 0.64 };
const AT_PLAQUE = { cx: 960, cy: 842, z: 2.55 };
const MEDIUM = { cx: 960, cy: 330, z: 1.04 };
const END = { cx: 960, cy: CY_END, z: Z_END };
const mixCam = (a, b, k, zk = k) => ({ cx: lerp(a.cx, b.cx, k), cy: lerp(a.cy, b.cy, k), z: logLerp(a.z, b.z, zk) });
const breathe = (c, t, amt = 1) => ({ ...c, cx: c.cx + drift(t, 3) * 6 * amt / c.z, cy: c.cy + drift(t, 9) * 4 * amt / c.z });
function galleryCam(t) {
  let c;
  if (t < T.pullBack[0]) {
    c = { ...WIDE, z: lerp(0.6, 0.68, ease.io2(prog(t, 0, 2.6))) };
    const a = ease.io3(prog(t, T.toPlaque[0], T.toPlaque[1]));
    if (a > 0) c = mixCam(c, AT_PLAQUE, a);
    if (t > T.toPlaque[1]) c = { ...AT_PLAQUE, z: AT_PLAQUE.z * (1 + 0.015 * ease.io2(prog(t, 3.9, 7.5))) };
    const b = ease.io3(prog(t, T.toMedium[0], T.toMedium[1]));
    if (b > 0) c = mixCam({ ...AT_PLAQUE, z: AT_PLAQUE.z * 1.015 }, MEDIUM, b);
    const f = ease.io3(prog(t, T.toFill[0], T.toFill[1]));
    if (f > 0) c = mixCam(MEDIUM, FILL, f);
    if (t > T.toFill[1]) c = { ...FILL, z: FILL.z * (1 + 0.01 * ease.io2(prog(t, 10.4, 11.5))) };
    // into the bean
    const d = prog(t, T.dive[0], T.dive[1]);
    if (d > 0) {
      const base = { ...FILL, z: FILL.z * 1.01 };
      const zu = ease.in2(d) * 0.4 + ease.io3(d) * 0.6;
      c = { cx: lerp(base.cx, HERO_G[0], ease.out3(prog(d, 0, 0.6))), cy: lerp(base.cy, HERO_G[1], ease.out3(prog(d, 0, 0.6))), z: logLerp(base.z, 70, zu) };
    }
    return t < T.dive[0] ? breathe(c, t, t < T.toPlaque[0] ? 1.4 : 0.6) : c;
  }
  // back again: from the painting out to the room, the lights, the plaque
  c = mixCam(FILL, { ...WIDE, cy: 500, z: 0.56 }, ease.io3(prog(t, T.pullBack[0], T.pullBack[1])));
  if (t > T.pullBack[1]) c = { ...WIDE, cy: 500, z: 0.56 * (1 + 0.03 * ease.io2(prog(t, T.pullBack[1], T.toPlaque2[0]))) };
  const p = ease.io3(prog(t, T.toPlaque2[0], T.toPlaque2[1]));
  if (p > 0) c = mixCam({ ...WIDE, cy: 500, z: 0.56 * 1.03 }, END, p);
  return breathe(c, t, 1 - p);
}
const OV = { cx: ANCHOR, cy: 610, z: 0.36 };
const DOORCAM = { cx: DOOR.x, cy: DOOR.y, z: 4.4 };
function journeyCam(t) {
  if (t < T.J0) return { cx: walkCam(0), cy: 540, z: lerp(1.32, 1, ease.out3(prog(t, T.dive[0] + 0.1, T.J0 + 0.2))) };
  let c = { cx: walkCam(t - T.J0), cy: 540, z: 1 };
  const o = prog(t, T.overview[0], T.overview[1]);
  if (o > 0) c = { cx: lerp(c.cx, OV.cx, ease.io3(o)), cy: lerp(540, OV.cy, ease.io3(o)), z: logLerp(1, OV.z, ease.io3(o)) };
  if (t > T.overview[1]) c = breathe(OV, t, 0.4);
  const d = prog(t, T.toDoor[0], T.toDoor[1]);
  if (d > 0 && t < T.fromDoor[0]) {
    const zu = ease.in2(d) * 0.4 + ease.io3(d) * 0.6;
    c = { cx: lerp(OV.cx, DOORCAM.cx, ease.out3(prog(d, 0, 0.7))), cy: lerp(OV.cy, DOORCAM.cy, ease.out3(prog(d, 0, 0.7))), z: logLerp(OV.z, DOORCAM.z, zu) };
  }
  const b = prog(t, T.fromDoor[0], T.fromDoor[1]);
  if (t >= T.fromDoor[0]) c = mixCam(DOORCAM, OV, ease.io3(b));
  return c;
}

// =====================================================================================
// Little helpers for the HUD
// =====================================================================================
function place(e, x, y, w, h) {
  css(e, "left", r1(x) + "px");
  css(e, "top", r1(y) + "px");
  if (w !== undefined) css(e, "width", r1(w) + "px");
  if (h !== undefined) css(e, "height", r1(h) + "px");
}
const rectOf = (cam, x, y, w, h) => {
  const [x0, y0] = project(cam, [x, y]),
    [x1, y1] = project(cam, [x + w, y + h]);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
/** A cursor along waypoints, clicking where told. */
function route(t, R) {
  if (t < R.on - 0.3 || t > R.off + 0.3) return null;
  const at = (p) => (typeof p === "function" ? p(t) : p);
  const P = R.pts;
  let x, y;
  if (t <= P[0][0]) [x, y] = at(P[0][1]);
  else if (t >= P.at(-1)[0]) [x, y] = at(P.at(-1)[1]);
  else
    for (let i = 0; i < P.length - 1; i++) {
      const [ta, pa] = P[i],
        [tb, pb, how] = P[i + 1];
      if (t >= ta && t <= tb) {
        const k = ease.io3(prog(t, ta, tb)),
          A = at(pa),
          B = at(pb);
        const d = Math.hypot(B[0] - A[0], B[1] - A[1]);
        x = lerp(A[0], B[0], k);
        y = lerp(A[1], B[1], k) - (how === "straight" ? 0 : Math.sin(k * Math.PI) * Math.min(70, d * 0.12));
        break;
      }
    }
  let pr = 0,
    rp = -1;
  for (const c of R.clicks || []) {
    pr = Math.max(pr, press(t, c, 0.09));
    if (t >= c && t < c + 0.5) rp = prog(t, c, c + 0.5);
  }
  return { x, y, press: pr, ripple: rp, alpha: Math.min(prog(t, R.on - 0.3, R.on), 1 - prog(t, R.off, R.off + 0.3)), ibeam: R.ibeam && t > R.ibeam[0] && t < R.ibeam[1] };
}
const G = (x, y) => (tt) => project(galleryCam(tt), [x, y]);
const Jp = (x, y) => (tt) => project(journeyCam(tt), [x, y]);
const ROUTES = [
  { pts: [[2.6, [1560, 1040]], [3.75, G(912, ZH_CY + 2)], [4.38, G(912, ZH_CY + 2)], [4.55, G(960 - 2 * CH + 2, ZH_CY), "straight"], [5.05, G(960 + 2 * CH - 2, ZH_CY), "straight"], [5.3, G(980 + 2 * CH, ZH_CY + 30)]], clicks: T.dbl, on: 2.6, off: 5.25, ibeam: [3.72, 9] },
  { pts: [[10.3, [1580, 1000]], [11.25, G(HERO_G[0] + 6, HERO_G[1] + 4)]], clicks: [T.click], on: 10.3, off: 11.55 },
  { pts: [[22.6, [1700, 1000]], [23.15, Jp(ST[2] + 10, 640)], [23.6, Jp(ST[2] + 10, 640)], [24.2, [1590, 985]], [26.35, [1590, 985]], [26.75, SEND_BTN]], clicks: [T.select, T.send], on: 22.6, off: 27.05 },
  { pts: [[36.55, [1500, 1000]], [36.95, () => chipCenter]], clicks: [T.chipClick], on: 36.55, off: 37.35 },
];
let chipCenter = [960, 860];

// =====================================================================================
// render(t)
// =====================================================================================
function render(t) {
  tgx.setTransform(1, 0, 0, 1, 0, 0);
  tgx.clearRect(0, 0, W, H);
  // ---------------- the gallery ----------------
  const galOn = t < T.dive[1] + 0.05 || t > T.pullBack[0];
  show(gal.el, galOn);
  if (galOn) {
    const gc = galleryCam(t);
    aim(GW, gc);
    op(gal.el, Math.min(ease.io2(prog(t, 0, 1.4)), 1 - (t > T.endIn[1] ? 1 : 0)));
    // the light warms when the sign changes
    const warm = ease.io2(prog(t, 7.45, 8.4));
    op(mainPool, 0.75 + 0.25 * warm + 0.04 * Math.sin(t * 1.3));
    op(plaquePool, 0.8 + 0.2 * Math.sin(t * 0.9));
    sides.forEach((s) => {
      const on = t > T.pullBack[0] ? ease.out3(prog(t, s.on, s.on + 0.35)) : 0;
      const flick = on > 0 && on < 1 ? 0.75 + 0.25 * Math.sin(t * 90) : 1;
      op(s.fr.dark, 0.92 - 0.92 * on * flick);
      op(s.p, on * flick);
    });
    // the bean opens
    const o = t > T.pullBack[0] ? 0 : ease.io3(prog(t, T.open[0], T.open[1]));
    const gap = o * HEROART.h * 0.16;
    css(heroTop, "transform", `translateY(${r1(-gap)}px) rotate(${r3(-o * 4)}deg)`);
    css(heroBot, "transform", `translateY(${r1(gap)}px) rotate(${r3(o * 3)}deg)`);
    op(heroGlow, t > T.pullBack[0] ? 0 : Math.max(bell(t, T.click + 0.02, T.open[1] + 0.6, 0.15, 0.2) * 0.6, o));
    const lift = bell(t, 10.95, T.click + 0.1, 0.2, 0.08);
    css(heroBox, "transform", `rotate(${HERO.rot}rad) scale(${r3(1 + 0.05 * lift - 0.04 * press(t, T.click, 0.1))})`);
    drawPlaque(t);
  }
  // ---------------- air: the beam, dust, steam ----------------
  ag.setTransform(1, 0, 0, 1, 0, 0);
  ag.clearRect(0, 0, W, H);
  const airOn = galOn && t < T.dive[0] + 0.6;
  if (galOn) drawAir(t, galleryCam(t));
  // ---------------- the scroll ----------------
  const jOn = t > T.dive[0] + 0.15 && t < T.carry[1] && !(t > T.unroll[1] + 0.05 && t < T.rollBack[0] - 0.05);
  show(jc, jOn);
  if (jOn) {
    jg.setTransform(1, 0, 0, 1, 0, 0);
    const cam = journeyCam(t);
    const whole = cam.z < 0.995 || t > T.overview[0] + 0.2;
    jg.fillStyle = "#17130f";
    jg.fillRect(0, 0, W, H);
    setDoor(ease.io3(prog(t, T.door[0], T.door[1])) * (1 - ease.io3(prog(t, T.fromDoor[0] + 0.2, T.fromDoor[0] + 0.6))));
    const jt = Math.min(t - T.J0, 9.6);
    if (t < T.rollUp[0]) drawJourney(jg, JART, cam, Math.max(0, jt), { edges: whole, fore: 1 - prog(t, T.overview[0], T.overview[0] + 0.8) });
    else drawRolling(t, cam, jt);
    // the lens through the bean's seam
    const d = prog(t, T.dive[0], T.dive[1]);
    if (d < 1) {
      const gc = galleryCam(t);
      const [sx, sy] = project(gc, HERO_G);
      const hw = lerp(HEROART.h * 0.05, 1700, ease.in3(prog(d, 0.05, 1))) + gc.z * HEROART.h * PS * 0.16 * ease.io3(prog(t, T.open[0], T.open[1]));
      const hl = Math.max((HEROART.w * PS * gc.z) / 2, hw * 1.8);
      const a = HERO.rot - 0.05;
      const pts = [];
      for (let i = 0; i <= 80; i++) {
        const u = -1 + (i / 80) * 2,
          v = Math.pow(1 - u * u, 0.6);
        pts.push([u * hl, -v * hw]);
      }
      for (let i = 80; i >= 0; i--) {
        const u = -1 + (i / 80) * 2,
          v = Math.pow(1 - u * u, 0.6);
        pts.push([u * hl, v * hw]);
      }
      const P = pts.map(([x, y]) => [sx + x * Math.cos(a) - y * Math.sin(a), sy + x * Math.sin(a) + y * Math.cos(a)]);
      css(jc, "clipPath", `polygon(${P.map(([x, y]) => `${r1(x)}px ${r1(y)}px`).join(",")})`);
      jg.save();
      jg.setTransform(1, 0, 0, 1, 0, 0);
      jg.filter = "blur(16px)";
      jg.strokeStyle = `rgba(255,242,215,${0.85 * (1 - ease.in2(d))})`;
      jg.lineWidth = 70;
      jg.beginPath();
      P.forEach(([x, y], i) => (i ? jg.lineTo(x, y) : jg.moveTo(x, y)));
      jg.closePath();
      jg.stroke();
      jg.restore();
      op(jc, ease.io2(prog(d, 0.15, 0.45)));
    } else {
      css(jc, "clipPath", "none");
      op(jc, 1);
    }
  }
  // ---------------- the page that rolls out of the roaster ----------------
  const rOn = t > T.unroll[0] && t < T.rollBack[1];
  show(rc, rOn);
  if (rOn) drawRoastLayer(t);
  // ---------------- phone ----------------
  const phOn = t > T.phoneIn[0] && t < T.push[1] + 0.05;
  show(phoneL, phOn);
  if (phOn) drawPhone(t);
  // ---------------- end card ----------------
  const eOn = t > T.endIn[0];
  show(endL, eOn);
  if (eOn) drawEnd(t);
  // ---------------- HUD ----------------
  drawHud(t);
  // grain moves every frame
  const f = Math.floor(t * 30);
  const r = rng(f * 7 + 1);
  css(grainC, "transform", `translate(${r1(-r() * 170)}px, ${r1(-r() * 110)}px)`);
}

// ---------- the plaque, and what the hand does to it ----------
function drawPlaque(t) {
  let text = "请勿触摸",
    sel = null,
    caretAt = -1;
  if (t >= T.drag[0] && t < 5.22) sel = [0, 4 * ease.io2(prog(t, T.drag[0], T.drag[1]))];
  if (t >= 5.22) {
    const n = T.types.filter((k) => t >= k).length;
    text = "请你动手".slice(0, n);
    caretAt = n;
  } else if (t >= T.dbl[1] && t < T.drag[0]) caretAt = 2;
  zhSpans.forEach((s, i) => {
    show(s, i < text.length);
    if (s.textContent !== (text[i] || "")) s.textContent = text[i] || "";
  });
  const N = text.length,
    left = PLQ.w / 2 - (N * CH) / 2;
  if (sel) {
    show(hlEl, true);
    css(hlEl, "left", r1(left + sel[0] * CH) + "px");
    css(hlEl, "width", r1((sel[1] - sel[0]) * CH) + "px");
  } else show(hlEl, false);
  zhSpans.forEach((s, i) => {
    const on = sel && i < sel[1] - 0.45;
    css(s, "color", on ? "#ffffff" : "");
    css(s, "textShadow", on ? "none" : "");
  });
  const typing = T.types.some((k) => t > k - 0.3 && t < k + 0.1);
  const caretOn = caretAt >= 0 && t < T.commit && (typing || (t * 1.8) % 1 < 0.55);
  show(caretEl, caretOn);
  if (caretOn) css(caretEl, "left", r1(left + caretAt * CH - 1) + "px");
  // the English follows, letters tumbling into the new words
  const m = prog(t, T.enMorph[0], T.enMorph[1]);
  let en = EN_FROM;
  if (m >= 1) en = EN_TO;
  else if (m > 0) {
    const r = rng(Math.floor(t * 30));
    const L = Math.round(lerp(EN_FROM.length, EN_TO.length, m));
    en = Array.from({ length: L }, (_, i) => (i / L < m - 0.15 ? EN_TO[i] ?? " " : "ABCDEFGHKLMNOPRSTUVWXYZ"[Math.floor(r() * 23)])).join("");
  }
  if (enEl.textContent !== en) enEl.textContent = en;
  // a glint runs over the brass when the change is made
  const g = prog(t, T.commit + 0.02, T.commit + 0.75);
  css(glint, "left", r1(lerp(-200, PLQ.w + 100, ease.io2(g))) + "px");
  op(glint, g > 0 && g < 1 ? 0.9 : 0);
  // and again, slower, at the very end
}

// ---------- light in the air ----------
const DUST = Array.from({ length: 90 }, (_, i) => {
  const r = rng(1000 + i);
  return { x: 600 + r() * 720, y: -500 + r() * 1300, s: 0.6 + r() * 1.8, sp: 0.2 + r() * 0.5, ph: r() * 10 };
});
const STEAM = Array.from({ length: 190 }, (_, i) => {
  const r = rng(2000 + i);
  return { ph: r(), dx: (r() - 0.5) * 130, sway: 20 + r() * 40, w: 0.6 + r() * 0.8, k: r() * 6 };
});
function drawAir(t, cam) {
  const g = ag;
  // the beam, from above the painting down onto it
  const beamA = 0.07 + 0.03 * ease.io2(prog(t, 7.45, 8.4));
  const top = project(cam, [960, -700]),
    lft = project(cam, [380, 760]),
    rgt = project(cam, [1540, 760]),
    tl = project(cam, [820, -700]),
    tr = project(cam, [1100, -700]);
  const gr = g.createLinearGradient(top[0], top[1], top[0], lft[1]);
  gr.addColorStop(0, `rgba(255,232,190,${beamA * 1.3})`);
  gr.addColorStop(1, "rgba(255,232,190,0)");
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(tl[0], tl[1]);
  g.lineTo(tr[0], tr[1]);
  g.lineTo(rgt[0], rgt[1]);
  g.lineTo(lft[0], lft[1]);
  g.closePath();
  g.save();
  g.filter = "blur(24px)";
  g.fill();
  g.restore();
  // dust turning slowly in it
  g.fillStyle = "rgba(255,236,200,0.55)";
  for (const d of DUST) {
    const x = d.x + Math.sin(t * d.sp + d.ph) * 30,
      y = ((d.y + t * 14 * d.sp + 500) % 1300) - 500;
    const [sx, sy] = project(cam, [x, y]);
    const inBeam = 1 - Math.abs(x - 960) / (220 + (y + 700) * 0.28);
    if (inBeam <= 0) continue;
    g.globalAlpha = inBeam * (0.4 + 0.6 * Math.abs(Math.sin(t * 0.7 + d.ph)));
    g.beginPath();
    g.arc(sx, sy, d.s * Math.min(3, cam.z), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  // steam rising from the painted cup, out past the frame into the room
  const s0 = T.steam;
  if (t > s0) {
    const L = 2.8;
    const grow = ease.io2(prog(t, s0, s0 + 1.0));
    for (const p of STEAM) {
      const age = t - s0 - p.ph * L;
      if (age < 0) continue;
      const a = (age % L) / L;
      const x = CUP_G[0] + p.dx * PS * (0.4 + a) + Math.sin(a * 3.2 + p.k + t * 0.4) * p.sway * a,
        y = CUP_G[1] - a * 640;
      const [sx, sy] = project(cam, [x, y]);
      const R = (6 + 40 * a) * p.w * cam.z;
      // fainter over the light paper, brighter where it rises into the dark
      const over = y < PAINT.y - 20 ? 1 : 0.55;
      const al = Math.sin(a * Math.PI) * 0.2 * over * grow * (1 - prog(t, T.dive[0], T.dive[0] + 0.5));
      if (al <= 0.002) continue;
      const rg2 = g.createRadialGradient(sx, sy, 0, sx, sy, R);
      rg2.addColorStop(0, `rgba(255,246,232,${al})`);
      rg2.addColorStop(1, "rgba(255,246,232,0)");
      g.fillStyle = rg2;
      g.fillRect(sx - R, sy - R, R * 2, R * 2);
    }
  }
}

// ---------- the scroll rolling itself up, and carried off ----------
function drawRolling(t, cam, jt) {
  const k = ease.io2(prog(t, T.rollUp[0], T.rollUp[1]));
  const R = 26 + 34 * k;
  const xr = lerp(SW, R, k);
  // the part still flat
  jg.save();
  camCtx(jg, cam);
  jg.beginPath();
  jg.rect(-200, -300, Math.max(0, xr - R * 0.8) + 200, SH + 600);
  jg.clip();
  jg.setTransform(1, 0, 0, 1, 0, 0);
  if (k < 0.995) drawJourney(jg, JART, cam, jt, { edges: true, fore: 0 });
  jg.restore();
  const base = project(cam, [xr, SH / 2]);
  const c1 = ease.io3(prog(t, T.carry[0], T.carry[0] + 0.7));
  const c2 = ease.in2(prog(t, T.carry[1] - 0.6, T.carry[1]));
  const mid = [960, 470];
  const target = [PH.x + PH.sx + PH.sw / 2, phoneTop(t) + PH.sy + PH.sh / 2];
  const sx = lerp(lerp(base[0], mid[0], c1), target[0], c2),
    sy = lerp(lerp(base[1], mid[1], c1), target[1], c2);
  const sc = lerp(logLerp(cam.z, 0.42, c1), 0.08, c2);
  const tilt = lerp(0, -Math.PI / 2, c1);
  const g = t < T.carry[0] ? jg : tgx;
  g.save();
  g.globalAlpha = 1 - prog(t, T.carry[1] - 0.12, T.carry[1]);
  g.translate(sx, sy);
  g.rotate(tilt);
  g.scale(sc, sc);
  drawRoll(g, R, k);
  g.restore();
  // a tag on a red cord names the file
  const tagA = ease.out3(prog(t, T.carry[0] + 0.35, T.carry[0] + 0.75)) * (1 - prog(t, T.carry[1] - 0.6, T.carry[1] - 0.35));
  if (tagA > 0.01) {
    const ex = sx + (SH / 2) * sc,
      ey = sy;
    g.save();
    g.globalAlpha = tagA;
    g.strokeStyle = "#b3392b";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(ex - 30, ey + 8);
    g.quadraticCurveTo(ex + 10, ey + 70, ex + 20, ey + 112);
    g.stroke();
    g.translate(ex - 120, ey + 112);
    g.rotate(0.05 - 0.04 * Math.sin(t * 2));
    g.shadowColor = "rgba(0,0,0,0.45)";
    g.shadowBlur = 22;
    g.shadowOffsetY = 8;
    g.fillStyle = "#f6efe0";
    g.fillRect(0, 0, 300, 112);
    g.shadowColor = "transparent";
    g.fillStyle = "#b3392b";
    g.beginPath();
    g.arc(140, 14, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#26180f";
    g.font = '600 30px "Bricolage Grotesque"';
    g.textAlign = "center";
    g.fillText("咖啡的来历.html", 150, 60);
    g.fillStyle = "rgba(38,24,15,0.6)";
    g.font = '400 19px "Noto Sans SC"';
    g.fillText("可交互网页 · 3 个场景 · 离线也能看", 150, 92);
    g.restore();
  }
}
function drawRoll(g, R, k) {
  // a rod with knobs, and the paper wound round it
  const h = SH;
  g.fillStyle = "#3a2515";
  g.fillRect(-R * 0.35, -h / 2 - 46, R * 0.7, h + 92);
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(0, s * (h / 2 + 52), R * 0.6, 18, 0, 0, Math.PI * 2);
    g.fill();
  }
  const gr = g.createLinearGradient(-R, 0, R, 0);
  gr.addColorStop(0, "#9a8a6e");
  gr.addColorStop(0.35, "#f1e7d2");
  gr.addColorStop(0.7, "#d8cbb0");
  gr.addColorStop(1, "#7d6c52");
  g.fillStyle = gr;
  g.fillRect(-R, -h / 2, R * 2, h);
  g.strokeStyle = "rgba(90,70,45,0.3)";
  g.lineWidth = 2;
  for (let i = 1; i < 6 * k + 1; i++) {
    const x = -R + (i / (6 * k + 1)) * R * 2;
    g.beginPath();
    g.moveTo(x, -h / 2);
    g.lineTo(x, h / 2);
    g.stroke();
  }
  if (k > 0.9) {
    g.fillStyle = "#b3392b";
    g.fillRect(-R - 2, -10, R * 2 + 4, 20);
  }
}

// ---------- the page of detail ----------
function drawRoastLayer(t) {
  const g = rg;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  const cam = journeyCam(t);
  const [dx, dy] = project(cam, [DOOR.x, DOOR.y]);
  const dr = DOOR.r * cam.z;
  let k = ease.io3(prog(t, T.unroll[0], T.unroll[1]));
  if (t > T.rollBack[0]) k = 1 - ease.io3(prog(t, T.rollBack[0], T.rollBack[1]));
  const s = lerp((dr * 2) / W, 1, k);
  const cx = lerp(dx, W / 2, k),
    cy = lerp(dy, H / 2, k);
  const pw = W * s,
    ph = H * s;
  const unrolled = clamp(k * 1.25);
  const visH = ph * unrolled;
  g.save();
  g.shadowColor = "rgba(0,0,0,0.55)";
  g.shadowBlur = 50 * s;
  g.shadowOffsetY = 20 * s;
  g.fillStyle = "#f3ead6";
  g.fillRect(cx - pw / 2, cy - ph / 2, pw, visH);
  g.restore();
  g.save();
  g.beginPath();
  g.rect(cx - pw / 2, cy - ph / 2, pw, visH);
  g.clip();
  g.setTransform(s, 0, 0, s, cx - pw / 2, cy - ph / 2);
  drawRoast(g, RART, t > T.rollBack[0] ? 9 : Math.max(0, t - T.R0));
  g.restore();
  // the roll still turning at the bottom edge
  if (unrolled < 1) {
    const ry = cy - ph / 2 + visH,
      rr = 22 * s + 6;
    const gr = g.createLinearGradient(0, ry - rr, 0, ry + rr);
    gr.addColorStop(0, "#8d7d62");
    gr.addColorStop(0.4, "#f3ead6");
    gr.addColorStop(1, "#7a6a50");
    g.fillStyle = gr;
    g.fillRect(cx - pw / 2 - 4, ry - rr, pw + 8, rr * 2);
  }
}

// ---------- the phone ----------
const phoneTop = (t) => lerp(1150, PH.y, ease.out3(prog(t, T.phoneIn[0], T.phoneIn[1])));
const COVER_IN_PHONE = { s: PH.sh / H, ox: (PH.sw - (W * PH.sh) / H) / 2 };
function drawPhone(t) {
  let tx = PH.x,
    ty = phoneTop(t),
    sc = 1;
  // pushing in until the painting on its screen fills the frame
  const p = ease.io3(prog(t, T.push[0], T.push[1]));
  if (p > 0) {
    const S = H / PH.sh;
    const tS = logLerp(1, S, p);
    // the cover's left edge on the phone, in stage pixels, must reach 0
    const fx = -(PH.sx + COVER_IN_PHONE.ox) * S,
      fy = -PH.sy * S;
    tx = lerp(PH.x, fx, ease.io3(p));
    ty = lerp(PH.y, fy, ease.io3(p));
    sc = tS;
    tx = lerp(PH.x, fx, (tS - 1) / (S - 1));
    ty = lerp(PH.y, fy, (tS - 1) / (S - 1));
  }
  css(phone, "transform", `translate(${r1(tx)}px, ${r1(ty)}px) scale(${r3(sc)})`);
  // the screen
  const g = pg;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#0b0a09";
  g.fillRect(0, 0, PH.sw, PH.sh);
  const on = ease.out3(prog(t, T.phoneOpen[0], T.phoneOpen[1]));
  if (on <= 0) return;
  g.globalAlpha = on;
  g.fillStyle = "#efe5d0";
  g.fillRect(0, 0, PH.sw, PH.sh);
  const s = COVER_IN_PHONE.s,
    ox = COVER_IN_PHONE.ox;
  // cover, with the dive into the bean and back
  const open = Math.max(0, ease.io3(prog(t, T.pOpen[0], T.pOpen[1])) - ease.io3(prog(t, T.pBack[0], T.pBack[1])));
  const zc = logLerp(1, 26, ease.in2(open));
  const hx = HERO.x,
    hy = HERO.y;
  const k = ease.out3(clamp(open * 1.6));
  const ccx = lerp(960, hx, k),
    ccy = lerp(540, hy, k);
  g.save();
  g.setTransform(s * zc, 0, 0, s * zc, ox + (W / 2 - ccx * zc) * s, (H / 2 - ccy * zc) * s);
  g.drawImage(COVER, 0, 0);
  g.translate(hx, hy);
  g.rotate(HERO.rot);
  g.drawImage(HEROART.whole, -HEROART.w / 2, -HEROART.h / 2, HEROART.w, HEROART.h);
  g.restore();
  if (open > 0.02) {
    // the lens
    const sxy = [ox + (W / 2 + (hx - ccx) * zc) * s, (H / 2 + (hy - ccy) * zc) * s];
    const hw = lerp(2, 900, ease.in3(open)),
      hl = Math.max(hw * 1.8, 60);
    g.save();
    g.translate(sxy[0], sxy[1]);
    g.rotate(HERO.rot);
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const u = -1 + (i / 40) * 2;
      g.lineTo(u * hl, -Math.pow(1 - u * u, 0.6) * hw);
    }
    for (let i = 40; i >= 0; i--) {
      const u = -1 + (i / 40) * 2;
      g.lineTo(u * hl, Math.pow(1 - u * u, 0.6) * hw);
    }
    g.closePath();
    g.rotate(-HERO.rot);
    g.translate(-sxy[0], -sxy[1]);
    g.clip();
    g.setTransform(1, 0, 0, 1, 0, 0);
    const jt = 2.4 + Math.max(0, t - T.pOpen[1]) * 1.5;
    drawJourney(g, JART, { cx: walkCam(jt), cy: 540, z: lerp(1.3, 1, ease.out3(open)) }, jt, { scale: s, dx: ox, fore: 0 });
    g.restore();
  }
  g.globalAlpha = 1;
}

// ---------- the last card ----------
function drawEnd(t) {
  op(endL, ease.io2(prog(t, T.endIn[0], T.endIn[1])));
  const g = eg;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  // a drop of coffee falls, and dries into the full stop
  const f = prog(t, T.drop - 0.32, T.drop);
  if (f > 0 && f < 1) {
    const y = lerp(-80, DOT.y, ease.in2(f));
    g.fillStyle = "#4a2a14";
    g.beginPath();
    g.ellipse(DOT.x, y, 9, 14, 0, 0, Math.PI * 2);
    g.fill();
  }
  const s = prog(t, T.drop, T.drop + 0.5);
  if (s > 0) {
    g.globalAlpha = clamp(s * 4);
    const sc = lerp(0.35, 1, ease.out3(s));
    g.drawImage(stain, DOT.x - 60 * sc, DOT.y - 60 * sc, 120 * sc, 120 * sc);
    g.globalAlpha = 1;
    // a crown of splash
    if (s < 1) {
      g.fillStyle = `rgba(74,42,20,${0.8 * (1 - s)})`;
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI * (0.1 + 0.8 * (i / 8));
        const d = 20 + 70 * ease.out3(s);
        g.beginPath();
        g.arc(DOT.x + Math.cos(a) * d, DOT.y + Math.sin(a) * d * 0.7 + 50 * s * s, 4 * (1 - s) + 1, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  brandChars.forEach((c, i) => {
    const p = ease.out3(prog(t, T.brand + i * 0.06, T.brand + 0.6 + i * 0.06));
    op(c, p);
    css(c, "transform", `translateY(${r1((1 - p) * 46)}px)`);
    css(c, "filter", p < 1 ? `blur(${r1((1 - p) * 10)}px)` : "none");
  });
}

// ---------- the HUD ----------
function drawHud(t) {
  // edit frame on the plaque
  if (t > T.dbl[1] - 0.02 && t < T.commit + 0.3) {
    const r = rectOf(galleryCam(t), 960 - 2 * CH - 12, ZH_CY - 31, 4 * CH + 24, 60);
    show(editBox, true);
    place(editBox, r.x, r.y, r.w, r.h);
    op(editBox, Math.min(ease.out3(prog(t, T.dbl[1] - 0.02, T.dbl[1] + 0.15)), 1 - prog(t, T.commit, T.commit + 0.25)));
  } else show(editBox, false);
  // selection on the scroll
  const selA = Math.min(ease.out3(prog(t, T.select, T.select + 0.25)), 1 - prog(t, T.toDoor[0], T.toDoor[0] + 0.25));
  if (selA > 0.01) {
    const cam = journeyCam(t);
    const r = rectOf(cam, ST[2] - 200, 196, 400, 734);
    const grow = 1 + 0.12 * (1 - ease.out3(prog(t, T.select, T.select + 0.3)));
    show(brackets, true);
    place(brackets, r.x - (r.w * (grow - 1)) / 2, r.y - (r.h * (grow - 1)) / 2, r.w * grow, r.h * grow);
    op(brackets, selA);
    show(selTag, true);
    place(selTag, r.x + r.w / 2 - 92, r.y - 60);
    op(selTag, selA);
  } else {
    show(brackets, false);
    show(selTag, false);
  }
  // the prompt
  const pA = Math.min(ease.out3(prog(t, T.prompt, T.prompt + 0.35)), 1 - prog(t, T.send + 0.1, T.send + 0.45));
  if (pA > 0.01) {
    show(promptEl, true);
    const fly = ease.in2(prog(t, T.send + 0.05, T.send + 0.45));
    const cam = journeyCam(t);
    const [tx, ty] = project(cam, [ST[2], 620]);
    css(promptEl, "transform", `translate(${r1((tx - 960) * fly)}px, ${r1((ty - 894) * fly + (1 - ease.out3(prog(t, T.prompt, T.prompt + 0.35))) * 40)}px) scale(${r3(1 - 0.85 * fly)})`);
    op(promptEl, pA);
    const n = keyTimes.filter((k) => t >= k).length;
    const txt = PROMPT.slice(0, n);
    if (pTyped.textContent !== txt) pTyped.textContent = txt;
    show(pPh, n === 0);
    op(pCaret, n > 0 && n < PROMPT.length ? 1 : (t % 1) < 0.55 ? 1 : 0);
    css(pSend, "transform", `scale(${r3(1 - 0.12 * press(t, T.send, 0.1))})`);
    op(pSend, n === PROMPT.length ? 1 : 0.35);
  } else show(promptEl, false);
  // the export chip
  const cA = Math.min(ease.out3(prog(t, T.chip, T.chip + 0.3)), 1 - prog(t, T.chipClick + 0.15, T.chipClick + 0.45));
  if (cA > 0.01) {
    show(exportChip, true);
    const w = exportChip.offsetWidth || 260;
    chipCenter = [960, 905];
    place(exportChip, 960 - w / 2, 905 - 22 + (1 - ease.out3(prog(t, T.chip, T.chip + 0.3))) * 20);
    op(exportChip, cA);
    css(exportChip, "transform", `scale(${r3(1 - 0.08 * press(t, T.chipClick, 0.1) + 0.1 * prog(t, T.chipClick, T.chipClick + 0.3))})`);
  } else show(exportChip, false);
  // subtitles
  SUBS.forEach((s) => {
    const on = t > s.t0 - 0.05 && t < s.t1 + 0.05;
    show(s.el, on);
    if (!on) return;
    op(s.el, 1 - ease.in2(prog(t, s.t1 - 0.45, s.t1)));
    s.chars.forEach((c, i) => {
      const p = ease.out3(prog(t, s.t0 + i * 0.04, s.t0 + i * 0.04 + 0.5));
      op(c, p);
      css(c, "transform", `translateY(${r1((1 - p) * 14)}px)`);
      css(c, "filter", p < 1 ? `blur(${r1((1 - p) * 5)}px)` : "none");
    });
  });
  // the hand
  let st = null;
  for (const R of ROUTES) st = route(t, R) || st;
  if (st) {
    show(st.ibeam ? ibeamEl : cursorEl, true);
    show(st.ibeam ? cursorEl : ibeamEl, false);
    const e = st.ibeam ? ibeamEl : cursorEl;
    css(e, "transform", `translate(${r1(st.x)}px, ${r1(st.y)}px) scale(${r3(1.4 - 0.18 * st.press)})`);
    op(e, st.alpha);
    if (st.ripple >= 0) {
      show(ringEl, true);
      const R = 10 + 46 * ease.out3(st.ripple);
      place(ringEl, st.x - R, st.y - R, R * 2, R * 2);
      op(ringEl, (1 - st.ripple) * st.alpha);
    } else show(ringEl, false);
  } else {
    show(cursorEl, false);
    show(ibeamEl, false);
    show(ringEl, false);
  }
  // a fingertip on the phone
  const tp = prog(t, T.tap - 0.15, T.tap + 0.35);
  if (tp > 0 && tp < 1) {
    show(touchEl, true);
    const sx = PH.x + PH.sx + COVER_IN_PHONE.ox + HERO.x * COVER_IN_PHONE.s,
      sy = PH.y + PH.sy + HERO.y * COVER_IN_PHONE.s;
    const R = 22 + 14 * ease.out3(prog(t, T.tap, T.tap + 0.35));
    place(touchEl, sx - R, sy - R, R * 2, R * 2);
    op(touchEl, Math.min(prog(t, T.tap - 0.15, T.tap - 0.05), 1 - prog(t, T.tap + 0.1, T.tap + 0.35)));
  } else show(touchEl, false);
}

// =====================================================================================
// Running
// =====================================================================================
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

// The works in 《请勿触摸》: a still life of a cup of coffee that hangs in a gallery, the
// journey a bean makes to the cup, and the roast that one step of it opens into. Each is a
// page that is a pure function of its own local time, and can be made again elsewhere (on
// the wall, on the canvas, on a phone) and stay in step.
import { svg, div, css, attr, clamp, lerp, prog, ease, random, handLine, pathOf, handStroke, handEllipse, Ink, Words, Sketcher, develop, cue, cueStroke } from "../src/lib.js";
import { makePage, place } from "../src/drawings.js";

const f1 = (n) => Math.round(n * 10) / 10;
const a2 = (n) => String(Math.round(clamp(n) * 100) / 100);
export const INK = "#3a352c";
const PEN = { stroke: INK, "stroke-width": 3 };
let uid = 0;

// ---------- the sketcher, with the score told about every stroke ----------
function kit(opts) {
  const S = new Sketcher();
  const T0 = opts.T0 ?? 0,
    cues = !!opts.cues;
  return {
    S,
    ink(parent, d, t0, t1, style = PEN, gain = 0.8, ez) {
      const k = new Ink(parent, d, t0, t1, style, ez);
      S.add(k);
      if (cues) cueStroke(T0 + t0, T0 + t1, gain);
      return k;
    },
    lay: (parent, d, t0, t1, style = PEN, ez) => new Ink(parent, d, t0, t1, style, ez),
    words(parent, text, x, y, t0, per, style = {}, gain = 0.5) {
      const w = new Words(parent, text, x, y, t0, per, style);
      S.add(w);
      if (cues) cueStroke(T0 + t0, T0 + w.t1, gain, "write");
      return w;
    },
    cue(t, type, more) {
      if (cues) cue(T0 + t, type, more);
    },
  };
}

// ---------- shapes a hand would paint ----------
function closed(P) {
  const n = P.length;
  let d = `M${f1(P[0][0])} ${f1(P[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n],
      p1 = P[i],
      p2 = P[(i + 1) % n],
      p3 = P[(i + 2) % n];
    d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d + "Z";
}
/** A closed, slightly uneven ellipse. */
export function blob(cx, cy, rx, ry, r, wob = 0.035, n = 14) {
  const ph = [r() * 6, r() * 6, r() * 6];
  const P = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + wob * (Math.sin(2 * a + ph[0]) + 0.6 * Math.sin(3 * a + ph[1]) + 0.4 * Math.sin(5 * a + ph[2]));
    P.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return closed(P);
}
const g = (parent, transform) => svg("g", transform ? { transform } : {}, parent);

/** A coffee bean at the origin, its long axis along x; `s` is half its length. */
export function bean(parent, s, fill, seed = 1, sw = 2.6) {
  const r = random(seed);
  const d = blob(0, 0, s, s * 0.74, r, 0.03, 12);
  svg("path", { d, fill }, parent);
  svg("path", { d: blob(s * 0.1, s * 0.14, s * 0.82, s * 0.6, r, 0.03, 12), fill: "#000", opacity: 0.13 }, parent);
  svg("ellipse", { cx: f1(-s * 0.34), cy: f1(-s * 0.36), rx: f1(s * 0.34), ry: f1(s * 0.13), fill: "#fff", opacity: 0.3, transform: `rotate(-14 ${f1(-s * 0.34)} ${f1(-s * 0.36)})` }, parent);
  const k = s * 0.17;
  svg("path", { d: `M${f1(-s * 0.8)} ${f1(k * 0.4)}C${f1(-s * 0.3)} ${f1(-k)} ${f1(s * 0.25)} ${f1(k * 1.3)} ${f1(s * 0.82)} ${f1(-k * 0.4)}`, fill: "none", stroke: "#2e1c10", "stroke-width": f1(Math.max(1.6, s * 0.11)), "stroke-linecap": "round", opacity: 0.85 }, parent);
  svg("path", { d, fill: "none", stroke: INK, "stroke-width": sw, "stroke-linejoin": "round" }, parent);
}
/** A ripe coffee cherry at the origin. */
export function cherry(parent, R, fill = "#c8402e", seed = 1) {
  const r = random(seed);
  const d = blob(0, 0, R, R * 0.95, r, 0.025, 12);
  svg("path", { d, fill }, parent);
  svg("path", { d: blob(R * 0.16, R * 0.18, R * 0.76, R * 0.72, r, 0.03, 12), fill: "#5e140c", opacity: 0.24 }, parent);
  svg("ellipse", { cx: f1(-R * 0.36), cy: f1(-R * 0.38), rx: f1(R * 0.26), ry: f1(R * 0.15), fill: "#fff", opacity: 0.5, transform: `rotate(-32 ${f1(-R * 0.36)} ${f1(-R * 0.38)})` }, parent);
  svg("circle", { cx: f1(R * 0.44), cy: f1(R * 0.46), r: f1(R * 0.12), fill: "#4a1a12" }, parent);
  svg("path", { d, fill: "none", stroke: INK, "stroke-width": 2.4 }, parent);
}
/** A leaf from the origin to (L, 0). */
export function leaf(parent, L, W, fill = "#6f8f4e") {
  const d = `M0 0C${f1(L * 0.25)} ${f1(-W)} ${f1(L * 0.7)} ${f1(-W * 0.92)} ${L} 0C${f1(L * 0.7)} ${f1(W * 0.86)} ${f1(L * 0.25)} ${f1(W * 0.96)} 0 0Z`;
  svg("path", { d, fill }, parent);
  svg("path", { d: `M0 0C${f1(L * 0.5)} ${f1(W * 0.42)} ${f1(L * 0.78)} ${f1(W * 0.3)} ${L} 0Z`, fill: "#000", opacity: 0.1 }, parent);
  let v = `M${f1(L * 0.04)} 0C${f1(L * 0.35)} ${f1(-W * 0.1)} ${f1(L * 0.65)} ${f1(-W * 0.06)} ${f1(L * 0.96)} 0`;
  for (let k = 1; k <= 3; k++) {
    const x = L * (0.18 + 0.2 * k);
    v += `M${f1(x)} ${f1(-W * 0.05)}Q${f1(x + L * 0.1)} ${f1(-W * 0.4)} ${f1(x + L * 0.2)} ${f1(-W * 0.62)}M${f1(x)} ${f1(-W * 0.02)}Q${f1(x + L * 0.1)} ${f1(W * 0.34)} ${f1(x + L * 0.2)} ${f1(W * 0.56)}`;
  }
  svg("path", { d: v, fill: "none", stroke: "#45612f", "stroke-width": 2, "stroke-linecap": "round", opacity: 0.85 }, parent);
  svg("path", { d, fill: "none", stroke: INK, "stroke-width": 2.4, "stroke-linejoin": "round" }, parent);
}
/** A tube: ink drawn wide, then the colour inside it. */
function tube(parent, d, w, fill, ink = 6) {
  svg("path", { d, fill: "none", stroke: INK, "stroke-width": w + ink, "stroke-linecap": "round", "stroke-linejoin": "round" }, parent);
  svg("path", { d, fill: "none", stroke: fill, "stroke-width": w, "stroke-linecap": "round", "stroke-linejoin": "round" }, parent);
}
function flame(parent, x, y, h) {
  const el = svg("path", { d: `M0 0C${f1(h * 0.42)} ${f1(-h * 0.3)} ${f1(h * 0.18)} ${f1(-h * 0.7)} 0 ${-h}C${f1(-h * 0.2)} ${f1(-h * 0.66)} ${f1(-h * 0.44)} ${f1(-h * 0.3)} 0 0Z`, fill: "#e9a93a", stroke: "#d0772c", "stroke-width": 2, style: `transform-box: fill-box; transform-origin: 50% 100%` }, parent);
  el.setAttribute("transform", `translate(${x} ${y})`);
  const wrap = svg("g", {}, parent);
  wrap.appendChild(el);
  return wrap;
}
/** An SVG drawn in page coordinates inside an HTML box, so it can develop like a photograph. */
function picture(parent, x, y, w, h) {
  const box = div("pic", parent);
  const s = svg("svg", { width: "100%", height: "100%", viewBox: `${x} ${y} ${w} ${h}`, style: "display:block;overflow:visible" }, box);
  return { box, s, cx: x + w / 2, cy: y + h / 2, w, h };
}
const sunMark = (parent, x, y, R, r) => {
  svg("path", { d: blob(x, y, R, R, r, 0.03, 12), fill: "#f0b54a", stroke: "#d0772c", "stroke-width": 2.6 }, parent);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.3;
    svg("path", { d: handStroke([x + Math.cos(a) * (R + 9), y + Math.sin(a) * (R + 9)], [x + Math.cos(a) * (R + 22), y + Math.sin(a) * (R + 22)], r, 1, 1), stroke: "#d0772c", "stroke-width": 3.4, "stroke-linecap": "round", fill: "none" }, parent);
  }
};

// =====================================================================================
// The still life: 一杯咖啡，从哪里来？ The hero bean is the way in.
// =====================================================================================
export const HERO = { x: 560, y: 770, r: 62 };
export function makeCover(parent, opts = {}) {
  const { page, back, imgs, front } = makePage(parent, opts.x ?? 0, opts.y ?? 0);
  const dots = div("page dotted", page, { left: 0, top: 0, backgroundColor: "transparent", opacity: 0 });
  page.insertBefore(dots, page.firstChild);
  const r = random(61);
  const id = ++uid;
  // a warm wash behind the cup, and shadows on the table
  svg("path", { d: blob(1230, 600, 430, 360, r, 0.05, 16), fill: "#f2e3c9", opacity: 0.55, filter: "url(#wash)" }, back);
  svg("path", { d: blob(1240, 852, 330, 30, r, 0.04), fill: "#5a4630", opacity: 0.1, filter: "url(#wash)" }, back);
  svg("path", { d: blob(560, 860, 330, 34, r, 0.05), fill: "#5a4630", opacity: 0.07, filter: "url(#wash)" }, back);

  // the title, in the painter's hand
  const title = g(front);
  const t1 = svg("text", { x: 196, y: 400, "font-size": 80, fill: INK }, title);
  t1.textContent = "一杯咖啡，";
  const t2 = svg("text", { x: 196, y: 496, "font-size": 80, fill: INK }, title);
  t2.textContent = "从哪里来？";
  svg("path", { d: pathOf(handLine([[300, 520], [420, 514], [560, 522]], r, 3, 10)), fill: "none", stroke: "#d97757", "stroke-width": 6, "stroke-linecap": "round", opacity: 0.85 }, title);

  // the branch, top right
  const branch = g(front);
  tube(branch, "M1900 150C1810 220 1720 290 1548 368", 8, "#7b5b3c", 5);
  for (const [x, y, ang, L, W] of [
    [1846, 196, 152, 132, 42],
    [1768, 248, 228, 120, 38],
    [1702, 292, 118, 144, 44],
    [1612, 336, 196, 124, 40],
    [1646, 322, 292, 104, 34],
  ])
    leaf(g(branch, `translate(${x} ${y}) rotate(${ang})`), L, W);
  [
    [1716, 316, 26, "#c8402e"],
    [1750, 330, 24, "#b83526"],
    [1726, 354, 25, "#d0543a"],
    [1694, 342, 22, "#c8402e"],
    [1574, 390, 23, "#c8402e"],
    [1602, 398, 21, "#b9a14a"],
    [1584, 420, 21, "#d0543a"],
  ].forEach(([x, y, R, c], k) => cherry(g(branch, `translate(${x} ${y})`), R, c, 7 + k));

  // the cup and saucer
  const cupG = g(front);
  svg("ellipse", { cx: 1220, cy: 812, rx: 300, ry: 64, fill: "#efe6d6", stroke: INK, "stroke-width": 2.8 }, cupG);
  svg("ellipse", { cx: 1220, cy: 806, rx: 190, ry: 38, fill: "#e2d4bd", stroke: INK, "stroke-width": 2, opacity: 0.9 }, cupG);
  tube(cupG, "M1404 548C1500 526 1522 640 1470 690C1440 720 1392 718 1362 700", 24, "#fbf6ec", 7);
  const BODY = "M1030 480C1032 650 1080 790 1160 806Q1220 814 1280 806C1360 790 1408 650 1410 480Z";
  const clip = svg("clipPath", { id: `cup${id}` }, cupG);
  svg("path", { d: BODY }, clip);
  svg("path", { d: BODY, fill: "#fbf6ec" }, cupG);
  const inside = g(cupG);
  inside.setAttribute("clip-path", `url(#cup${id})`);
  svg("path", { d: blob(1420, 640, 120, 220, r, 0.04), fill: "#e8dac4" }, inside);
  svg("path", { d: "M1000 600Q1220 652 1440 600L1440 642Q1220 694 1000 642Z", fill: "#d97757" }, inside);
  svg("path", { d: "M1000 664Q1220 716 1440 664", fill: "none", stroke: "#c15f3c", "stroke-width": 4 }, inside);
  svg("path", { d: blob(1064, 600, 14, 110, r, 0.05), fill: "#fff", opacity: 0.65 }, inside);
  svg("path", { d: BODY, fill: "none", stroke: INK, "stroke-width": 2.8, "stroke-linejoin": "round" }, cupG);
  svg("ellipse", { cx: 1220, cy: 480, rx: 190, ry: 46, fill: "#fbf6ec", stroke: INK, "stroke-width": 2.8 }, cupG);
  svg("ellipse", { cx: 1220, cy: 486, rx: 166, ry: 34, fill: "#5b3920" }, cupG);
  svg("ellipse", { cx: 1220, cy: 488, rx: 148, ry: 28, fill: "#9a6a3c", opacity: 0.85 }, cupG);
  svg("ellipse", { cx: 1226, cy: 491, rx: 112, ry: 19, fill: "#80522c", opacity: 0.55 }, cupG);
  svg("path", { d: "M0 30C-62 -8 -42 -62 0 -30C42 -62 62 -8 0 30Z", fill: "#efdcbf", transform: "translate(1220 490) scale(1 .3)" }, cupG);

  // steam, which keeps rising
  const grad = svg("linearGradient", { id: `steam${id}`, gradientUnits: "userSpaceOnUse", x1: 0, y1: 440, x2: 0, y2: 250 }, front);
  svg("stop", { offset: 0, "stop-color": "#b4ac9c", "stop-opacity": 0.75 }, grad);
  svg("stop", { offset: 1, "stop-color": "#b4ac9c", "stop-opacity": 0 }, grad);
  const steam = [1150, 1226, 1302].map((x) => svg("path", { fill: "none", stroke: `url(#steam${id})`, "stroke-width": 7, "stroke-linecap": "round" }, front));

  // beans on the table; the big one is the way in
  const BEANS = [
    [380, 828, 40, -32, "#6e4126"],
    [470, 690, 36, 68, "#83502c"],
    [300, 712, 33, 14, "#5f3820"],
    [712, 862, 42, -52, "#7a4a2a"],
    [806, 780, 31, 104, "#6e4126"],
    [916, 884, 29, 38, "#83502c"],
  ];
  BEANS.forEach(([x, y, s, rot, c], k) => bean(g(front, `translate(${x} ${y}) rotate(${rot})`), s, c, 30 + k));
  const pulse = svg("circle", { cx: HERO.x, cy: HERO.y, r: HERO.r, fill: "none", stroke: "#d97757", "stroke-width": 5, opacity: 0 }, front);
  const glow = svg("ellipse", { cx: HERO.x, cy: HERO.y, rx: HERO.r * 1.25, ry: HERO.r * 1.05, fill: "#e9a93a", opacity: 0, filter: "url(#wash)" }, front);
  const heroG = g(front);
  bean(g(heroG, "rotate(-24)"), HERO.r, "#7a4a2a", 3, 3);

  return {
    page,
    update(t, st = {}) {
      const alive = st.alive ?? 0;
      css(dots, "opacity", a2(st.dots ?? 0));
      steam.forEach((el, k) => {
        const x0 = [1150, 1226, 1302][k];
        const P = [];
        for (let y = 440; y >= 250; y -= 10) {
          const u = (440 - y) / 190;
          P.push([x0 + 22 * Math.sin((440 - y) / 38 + k * 1.9 - t * 1.7) * (0.35 + 0.65 * u), y]);
        }
        attr(el, "d", pathOf(P));
      });
      // the bean asks to be touched, once touching is allowed
      const beat = (t * 0.9) % 1;
      attr(pulse, "r", f1(HERO.r * (1.05 + 0.55 * ease.out(beat))));
      attr(pulse, "opacity", a2(alive * (1 - beat) * 0.7));
      attr(glow, "opacity", a2(alive * (0.16 + 0.06 * Math.sin(t * 3)) + (st.hover ?? 0) * 0.2));
      const bob = alive * Math.sin(t * 2.4) * 3;
      const sc = 1 + 0.06 * (st.hover ?? 0) - 0.05 * (st.press ?? 0);
      attr(heroG, "transform", `translate(${HERO.x} ${f1(HERO.y + bob)}) scale(${Math.round(sc * 1000) / 1000})`);
    },
  };
}

// =====================================================================================
// 咖啡的来历: four stations on a road, and a bean that walks it. Local 0 is the dive.
// =====================================================================================
export const STATIONS = [300, 740, 1180, 1620];
export const NODE_Y = 715;
export const DRUM = { x: 1170, y: 545, r: 58 };
export const STATION_BOX = { x: 1010, y: 360, w: 340, h: 520 };
const NAMES = [
  ["①", "果实", "红透了才采摘"],
  ["②", "处理", "去掉果肉，晒干"],
  ["③", "烘焙", "生豆炒成褐色"],
  ["④", "冲煮", "热水带出风味"],
];
export function makeJourney(parent, opts = {}) {
  const { page, back, imgs, front } = makePage(parent, opts.x ?? 0, opts.y ?? 0, { dotted: true });
  const r = random(23);
  const K = kit(opts);
  const replay = opts.replay ?? 0; // shift for a copy that only plays the walk
  // the road
  const pts = [[110, 724], [300, NODE_Y], [520, 742], [740, NODE_Y], [960, 742], [1180, NODE_Y], [1400, 742], [1620, NODE_Y], [1810, 724]];
  const roadD = pathOf(handLine(pts, r, 0, 12));
  const mask = svg("mask", { id: `road${++uid}`, maskUnits: "userSpaceOnUse", x: -100, y: -100, width: 2200, height: 1300 }, back);
  const reveal = new Ink(mask, roadD, 0.25, 2.2, { stroke: "#fff", "stroke-width": 30 }, ease.inOut2);
  const road = svg("path", { d: roadD, fill: "none", stroke: "#c9bfa9", "stroke-width": 5, "stroke-dasharray": "16 14", "stroke-linecap": "round", mask: `url(#road${uid})` }, back);
  // where each station sits along the road
  const L = road.getTotalLength();
  const nodeAt = STATIONS.map((x) => {
    let lo = 0,
      hi = L;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (road.getPointAtLength(m).x < x) lo = m;
      else hi = m;
    }
    return lo;
  });
  const nodes = STATIONS.map((x) => svg("circle", { cx: x, cy: NODE_Y, r: 13, fill: "#faf9f5", stroke: "#d97757", "stroke-width": 4, opacity: 0 }, back));
  K.cue(0.25, "road", { dur: 1.95 });

  // ---------- the four pictures ----------
  const pics = [];
  // ① the fruit
  {
    const P = picture(imgs, 130, 360, 340, 320);
    tube(P.s, "M150 660C220 600 300 520 452 392", 8, "#7b5b3c", 5);
    for (const [x, y, ang, Ln, W] of [[210, 612, 210, 112, 38], [262, 566, 300, 104, 34], [372, 470, 238, 118, 40], [404, 444, 330, 110, 36], [318, 520, 130, 96, 32]]) leaf(g(P.s, `translate(${x} ${y}) rotate(${ang})`), Ln, W);
    [[304, 548, 28, "#c8402e"], [338, 566, 26, "#b83526"], [312, 590, 27, "#d0543a"], [278, 578, 24, "#c8402e"], [348, 600, 22, "#c8402e"]].forEach(([x, y, R, c], k) => cherry(g(P.s, `translate(${x} ${y})`), R, c, 40 + k));
    pics.push(P);
  }
  // ② drying in the sun
  {
    const P = picture(imgs, 570, 360, 340, 320);
    sunMark(P.s, 820, 430, 34, r);
    for (const [x1, y1, x2, y2] of [[618, 598, 610, 672], [862, 598, 872, 672], [660, 610, 654, 662], [822, 610, 830, 662]]) svg("path", { d: handStroke([x1, y1], [x2, y2], r, 1, 1), stroke: INK, "stroke-width": 5, "stroke-linecap": "round" }, P.s);
    svg("path", { d: "M596 540L884 540L862 604L618 604Z", fill: "#d9c49a", stroke: INK, "stroke-width": 2.8, "stroke-linejoin": "round" }, P.s);
    svg("path", { d: "M604 548L876 548", stroke: "#b8a274", "stroke-width": 3 }, P.s);
    const rb = random(5);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 7; j++) {
        const x = 628 + j * 37 + (i % 2) * 14 + (rb() - 0.5) * 8,
          y = 556 + i * 12;
        bean(g(P.s, `translate(${f1(x)} ${f1(y)}) rotate(${f1((rb() - 0.5) * 70)})`), 11, i === 0 && j % 3 === 1 ? "#a36a3c" : "#c9c48e", 60 + i * 7 + j, 1.6);
      }
    pics.push(P);
  }
  // ③ the roaster
  const flames = [];
  {
    const P = picture(imgs, STATION_BOX.x + 20, 360, 300, 330);
    svg("rect", { x: 1230, y: 362, width: 22, height: 112, fill: "#8b887f", stroke: INK, "stroke-width": 2.6 }, P.s);
    svg("rect", { x: 1222, y: 352, width: 38, height: 16, rx: 4, fill: "#6f6c64", stroke: INK, "stroke-width": 2.4 }, P.s);
    svg("path", { d: "M1135 472L1118 404L1222 404L1205 472Z", fill: "#d8d0c0", stroke: INK, "stroke-width": 2.8, "stroke-linejoin": "round" }, P.s);
    [[1150, 406, 20], [1172, 400, -30], [1196, 406, 50]].forEach(([x, y, rot], k) => bean(g(P.s, `translate(${x} ${y}) rotate(${rot})`), 12, "#a9b46e", 80 + k, 1.6));
    for (const x of [1092, 1250]) svg("path", { d: `M${x} 640L${x - 4} 682`, stroke: INK, "stroke-width": 7, "stroke-linecap": "round" }, P.s);
    svg("rect", { x: 1072, y: 468, width: 196, height: 176, rx: 20, fill: "#c9694a", stroke: INK, "stroke-width": 2.8 }, P.s);
    svg("rect", { x: 1080, y: 600, width: 180, height: 36, rx: 10, fill: "#3a2c24", opacity: 0.85 }, P.s);
    svg("circle", { cx: DRUM.x, cy: DRUM.y, r: DRUM.r, fill: "#4a3a30", stroke: INK, "stroke-width": 2.8 }, P.s);
    svg("circle", { cx: DRUM.x, cy: DRUM.y, r: 44, fill: "none", stroke: "#8b887f", "stroke-width": 5 }, P.s);
    svg("circle", { cx: DRUM.x, cy: DRUM.y, r: 32, fill: "#8b5a34" }, P.s);
    const rb = random(9);
    for (let k = 0; k < 7; k++) bean(g(P.s, `translate(${f1(DRUM.x - 18 + rb() * 36)} ${f1(DRUM.y - 14 + rb() * 30)}) rotate(${f1(rb() * 180)})`), 8, "#5a341c", 90 + k, 1.2);
    svg("circle", { cx: DRUM.x - 10, cy: DRUM.y - 12, r: 9, fill: "#fff", opacity: 0.22 }, P.s);
    [1128, 1170, 1212].forEach((x) => flames.push(flame(P.s, x, 632, 26)));
    svg("ellipse", { cx: 1300, cy: 676, rx: 62, ry: 15, fill: "#b8b0a0", stroke: INK, "stroke-width": 2.4 }, P.s);
    [[1280, 668, 20], [1306, 664, -40], [1326, 672, 70], [1294, 678, 120]].forEach(([x, y, rot], k) => bean(g(P.s, `translate(${x} ${y}) rotate(${rot})`), 10, "#6b3f22", 100 + k, 1.4));
    pics.push(P);
  }
  // ④ the pour-over
  let stream, mugSteam;
  {
    const P = picture(imgs, 1440, 360, 340, 330);
    tube(P.s, "M1470 418C1446 420 1440 470 1468 478", 10, "#9c978c", 5);
    svg("path", { d: blob(1520, 440, 64, 46, r, 0.03), fill: "#a9a59b", stroke: INK, "stroke-width": 2.8 }, P.s);
    tube(P.s, "M1566 452C1592 470 1588 420 1610 412", 9, "#a9a59b", 5);
    svg("rect", { x: 1504, y: 384, width: 32, height: 14, rx: 6, fill: "#6f6c64", stroke: INK, "stroke-width": 2.2 }, P.s);
    stream = svg("path", { d: "M1612 414Q1628 456 1636 520", fill: "none", stroke: "#7aa7c0", "stroke-width": 4, "stroke-linecap": "round", "stroke-dasharray": "10 8" }, P.s);
    svg("path", { d: "M1574 522L1706 522L1666 590L1614 590Z", fill: "#efe4d0", stroke: INK, "stroke-width": 2.8, "stroke-linejoin": "round" }, P.s);
    svg("path", { d: "M1612 532L1630 584M1640 532L1640 584M1668 532L1650 584", stroke: "#c9bfa9", "stroke-width": 2.4 }, P.s);
    tube(P.s, "M1700 618C1744 612 1748 668 1702 666", 12, "#fbf6ec", 6);
    svg("path", { d: "M1580 596L1702 596L1694 680Q1640 692 1588 680Z", fill: "#fbf6ec", stroke: INK, "stroke-width": 2.8, "stroke-linejoin": "round" }, P.s);
    svg("path", { d: "M1583 620L1699 620L1697 640L1585 640Z", fill: "#d97757" }, P.s);
    svg("ellipse", { cx: 1641, cy: 597, rx: 60, ry: 9, fill: "#5b3920", stroke: INK, "stroke-width": 2.2 }, P.s);
    mugSteam = svg("path", { fill: "none", stroke: "#b4ac9c", "stroke-width": 4, "stroke-linecap": "round", opacity: 0.6 }, P.s);
    pics.push(P);
  }
  // names under the road
  const labels = NAMES.map(([n, name, sub], i) => {
    const el = g(front);
    const a = svg("text", { x: STATIONS[i], y: 812, "text-anchor": "middle", "font-size": 46, fill: INK }, el);
    a.innerHTML = `<tspan fill="#c15f3c">${n}</tspan> ${name}`;
    const b = svg("text", { x: STATIONS[i], y: 862, "text-anchor": "middle", "font-size": 29, fill: "#8b887f" }, el);
    b.textContent = sub;
    return el;
  });
  NAMES.forEach((_, i) => {
    K.cue(0.45 + i * 0.42, "develop", { n: i });
  });

  // ---------- the bean that walks the road ----------
  const tokG = g(front);
  const tokShadow = svg("ellipse", { rx: 16, ry: 5, fill: "#3a2a10", opacity: 0.12 }, front);
  front.insertBefore(tokShadow, tokG);
  const tokBody = svg("ellipse", { cx: 0, cy: 0, fill: "#c8402e", stroke: INK, "stroke-width": 2.6 }, tokG);
  const tokCrease = svg("path", { d: "M-15 2C-6 -5 5 6 15 -2", fill: "none", stroke: "#2e1c10", "stroke-width": 2.6, "stroke-linecap": "round" }, tokG);
  const tokShine = svg("ellipse", { cx: -6, cy: -8, rx: 6, ry: 3.5, fill: "#fff", opacity: 0.45 }, tokG);
  const splash = svg("g", { stroke: "#8a5a32", "stroke-width": 3, "stroke-linecap": "round", fill: "none" }, front);
  const splashL = [0, 1, 2, 3, 4].map(() => svg("path", {}, splash));
  const MOVES = [
    [3.2, 4.3],
    [4.65, 5.75],
    [6.1, 7.2],
  ];
  const LEAP = [7.45, 7.95];
  const COLORS = ["#c8402e", "#bfc589", "#6b3f22", "#6b3f22"];
  MOVES.forEach(([a, b], i) => {
    K.cue(a - 0.05, "step", { dur: b - a });
    K.cue(b, "arrive", { k: i + 1 });
  });
  K.cue(2.9, "arrive", { k: 0 });
  K.cue(LEAP[0], "hop");
  K.cue(LEAP[1], "drip");
  const mix = (c1, c2, k) => {
    const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const A = p(c1),
      B = p(c2);
    return "#" + A.map((v, i) => Math.round(lerp(v, B[i], k)).toString(16).padStart(2, "0")).join("");
  };

  return {
    page,
    pics,
    update(t0) {
      const t = t0 + replay;
      reveal.update(t);
      nodes.forEach((n, i) => {
        const p = ease.back(prog(t, 0.45 + i * 0.42, 0.75 + i * 0.42));
        attr(n, "opacity", a2(p));
        attr(n, "r", f1(13 * Math.max(0, p)));
      });
      // arrivals make a station hop
      const hop = (i) => {
        const at = i === 0 ? 2.9 : MOVES[i - 1]?.[1] ?? LEAP[1];
        const tt = i === 3 ? LEAP[1] : at;
        const u = prog(t, tt, tt + 0.45);
        return u > 0 && u < 1 ? Math.sin(u * Math.PI) * (1 - u) : 0;
      };
      pics.forEach((P, i) => {
        place(P.box, P.cx, P.cy, P.w, P.h, 0, 1 + 0.06 * hop(i) + 0.04 * (1 - ease.out(prog(t, 0.4 + i * 0.42, 1.2 + i * 0.42))));
        develop(P.box, prog(t, 0.35 + i * 0.42, 1.05 + i * 0.42));
      });
      labels.forEach((el, i) => {
        const p = ease.out(prog(t, 0.7 + i * 0.42, 1.2 + i * 0.42));
        attr(el, "opacity", a2(p));
        attr(el, "transform", `translate(0 ${f1((1 - p) * 18)})`);
      });
      flames.forEach((fl, k) => {
        const s = 1 + 0.12 * Math.sin(t * 11 + k * 2) + 0.06 * Math.sin(t * 7.3 + k);
        attr(fl, "transform", `translate(${[1128, 1170, 1212][k]} 632) scale(${f1((2 - s) * 100) / 100} ${f1(s * 100) / 100}) translate(${-[1128, 1170, 1212][k]} -632)`);
      });
      css(stream, "strokeDashoffset", String(f1(-t * 40)));
      {
        const P = [];
        for (let y = 584; y >= 520; y -= 8) P.push([1640 + 7 * Math.sin((584 - y) / 14 - t * 2.4), y]);
        attr(mugSteam, "d", pathOf(P));
      }
      // the walker
      const on = prog(t, 2.75, 3.0);
      let at = nodeAt[0],
        seg = -1,
        u = 0;
      MOVES.forEach(([a, b], i) => {
        if (t >= a) {
          seg = i;
          u = ease.inOut2(prog(t, a, b));
          at = lerp(nodeAt[i], nodeAt[i + 1], u);
        }
      });
      const color = seg < 0 ? COLORS[0] : mix(COLORS[seg], COLORS[seg + 1], ease.inOut2(prog(u, 0.25, 0.85)));
      const shape = seg < 0 ? 0 : clamp(seg + ease.inOut2(prog(u, 0.2, 0.8)), 0, 1); // 0 cherry, 1 bean
      const q = road.getPointAtLength(at);
      const q2 = road.getPointAtLength(Math.min(L, at + 4));
      const walking = MOVES.some(([a, b]) => t > a && t < b);
      const bob = walking ? Math.abs(Math.sin(t * 14)) * 9 : 0;
      let x = q.x,
        y = q.y - 22 - bob,
        sc = ease.back(on),
        rot = (Math.atan2(q2.y - q.y, q2.x - q.x) * 180) / Math.PI;
      // and at the end it hops into the cup
      const lu = prog(t, LEAP[0], LEAP[1]);
      if (lu > 0) {
        const ex = 1640,
          ey = 524;
        x = lerp(q.x, ex, lu);
        y = lerp(q.y - 22, ey, lu) - Math.sin(lu * Math.PI) * 120;
        sc = lerp(1, 0.5, ease.in2(lu));
        rot += lu * 300;
      }
      const gone = lu >= 1;
      attr(tokG, "opacity", a2(gone ? 0 : on));
      attr(tokG, "transform", `translate(${f1(x)} ${f1(y)}) rotate(${f1(rot)}) scale(${Math.round(sc * 1000) / 1000})`);
      attr(tokBody, "rx", f1(lerp(19, 20, shape)));
      attr(tokBody, "ry", f1(lerp(19, 14.5, shape)));
      attr(tokBody, "fill", color);
      attr(tokCrease, "opacity", a2(shape));
      attr(tokShine, "opacity", a2(0.45 - 0.2 * shape));
      attr(tokShadow, "cx", f1(lu > 0 ? x : q.x));
      attr(tokShadow, "cy", f1(lu > 0 ? lerp(q.y + 2, 592, lu) : q.y + 2));
      attr(tokShadow, "opacity", a2(on * (gone ? 0 : 0.12)));
      // a splash where it lands
      const su = prog(t, LEAP[1], LEAP[1] + 0.6);
      splashL.forEach((el, k) => {
        const a = -Math.PI / 2 + (k - 2) * 0.5;
        const r0 = 10 + 30 * ease.out(su),
          r1 = r0 + 14 * (1 - su);
        attr(el, "d", `M${f1(1640 + Math.cos(a) * r0)} ${f1(518 + Math.sin(a) * r0)}L${f1(1640 + Math.cos(a) * r1)} ${f1(518 + Math.sin(a) * r1)}`);
      });
      attr(splash, "opacity", a2(su > 0 && su < 1 ? 1 - su : 0));
    },
  };
}

// =====================================================================================
// 烘焙: a roast curve, its stages, and how the moment it stops decides the taste. The
// author draws it after the request. Local 0 = when the dive begins to land.
// =====================================================================================
const X = (m) => 260 + (m / 12.5) * 1000;
const Y = (T) => 840 - ((T - 20) / 215) * 520;
export const ROAST_CURVE = [[0, 25], [1, 70], [2, 100], [3, 122], [4, 140], [5, 154], [5.6, 160], [6.5, 172], [7.5, 185], [8.5, 196], [9.5, 204], [10.5, 212], [11.5, 219], [12.5, 225]];
export function makeRoast(parent, opts = {}) {
  const { page, back, imgs, front } = makePage(parent, opts.x ?? 0, opts.y ?? 0, { dotted: true });
  const r = random(88);
  const K = kit(opts);
  const id = ++uid;
  const done = opts.done ?? false;

  // stages, washed in behind the chart
  const BANDS = [
    [0, 5.6, "#e4ead0", "脱水"],
    [5.6, 8.5, "#f5e6bd", "梅纳反应"],
    [8.5, 12.5, "#eed6c0", "发展"],
  ];
  const bands = BANDS.map(([a, b, c]) => svg("rect", { x: X(a), y: 320, width: X(b) - X(a), height: 520, fill: c, opacity: 0 }, back));
  const seps = [5.6, 8.5].map((m) => K.lay(back, `M${X(m)} 838L${X(m)} 326`, 1.15, 1.45, { stroke: "#c9bfa9", "stroke-width": 2.5, "stroke-dasharray": "10 9" }));
  const ticks = g(back);
  [100, 150, 200].forEach((T) => {
    svg("path", { d: `M248 ${f1(Y(T))}L272 ${f1(Y(T))}`, stroke: INK, "stroke-width": 2.6 }, ticks);
    const tx = svg("text", { x: 236, y: f1(Y(T) + 8), "text-anchor": "end", "font-size": 24, fill: "#8b887f", style: "font-family:'Noto Sans SC',sans-serif" }, ticks);
    tx.textContent = T + "°C";
  });

  // axes
  K.ink(front, handStroke([260, 846], [260, 312], r, 2, 2), 0.3, 0.62, PEN, 0.7);
  K.ink(front, handStroke([248, 324], [260, 300], r, 0.5, 0.5), 0.63, 0.68, PEN, 0.3);
  K.ink(front, handStroke([272, 324], [260, 300], r, 0.5, 0.5), 0.69, 0.74, PEN, 0.3);
  K.ink(front, handStroke([254, 840], [1292, 840], r, 3, 2), 0.78, 1.12, PEN, 0.7);
  K.ink(front, handStroke([1268, 828], [1294, 840], r, 0.5, 0.5), 1.13, 1.18, PEN, 0.3);
  K.ink(front, handStroke([1268, 852], [1294, 840], r, 0.5, 0.5), 1.19, 1.24, PEN, 0.3);
  K.words(front, "豆温", 280, 312, 0.74, 0.06, { "font-size": 30, fill: INK }, 0.4);
  K.words(front, "时间", 1228, 892, 1.26, 0.06, { "font-size": 30, fill: INK }, 0.4);
  BANDS.forEach(([a, b, , name], i) => K.words(front, name, (X(a) + X(b)) / 2 - (name.length * 28) / 2, 818, 1.45 + i * 0.22, 0.045, { "font-size": 28, fill: "#8b7f68" }, 0.3));

  // the curve, coloured as the beans are
  const grad = svg("linearGradient", { id: `roast${id}`, gradientUnits: "userSpaceOnUse", x1: 260, y1: 0, x2: 1260, y2: 0 }, back);
  [[0, "#8ea35a"], [0.42, "#d6b04a"], [0.66, "#b0703a"], [1, "#4f2e18"]].forEach(([o, c]) => svg("stop", { offset: o, "stop-color": c }, grad));
  const fill = svg("linearGradient", { id: `roastf${id}`, gradientUnits: "userSpaceOnUse", x1: 0, y1: 330, x2: 0, y2: 840 }, back);
  [[0, "#c98a4a", 0.28], [1, "#c98a4a", 0]].forEach(([o, c, a]) => svg("stop", { offset: o, "stop-color": c, "stop-opacity": a }, fill));
  const pts = ROAST_CURVE.map(([m, T]) => [X(m), Y(T)]);
  const curveD = pathOf(handLine(pts, r, 0, 10));
  const area = svg("path", { d: curveD + `L${X(12.5)} 840L${X(0)} 840Z`, fill: `url(#roastf${id})`, opacity: 0 }, back);
  K.ink(front, curveD, 2.0, 3.15, { stroke: `url(#roast${id})`, "stroke-width": 8 }, 1.1, ease.inOut2);

  // what happens along it
  const marks = [];
  const mark = (m, T, color, s, t0, rot = -20) => {
    const P = picture(imgs, X(m) - 40, Y(T) - 40, 80, 80);
    bean(g(P.s, `translate(${X(m)} ${Y(T)}) rotate(${rot})`), s, color, 200 + marks.length, 2.4);
    marks.push({ P, t0 });
    K.cue(t0, "develop", { n: marks.length });
  };
  const leader = (a, b, t0, color = "#b8ab90") => K.lay(front, handStroke(a, b, r, 2, 0), t0, t0 + 0.2, { stroke: color, "stroke-width": 2.4, "stroke-dasharray": "6 7" });
  const leaders = [];
  mark(0.55, 48, "#a3b46a", 22, 2.15);
  leaders.push(leader([X(0.55) + 4, Y(48) - 26], [318, 578], 2.25));
  K.words(front, "生豆 · 青草味", 286, 560, 2.32, 0.05, { "font-size": 32, fill: INK }, 0.4);
  mark(5.6, 160, "#d8b45c", 22, 2.62);
  leaders.push(leader([X(5.6) - 10, Y(160) - 26], [640, 444], 2.7));
  K.words(front, "转黄 · 面包香", 512, 412, 2.78, 0.05, { "font-size": 32, fill: INK }, 0.4);
  K.words(front, "约 160°C", 512, 446, 3.1, 0.04, { "font-size": 24, fill: "#8b887f" }, 0.2);
  // first crack: a burst
  const CX = X(8.5),
    CY = Y(196);
  const burst = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    burst.push(K.ink(front, handStroke([CX + Math.cos(a) * 22, CY + Math.sin(a) * 22], [CX + Math.cos(a) * 42, CY + Math.sin(a) * 42], r, 1, 1), 3.2 + k * 0.03, 3.23 + k * 0.03, { stroke: "#d0772c", "stroke-width": 4 }, 0.3));
  }
  const crackDot = svg("circle", { cx: CX, cy: CY, r: 9, fill: "#d0772c", opacity: 0 }, front);
  K.cue(3.2, "crack");
  K.words(front, "一爆 · 噼啪作响", 808, 324, 3.48, 0.05, { "font-size": 32, fill: INK }, 0.4);
  K.words(front, "约 196°C", 808, 358, 3.86, 0.04, { "font-size": 24, fill: "#8b887f" }, 0.2);

  // the right column: when it comes out decides the cup
  K.words(front, "出锅越晚，颜色越深", 1384, 382, 4.0, 0.045, { "font-size": 34, fill: INK }, 0.4);
  const ROWS = [
    [12.5, 225, "深烘 · 约 225°C", "可可、烟熏", "#3f2616", 480],
    [11.1, 215, "中烘 · 约 215°C", "焦糖、坚果", "#7a4a2a", 620],
    [9.7, 205, "浅烘 · 约 205°C", "花香、果酸", "#a8703e", 760],
  ];
  const dots = [];
  ROWS.forEach(([m, T, name, taste, color, y], i) => {
    const t0 = 4.4 + i * 0.42;
    dots.push({ el: svg("circle", { cx: f1(X(m)), cy: f1(Y(T) + 2), r: 8, fill: color, stroke: INK, "stroke-width": 2.4, opacity: 0 }, front), t0 });
    leaders.push(leader([X(m) + 8, Y(T) + 10], [1384, y - 6], t0, color));
    const P = picture(imgs, 1390, y - 40, 80, 80);
    bean(g(P.s, `translate(1430 ${y}) rotate(-24)`), 34, color, 300 + i, 2.6);
    marks.push({ P, t0: t0 + 0.08 });
    K.cue(t0 + 0.08, "develop", { n: 5 + i });
    K.words(front, name, 1488, y - 4, t0 + 0.12, 0.035, { "font-size": 32, fill: INK }, 0.35);
    K.words(front, taste, 1488, y + 38, t0 + 0.32, 0.05, { "font-size": 30, fill: "#c15f3c" }, 0.3);
  });

  return {
    page,
    sketcher: K.S,
    update(t0) {
      const t = done ? 99 : t0;
      bands.forEach((b, i) => attr(b, "opacity", a2(ease.out(prog(t, 1.05 + i * 0.12, 1.6 + i * 0.12)) * 0.75)));
      seps.forEach((s) => s.update(t));
      attr(ticks, "opacity", a2(prog(t, 0.6, 1.0)));
      K.S.update(t);
      attr(area, "opacity", a2(prog(t, 2.9, 3.6)));
      leaders.forEach((l) => l.update(t));
      marks.forEach(({ P, t0: m0 }) => {
        place(P.box, P.cx, P.cy, P.w, P.h, 0, ease.back(prog(t, m0, m0 + 0.4)));
        develop(P.box, prog(t, m0, m0 + 0.8));
      });
      dots.forEach(({ el, t0: d0 }) => attr(el, "opacity", a2(prog(t, d0 - 0.1, d0 + 0.1))));
      const cr = prog(t, 3.2, 3.7);
      attr(crackDot, "opacity", a2(cr > 0 ? 1 - cr * 0.4 : 0));
      attr(crackDot, "r", f1(9 + 6 * Math.sin(cr * Math.PI)));
    },
  };
}

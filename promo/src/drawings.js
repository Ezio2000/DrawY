// The works the film draws. Each is a page of paper that draws itself as a function of its
// own local time, and can be made again in its finished state for the mural.
import {
  svg, div, img, pic, asset, css, attr, show, clamp, lerp, prog, ease,
  random, handLine, pathOf, handStroke, handEllipse, handArrow, hatchCircle,
  Ink, Words, Sketcher, develop, cue, cueStroke,
} from "./lib.js";

const f1 = (n) => Math.round(n * 10) / 10;
const GRAPHITE = { stroke: "#4f4b43", "stroke-width": 2.4, opacity: 0.8, filter: "url(#graphite)" };
const INK = { stroke: "#3a352c", "stroke-width": 2.6 };

/** A sheet of paper with a layer under the pictures, the pictures, and a layer over them. */
export function makePage(parent, x = 0, y = 0, opts = {}) {
  const page = div("page" + (opts.dotted ? " dotted" : ""), parent, { left: x + "px", top: y + "px" });
  if (opts.bg) page.style.background = opts.bg;
  const back = svg("svg", { width: 1920, height: 1080, viewBox: "0 0 1920 1080" }, page);
  const imgs = div("imgs", page);
  const front = svg("svg", { width: 1920, height: 1080, viewBox: "0 0 1920 1080" }, page);
  return { page, back, imgs, front };
}

/** Places an image by its centre. */
export function place(el, cx, cy, w, h, rot = 0, scale = 1) {
  css(el, "left", f1(cx - w / 2) + "px");
  css(el, "top", f1(cy - h / 2) + "px");
  css(el, "width", f1(w) + "px");
  css(el, "height", f1(h) + "px");
  css(el, "transform", `rotate(${f1(rot)}deg) scale(${Math.round(scale * 1000) / 1000})`);
}

/** The sketcher, with the score told about every stroke and every picture. */
function kit(opts) {
  const S = new Sketcher();
  const T0 = opts.T0 ?? 0,
    cues = !!opts.cues;
  return {
    S,
    T0,
    ink(parent, d, t0, t1, style = INK, gain = 0.8, ez) {
      const k = new Ink(parent, d, t0, t1, style, ez);
      S.add(k);
      if (cues) cueStroke(T0 + t0, T0 + t1, gain);
      return k;
    },
    /** Ink that is not the pencil's: a fill or a clean line laid down behind it. */
    lay(parent, d, t0, t1, style = INK, ez) {
      return new Ink(parent, d, t0, t1, style, ez);
    },
    words(parent, text, x, y, t0, per, style = {}, gain = 0.5) {
      const w = new Words(parent, text, x, y, t0, per, style);
      S.add(w);
      if (cues) cueStroke(T0 + t0, T0 + w.t1, gain, "write");
      return w;
    },
    dev(t, n = 1) {
      if (cues) cue(T0 + t, "develop", { n });
    },
    cue(t, type, more) {
      if (cues) cue(T0 + t, type, more);
    },
    /** A task whose drawing moves with something: its point is offset by `at(t)`. */
    follow(task, at) {
      const wrapped = {
        t0: task.t0,
        t1: task.t1,
        update: (t) => task.update(t),
        point: (t) => {
          const p = task.point(t),
            o = at(t);
          return [p[0] + o[0], p[1] + o[1]];
        },
      };
      S.add(wrapped);
      return task;
    },
  };
}

let maskN = 0;
/** A dashed line that draws itself: dashes revealed along the path by a mask, so the
 * dashes are there from the first moment and can keep flowing once drawn. */
function dashed(K, parent, d, t0, t1, style, dash, gain = 0.5) {
  const id = "dash" + ++maskN;
  const mask = svg("mask", { id, maskUnits: "userSpaceOnUse", x: -4000, y: -4000, width: 12000, height: 12000 }, parent);
  const rev = K.ink(mask, d, t0, t1, { stroke: "#fff", "stroke-width": (style["stroke-width"] || 3) * 5 }, gain);
  const vis = svg("path", { d, fill: "none", "stroke-linecap": "round", ...style, "stroke-dasharray": dash, mask: `url(#${id})` }, parent);
  return {
    rev,
    vis,
    flow(t, speed) {
      css(vis, "strokeDashoffset", String(f1(-t * speed)));
    },
  };
}

/** A title along the top of a tile, with the highlighter under its key words. */
function tileTitle(parent, text, key) {
  const el = div("tile-title", parent);
  if (key && text.includes(key)) {
    const [a, b] = text.split(key);
    el.innerHTML = `${a}<b>${key}</b>${b}`;
  } else el.textContent = text;
  return el;
}
function titleIn(el, t, t0) {
  const p = ease.out(prog(t, t0, t0 + 0.5));
  css(el, "opacity", String(f1(p * 100) / 100));
  css(el, "transform", `translateY(${f1((1 - p) * 16)}px)`);
  const b = el.querySelector("b");
  if (b) css(b, "backgroundSize", `${f1(ease.inOut2(prog(t, t0 + 0.3, t0 + 0.8)) * 100)}% 100%`);
}

// =====================================================================================
// The solar system: brief on a note, a graphite sketch, pictures that develop, orbits.
// Local time 0 is when the note lands (10.8 s into the film).
// =====================================================================================
export function makeSolar(parent, opts = {}) {
  const K = kit(opts);
  const { page, back, imgs, front } = makePage(parent, opts.x ?? 0, opts.y ?? 0, { dotted: opts.dotted });
  const r = random(41);
  const C = [1120, 560];
  const BODIES = [
    { id: "rock", name: "水星", rx: 185, r: 13, ph: 200, w: 0.42 },
    { id: "sand", name: "金星", rx: 242, r: 17, ph: 318, w: 0.27, fx: "hue-rotate(28deg) saturate(0.75) brightness(1.08)" },
    { id: "earth", name: "地球", rx: 302, r: 22, ph: 40, w: 0.15 },
    { id: "sand", name: "火星", rx: 365, r: 16, ph: 152, w: 0.12, fx: "hue-rotate(-14deg) saturate(1.25)" },
    { id: "jupiter", name: "木星", rx: 442, r: 40, ph: 250, w: 0.085 },
    { id: "saturn", name: "土星", rx: 522, r: 30, ph: 14, w: 0.06 },
  ];
  const RY = 0.45;
  const MOVE = 9.7; // orbits begin to turn
  const freeze = opts.freeze ?? Infinity;
  const turn = (t) => {
    const s = Math.min(t, freeze) - MOVE;
    if (s <= 0) return 0;
    return s < 1.5 ? (s * s) / 3 : s - 0.75;
  };
  const earthR = (t) => 22 + 15 * ease.spring(prog(t, 14.1, 15.0));
  const bodyAt = (i, t) => {
    const b = BODIES[i];
    const th = (b.ph * Math.PI) / 180 + b.w * turn(t);
    return { x: C[0] + Math.cos(th) * b.rx, y: C[1] + Math.sin(th) * b.rx * RY, th };
  };
  const earthAt = (t) => bodyAt(2, t);

  // ---- the brief on its note ----
  const note = svg("g", {}, front);
  const NX = 110,
    NY = 300,
    NW = 400,
    NH = 330;
  svg("rect", { x: NX, y: NY, width: NW, height: NH, fill: "#fff6cf", filter: "url(#softShadow)" }, note);
  svg("rect", { x: NX + NW / 2 - 62, y: NY - 16, width: 124, height: 34, fill: "rgba(233,215,170,.8)", transform: `rotate(-4 ${NX + NW / 2} ${NY})` }, note);
  const rows = [
    ["主题", "太阳系怎样运转"],
    ["意图", "看懂行星绕日转"],
    ["受众", "好奇的你"],
    ["画风", "蜡笔童趣"],
  ];
  const noteWords = [];
  rows.forEach(([k, v], i) => {
    const w = K.words(note, `${k}｜${v}`, NX + 34, NY + 76 + i * 56, 0.55 + i * 0.3, 0.032, { "font-size": 30, fill: "#3a352c" }, 0.35);
    w.spans.slice(0, 2).forEach((s) => s.setAttribute("fill", "#c15f3c"));
    w.spans[2].setAttribute("fill", "#b8ab90");
    noteWords.push(w);
  });
  const quote = K.words(note, "“太阳系是如何运转的？”", NX + 34, NY + 298, 1.85, 0.018, { "font-size": 21, fill: "#9a8d72" }, 0.2);

  // ---- graphite sketch ----
  const sketch = svg("g", {}, front);
  const sunSketch = K.ink(sketch, handEllipse(C[0], C[1], 70, 70, r, { start: -2.2 }), 2.05, 2.4, GRAPHITE, 1);
  K.words(sketch, "太阳", C[0] - 26, C[1] + 122, 2.45, 0.07, { "font-size": 26, fill: "#5d594f", filter: "url(#graphite)" }, 0.5);
  const sketchNames = [];
  BODIES.forEach((b, i) => {
    const s0 = 2.7 + i * 0.5;
    K.ink(sketch, handEllipse(C[0], C[1], b.rx, b.rx * RY, r, { start: Math.PI * (0.7 + r() * 0.4), wobble: 0.018 }), s0, s0 + 0.34, { ...GRAPHITE, "stroke-width": 2 }, 1);
    const p = bodyAt(i, 0);
    const rr = b.id === "saturn" ? 26 : b.r;
    K.ink(sketch, handEllipse(p.x, p.y, rr, rr, r), s0 + 0.36, s0 + 0.46, GRAPHITE, 0.6);
    sketchNames.push(K.words(sketch, b.name, p.x + rr + 8, p.y + rr + 26, s0 + 0.48, 0.06, { "font-size": 24, fill: "#5d594f", filter: "url(#graphite)" }, 0.4));
  });
  hatchCircle(C[0], C[1], 68, r, 14).forEach((d, k) => K.ink(sketch, d, 5.75 + k * 0.045, 5.75 + k * 0.045 + 0.04, { ...GRAPHITE, "stroke-width": 1.8, opacity: 0.55 }, 0.7));

  // ---- the drawing proper ----
  const orbitInk = BODIES.map((b, i) => {
    const d = `M${C[0] + b.rx} ${C[1]} A${b.rx} ${b.rx * RY} 0 1 1 ${C[0] - b.rx} ${C[1]} A${b.rx} ${b.rx * RY} 0 1 1 ${C[0] + b.rx} ${C[1]}`;
    return K.ink(back, d, 6.85 + i * 0.3, 6.85 + i * 0.3 + 0.28, { stroke: "#c4bcaa", "stroke-width": 2.2 }, 0.45, ease.inOut2);
  });
  const sun = img(pic("sun"), imgs);
  const bodies = BODIES.map((b) => img(pic(b.id), imgs));
  const moon = img(pic("moon"), imgs);
  K.dev(6.7);
  BODIES.forEach((_, i) => K.dev(7.0 + i * 0.18));
  const labelG = BODIES.map(() => svg("g", {}, front));
  const labels = BODIES.map((b, i) => {
    const w = new Words(labelG[i], b.name, 0, 0, 8.75 + i * 0.16, 0.06, { "font-size": 27, fill: "#4a463e" });
    K.follow(w, (t) => labelOffset(i, t));
    K.cue(8.75 + i * 0.16, "write", { dur: 0.12, gain: 0.35 });
    return w;
  });
  const sunLabel = svg("text", { x: C[0], y: C[1] + 124, "text-anchor": "middle", "font-size": 28, fill: "#4a463e" }, front);
  sunLabel.textContent = "太阳";
  function labelOffset(i, t) {
    const p = bodyAt(i, t),
      b = BODIES[i];
    const rr = i === 2 ? earthR(t) : b.r;
    if (b.id === "saturn") return [p.x + 50, p.y + 44];
    return [p.x + rr + 6, p.y + rr + 24];
  }

  // ---- looking again: Earth is too small to read ----
  const fixG = svg("g", {}, front);
  const fixInk = new Ink(fixG, handEllipse(0, 0, 58, 50, random(8), { start: -2.4, over: 0.5 }), 13.1, 13.45, { stroke: "#d97757", "stroke-width": 3.4 });
  K.follow(fixInk, (t) => {
    const e = earthAt(t);
    return [e.x, e.y];
  });
  K.cue(13.1, "pencil", { dur: 0.35, gain: 0.7 });
  const fixNote = new Words(fixG, "太小了，看不清", 46, -62, 13.5, 0.05, { "font-size": 28, fill: "#c15f3c" });
  K.follow(fixNote, (t) => {
    const e = earthAt(t);
    return [e.x, e.y];
  });
  K.cue(13.5, "write", { dur: 0.35, gain: 0.4 });
  K.cue(14.1, "grow");
  K.dev(14.55);

  // ---- the title, on the mural only ----
  const title = opts.title ? tileTitle(page, "太阳系是如何运转的？", "运转") : null;

  return {
    page,
    earthAt,
    earthR,
    sketcher: K.S,
    update(t) {
      if (title) titleIn(title, t, 0);
      // note
      const n = ease.back(prog(t, 0, 0.5));
      attr(note, "transform", `translate(${NX + NW / 2} ${NY + NH / 2}) rotate(${f1(-2.5 + (1 - n) * 6)}) scale(${f1((1.12 - 0.12 * n) * 1000) / 1000}) translate(${-(NX + NW / 2)} ${-(NY + NH / 2)})`);
      attr(note, "opacity", String(f1(clamp(prog(t, 0, 0.25)) * 100) / 100));
      K.S.update(t);
      // the sketch gives way to the drawing
      attr(sketch, "opacity", String(f1((1 - ease.inOut2(prog(t, 8.3, 9.6))) * 100) / 100));
      // pictures
      place(sun, C[0], C[1], 172, 168);
      develop(sun, prog(t, 6.7, 7.8));
      css(sun, "zIndex", "10");
      BODIES.forEach((b, i) => {
        const p = bodyAt(i, t);
        const rr = i === 2 ? earthR(t) : b.r;
        const el = bodies[i];
        if (b.id === "saturn") place(el, p.x, p.y, rr * 3.9, rr * 2.28);
        else place(el, p.x, p.y, rr * 2.1, rr * 2.1);
        develop(el, prog(t, 7.0 + i * 0.18, 7.9 + i * 0.18), b.fx || "");
        css(el, "zIndex", Math.sin(p.th) < 0 ? "5" : "15");
        const [lx, ly] = labelOffset(i, t);
        attr(labelG[i], "transform", `translate(${f1(lx)} ${f1(ly)})`);
      });
      attr(sunLabel, "opacity", String(f1(prog(t, 8.6, 9.0) * 100) / 100));
      // the moon, once Earth is large enough to carry it
      const e = earthAt(t);
      const ma = 1.3 * Math.min(t, freeze) + 0.6;
      const mr = earthR(t) + 30;
      place(moon, e.x + Math.cos(ma) * mr, e.y + Math.sin(ma) * mr * 0.8, 24, 24);
      develop(moon, prog(t, 14.55, 15.2));
      css(moon, "zIndex", Math.sin(ma) < 0 ? "14" : "16");
      // the correction mark comes and goes, riding with Earth
      attr(fixG, "transform", `translate(${f1(e.x)} ${f1(e.y)})`);
      attr(fixG, "opacity", String(f1((1 - prog(t, 14.4, 14.8)) * 100) / 100));
    },
  };
}

// =====================================================================================
// Inside Earth: the water cycle. Local 0 = 29.2 s.
// =====================================================================================
export function makeWater(parent, opts = {}) {
  const K = kit(opts);
  const { page, back, imgs, front } = makePage(parent, opts.x ?? 0, opts.y ?? 0, { dotted: opts.dotted });
  const r = random(77);
  const GROUND = 790;
  // washes
  const ground = svg("path", { d: "M90 796 Q300 776 600 790 T1110 796 Q1170 830 1110 872 Q620 900 140 878 Q50 846 90 796 Z", fill: "#dcc79f", opacity: 0, filter: "url(#wash)" }, back);
  const sea = svg("path", { d: "M1150 806 Q1320 778 1520 792 T1860 790 Q1905 836 1850 884 Q1500 912 1190 890 Q1110 852 1150 806 Z", fill: "#8fbad0", opacity: 0, filter: "url(#wash)" }, back);
  const waves = [0, 1, 2].map((k) =>
    K.lay(back, pathOf(handLine([[1180 + k * 160, 830 + k * 18], [1240 + k * 160, 822 + k * 18], [1300 + k * 160, 832 + k * 18]], r, 3)), 1.0 + k * 0.08, 1.3 + k * 0.08, { stroke: "#5f8fa8", "stroke-width": 2.4 }),
  );
  const groundLine = K.lay(back, pathOf(handLine([[110, GROUND], [400, GROUND - 6], [800, GROUND + 4], [1110, GROUND - 2]], r, 3)), 0.6, 1.1, { stroke: "#8a7656", "stroke-width": 2.4 });

  const sun = img(pic("sun"), imgs);
  const mountain = img(pic("mountain"), imgs);
  const tree = img(pic("tree"), imgs);
  const cloud1 = img(pic("cloud"), imgs);
  const cloud2 = img(pic("cloud"), imgs);
  [0, 0.12, 0.24, 0.36, 0.48].forEach((d) => K.dev(d));

  // rain under the big cloud
  const rainG = svg("g", { stroke: "#6f9fbb", "stroke-width": 3, "stroke-linecap": "round" }, back);
  const drops = Array.from({ length: 22 }, (_, i) => ({ el: svg("line", {}, rainG), x: 700 + ((i * 53) % 330), ph: (i * 0.37) % 1 }));

  // arrows and words
  const accent = { stroke: "#c15f3c", "stroke-width": 3 };
  const evap = [1380, 1520, 1660].map((x, k) => {
    const pts = [];
    for (let y = 760; y >= 480; y -= 18) pts.push([x + Math.sin((760 - y) / 34 + k) * 12, y]);
    return dashed(K, front, pathOf(handLine(pts, r, 2, 10)), 1.35 + k * 0.16, 1.35 + k * 0.16 + 0.24, { stroke: "#5f8fa8", "stroke-width": 3.4 }, "12 12", 0.5);
  });
  const condense = handArrow([1350, 330], [1110, 330], r, 0.3, 20).map((d, k) => K.ink(front, d, 1.95 + k * 0.08, 1.95 + k * 0.08 + (k ? 0.06 : 0.28), accent, 0.6));
  const runoff = handArrow([560, 820], [1200, 845], r, -0.12, 20).map((d, k) => K.ink(front, d, 2.55 + k * 0.08, 2.55 + k * 0.08 + (k ? 0.06 : 0.32), accent, 0.6));
  const label = (txt, x, y, t0) => {
    const w = K.words(front, txt, x, y, t0, 0.05, { "font-size": 36, fill: "#3a352c" });
    w.spans[0].setAttribute("fill", "#c15f3c");
    return w;
  };
  label("① 蒸发", 1700, 620, 1.85);
  label("② 凝结", 1150, 420, 2.35);
  label("③ 降水", 500, 520, 2.45);
  label("④ 径流", 780, 905, 2.95);
  const title = opts.title ? tileTitle(page, "地球上的水循环", "水循环") : null;

  return {
    page,
    tree: [865, 540],
    sketcher: K.S,
    update(t) {
      if (title) titleIn(title, t, 0);
      attr(ground, "opacity", String(f1(prog(t, 0.2, 0.9) * 55) / 100));
      attr(sea, "opacity", String(f1(prog(t, 0.4, 1.1) * 60) / 100));
      waves.forEach((w) => w.update(t));
      groundLine.update(t);
      place(sun, 240, 300, 170, 166, t * 6);
      develop(sun, prog(t, 0.36, 1.2));
      place(mountain, 360, GROUND - 165, 540, 330);
      develop(mountain, prog(t, 0, 0.9));
      place(tree, 865, GROUND - 168, 300, 335);
      develop(tree, prog(t, 0.12, 1.0));
      place(cloud1, 880 + Math.sin(t * 0.6) * 8, 340, 420, 238);
      develop(cloud1, prog(t, 0.24, 1.1));
      place(cloud2, 1520 + Math.sin(t * 0.5 + 1) * 10, 330, 320, 181);
      develop(cloud2, prog(t, 0.48, 1.3));
      // rain falls once it has begun
      const rainOn = prog(t, 2.2, 2.6);
      drops.forEach((d) => {
        const y = 440 + (((t * 1.1 + d.ph) % 1) * 190);
        attr(d.el, "x1", d.x - 4);
        attr(d.el, "x2", d.x - 10);
        attr(d.el, "y1", f1(y));
        attr(d.el, "y2", f1(y + 26));
        attr(d.el, "opacity", String(f1(rainOn * Math.sin(((y - 440) / 216) * Math.PI) * 90) / 100));
      });
      K.S.update(t);
      // evaporation keeps rising
      evap.forEach((e) => e.flow(t, 40));
    },
  };
}

// =====================================================================================
// Inside the tree: a leaf making sugar from light. Local 0 = 34.6 s.
// =====================================================================================
export function makeLeaf(parent, opts = {}) {
  const K = kit(opts);
  const { page, back, imgs, front } = makePage(parent, opts.x ?? 0, opts.y ?? 0, { dotted: opts.dotted });
  const r = random(19);
  const leaf = img(pic("leaf"), imgs);
  K.dev(0);
  // the sun, drawn by hand
  const SX = 300,
    SY = 250;
  const sunC = K.ink(front, handEllipse(SX, SY, 52, 52, r), 0.45, 0.7, { stroke: "#e08f2c", "stroke-width": 4, fill: "rgba(233,169,58,.18)" }, 0.6);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    K.ink(front, handStroke([SX + Math.cos(a) * 72, SY + Math.sin(a) * 72], [SX + Math.cos(a) * 100, SY + Math.sin(a) * 100], r, 1, 2), 0.72 + k * 0.035, 0.72 + k * 0.035 + 0.03, { stroke: "#e08f2c", "stroke-width": 4 }, 0.3);
  }
  const rays = [
    [[400, 320], [780, 470]],
    [[380, 350], [700, 560]],
    [[420, 300], [880, 420]],
  ].map(([a, b], k) => dashed(K, back, handStroke(a, b, r, 6, 2), 1.0 + k * 0.08, 1.0 + k * 0.08 + 0.2, { stroke: "#e9a93a", "stroke-width": 5 }, "16 14", 0.3));
  const accent = { stroke: "#3a352c", "stroke-width": 3 };
  const arrows = [
    { from: [250, 860], to: [640, 720], txt: "水 H₂O", tx: 150, ty: 930, t: 1.35 },
    { from: [170, 560], to: [560, 590], txt: "二氧化碳 CO₂", tx: 90, ty: 520, t: 1.75 },
    { from: [1330, 480], to: [1640, 310], txt: "氧气 O₂", tx: 1660, ty: 290, t: 2.15 },
    { from: [1370, 650], to: [1650, 700], txt: "葡萄糖", tx: 1640, ty: 800, t: 2.55 },
  ];
  arrows.forEach((a) => {
    handArrow(a.from, a.to, r, 0.12, 20).forEach((d, k) => K.ink(front, d, a.t + k * 0.06, a.t + k * 0.06 + (k ? 0.05 : 0.2), accent, 0.6));
    K.words(front, a.txt, a.tx, a.ty, a.t + 0.22, 0.04, { "font-size": 36, fill: "#3a352c" });
  });
  // bubbles of oxygen
  const bubbles = Array.from({ length: 6 }, (_, i) => ({ el: svg("circle", { r: 7 + (i % 3) * 3, fill: "none", stroke: "#6f9fbb", "stroke-width": 2.5 }, front), ph: i / 6 }));
  // a ring of sugar
  const hex = [];
  for (let k = 0; k <= 6; k++) hex.push([1745 + Math.cos((k / 6) * Math.PI * 2 + 0.52) * 38, 690 + Math.sin((k / 6) * Math.PI * 2 + 0.52) * 38]);
  K.ink(front, pathOf(handLine(hex, r, 2, 8)), 2.85, 3.1, { stroke: "#c15f3c", "stroke-width": 3 }, 0.5);
  const eq = K.words(front, "6CO₂ + 6H₂O  —光→  C₆H₁₂O₆ + 6O₂", 960, 898, 3.05, 0.022, { "font-size": 38, fill: "#3a352c", "text-anchor": "middle", style: "font-family:'Noto Serif SC',serif" }, 0.3);
  const title = opts.title ? tileTitle(page, "一片叶子里的光合作用", "光合作用") : null;
  return {
    page,
    sketcher: K.S,
    update(t) {
      if (title) titleIn(title, t, 0);
      place(leaf, 960, 560, 820, 525, -9 + Math.sin(t * 0.8) * 0.8);
      develop(leaf, prog(t, 0, 0.9));
      K.S.update(t);
      rays.forEach((ry) => ry.flow(t, 60));
      bubbles.forEach((b, i) => {
        const u = (t * 0.45 + b.ph) % 1;
        attr(b.el, "cx", f1(1480 + i * 22 + Math.sin(u * 9 + i) * 10));
        attr(b.el, "cy", f1(430 - u * 220));
        attr(b.el, "opacity", String(f1(prog(t, 2.4, 2.8) * Math.sin(u * Math.PI) * 100) / 100));
      });
    },
  };
}

// =====================================================================================
// One apple in seven styles, then all seven in a row. Local 0 = 40.0 s, a swap a beat.
// =====================================================================================
export const STYLES = [
  { id: "apple", zh: "彩铅", en: "Coloured pencil", glow: "rgba(230,120,90,.20)" },
  { id: "apple-crayon", zh: "蜡笔", en: "Crayon", glow: "rgba(240,90,70,.22)" },
  { id: "apple-flat", zh: "扁平", en: "Flat", glow: "rgba(240,150,150,.22)" },
  { id: "apple-ink-wash", zh: "水墨", en: "Ink wash", glow: "rgba(120,110,100,.18)" },
  { id: "apple-realistic", zh: "写实", en: "Realistic", glow: "rgba(170,60,40,.22)" },
  { id: "apple-textbook", zh: "教科书", en: "Textbook", glow: "rgba(120,170,210,.22)" },
  { id: "apple-watercolor", zh: "水彩", en: "Watercolour", glow: "rgba(250,170,120,.24)" },
];
export function makeApples(parent, opts = {}) {
  const K = kit(opts);
  const { page, back, imgs, front } = makePage(parent, opts.x ?? 0, opts.y ?? 0);
  const B = 0.625;
  const glow = div("", imgs, { position: "absolute", left: "560px", top: "175px", width: "800px", height: "800px", borderRadius: "50%" });
  const apples = STYLES.map((s) => img(pic(s.id), imgs));
  const names = STYLES.map((s) => {
    const el = div("", page, { position: "absolute", left: "0", top: "0", fontFamily: "var(--hand)", fontSize: "76px", color: "#141413", whiteSpace: "nowrap", textAlign: "center", width: "600px" });
    el.innerHTML = `${s.zh}<span style="font-family:'Instrument Serif',serif;font-style:italic;font-size:40px;color:#8b887f;margin-left:18px">${s.en}</span>`;
    return el;
  });
  STYLES.forEach((_, k) => K.cue(k * B, "swap", { k }));
  const ROW = 4.375;
  K.cue(ROW, "spread");
  const title = opts.title ? tileTitle(page, "同一个苹果，七种画法", "七种画法") : null;
  return {
    page,
    update(t) {
      if (title) titleIn(title, t, ROW + 0.2);
      const k = clamp(Math.floor(t / B), 0, STYLES.length - 1);
      const spread = ease.inOut(prog(t, ROW, ROW + 0.55));
      const local = Math.max(0, t - k * B);
      const pop = 1 + 0.07 * Math.exp(-local * 9) * Math.cos(local * 18);
      css(glow, "background", `radial-gradient(closest-side, ${STYLES[k].glow}, transparent)`);
      css(glow, "opacity", String(f1((1 - spread) * 100) / 100));
      apples.forEach((el, i) => {
        // big, one at a time
        const big = { x: 960, y: 575, s: 500 };
        const row = { x: 960 + (i - 3) * 252, y: 520, s: 214 };
        const x = lerp(big.x, row.x, spread),
          y = lerp(big.y, row.y, spread) + (spread > 0 ? Math.sin(spread * Math.PI) * -30 * ((i % 2) * 2 - 1) : 0),
          s = lerp(big.s, row.s, spread);
        const visible = spread > 0 ? (i === k ? 1 : spread) : i === k ? 1 : 0;
        const sc = spread > 0 ? 1 : pop;
        place(el, x, y, s, s, i === k ? (1 - spread) * Math.sin(local * 3) * 2 : 0, sc);
        css(el, "opacity", String(f1(clamp(visible) * 100) / 100));
        css(el, "filter", "drop-shadow(0 18px 24px rgba(60,45,20,.12))");
        // the names: one large under the apple, then small under each
        const nm = names[i];
        const ny = lerp(842, 650, spread);
        const fs = lerp(1, 0.46, spread);
        css(nm, "transform", `translate(${f1(x - 300)}px, ${f1(ny)}px) scale(${f1(fs * 100) / 100})`);
        const nameIn = i === k && spread === 0 ? ease.out(prog(local, 0, 0.2)) : spread;
        css(nm, "opacity", String(f1(clamp(spread > 0 ? Math.max(i === k ? 1 : 0, spread) : nameIn) * 100) / 100));
        css(nm.querySelector("span"), "display", spread > 0.4 ? "none" : "");
      });
    },
  };
}

// =====================================================================================
// A large language model, in duotone icons. Local 0 = 45.15 s.
// =====================================================================================
export function makeLLM(parent, opts = {}) {
  const K = kit(opts);
  const { page, back, imgs, front } = makePage(parent, opts.x ?? 0, opts.y ?? 0);
  const r = random(5);
  const title = tileTitle(page, "大语言模型是怎么工作的？", "怎么工作");
  const doc = img(asset("icon-document.svg"), imgs);
  const model = img(asset("icon-model.svg"), imgs);
  const chat = img(asset("icon-chat.svg"), imgs);
  K.dev(0.05);
  K.dev(0.3);
  K.dev(0.55);
  const tokens = ["太阳", "系", "是", "怎么", "转", "的"];
  let x = 470;
  const chips = tokens.map((tk, i) => {
    const w = 34 + tk.length * 34;
    const g = svg("g", {}, front);
    svg("rect", { x, y: 512, width: w, height: 60, rx: 14, fill: "#fff", stroke: i % 2 ? "#d8d4c8" : "#d97757", "stroke-width": 2.5 }, g);
    const tx = svg("text", { x: x + w / 2, y: 553, "text-anchor": "middle", "font-size": 32, fill: "#141413", style: "font-family:'Noto Sans SC',sans-serif" }, g);
    tx.textContent = tk;
    const c = { g, cx: x + w / 2, i };
    x += w + 12;
    return c;
  });
  const accent = { stroke: "#3a352c", "stroke-width": 3 };
  const arrows = [
    [[395, 545], [455, 545]],
    [[x + 6, 545], [1110, 545]],
    [[1390, 545], [1470, 545]],
  ];
  arrows.forEach(([a, b], k) => handArrow(a, b, r, 0.05, 16).forEach((d, j) => K.ink(front, d, 0.25 + k * 0.18 + j * 0.03, 0.25 + k * 0.18 + j * 0.03 + (j ? 0.03 : 0.12), accent, 0.5)));
  const bars = [
    ["转", 0.62],
    ["动", 0.21],
    ["行", 0.09],
  ].map(([w, v], i) => {
    const g = svg("g", {}, front);
    const tx = svg("text", { x: 1500, y: 668 + i * 62, "font-size": 34, fill: "#141413" }, g);
    tx.textContent = w;
    const bar = svg("rect", { x: 1550, y: 640 + i * 62, height: 34, rx: 8, width: 0, fill: i ? "#e4c4b5" : "#d97757" }, g);
    const pc = svg("text", { x: 1560, y: 668 + i * 62, "font-size": 26, fill: "#5e5d59", style: "font-family:'Noto Sans SC',sans-serif" }, g);
    pc.textContent = Math.round(v * 100) + "%";
    return { bar, pc, v, i };
  });
  K.words(front, "切成词元", chips[0].cx - 40, 650, 0.5, 0.04, { "font-size": 34, fill: "#5e5d59" });
  K.words(front, "注意力", 1195, 720, 0.62, 0.04, { "font-size": 34, fill: "#5e5d59" });
  K.words(front, "猜下一个词", 1500, 470, 0.74, 0.04, { "font-size": 34, fill: "#5e5d59" });
  return {
    page,
    sketcher: K.S,
    update(t) {
      titleIn(title, t, -0.1);
      place(doc, 300, 545, 170, 170);
      develop(doc, prog(t, 0.05, 0.5));
      place(model, 1250, 545, 260, 260);
      develop(model, prog(t, 0.3, 0.75));
      place(chat, 1600, 370, 150, 150);
      develop(chat, prog(t, 0.55, 0.95));
      chips.forEach((c) => {
        const p = ease.back(prog(t, 0.12 + c.i * 0.05, 0.4 + c.i * 0.05));
        attr(c.g, "transform", `translate(${c.cx} 542) scale(${f1(p * 100) / 100}) translate(${-c.cx} -542)`);
        attr(c.g, "opacity", String(f1(clamp(p) * 100) / 100));
      });
      bars.forEach((b) => {
        const p = ease.out(prog(t, 0.6 + b.i * 0.06, 1.0 + b.i * 0.06));
        attr(b.bar, "width", f1(b.v * 300 * p + 0.01));
        attr(b.pc, "x", f1(1560 + b.v * 300 * p));
        attr(b.pc, "opacity", String(f1(p * 100) / 100));
      });
      K.S.update(t);
    },
  };
}

// =====================================================================================
// The heart, with its vessels named. Local 0 = 46.4 s.
// =====================================================================================
export function makeHeart(parent, opts = {}) {
  const K = kit(opts);
  const { page, back, imgs, front } = makePage(parent, opts.x ?? 0, opts.y ?? 0);
  const r = random(23);
  const title = tileTitle(page, "心脏是怎样泵血的？", "泵血");
  const heart = img(pic("heart"), imgs);
  K.dev(0);
  const lead = { stroke: "#8b887f", "stroke-width": 2.2 };
  const notes = [
    { at: [985, 360], to: [1250, 320], txt: "主动脉", t: 0.25 },
    { at: [872, 400], to: [620, 360], txt: "上腔静脉", t: 0.38, left: true },
    { at: [850, 640], to: [580, 690], txt: "右心房", t: 0.5, left: true },
    { at: [1060, 820], to: [1320, 870], txt: "左心室", t: 0.62 },
  ];
  notes.forEach((n) => {
    K.ink(front, handStroke(n.at, n.to, r, 4, 1), n.t, n.t + 0.08, lead, 0.4);
    svg("circle", { cx: n.at[0], cy: n.at[1], r: 6, fill: "#3a352c" }, front);
    K.words(front, n.txt, n.left ? n.to[0] - 14 - n.txt.length * 40 : n.to[0] + 14, n.to[1] + 12, n.t + 0.09, 0.035, { "font-size": 40, fill: "#141413" });
  });
  const red = handArrow([1090, 470], [1410, 480], r, -0.35, 22).map((d, k) => K.ink(front, d, 0.75 + k * 0.03, 0.75 + k * 0.03 + (k ? 0.03 : 0.14), { stroke: "#d0443a", "stroke-width": 5 }, 0.5));
  const blue = handArrow([470, 540], [770, 560], r, -0.3, 22).map((d, k) => K.ink(front, d, 0.85 + k * 0.03, 0.85 + k * 0.03 + (k ? 0.03 : 0.14), { stroke: "#3f7fb5", "stroke-width": 5 }, 0.5));
  K.words(front, "含氧血 → 全身", 1300, 445, 0.95, 0.03, { "font-size": 30, fill: "#d0443a" });
  K.words(front, "回心血", 470, 515, 1.0, 0.03, { "font-size": 30, fill: "#3f7fb5" });
  return {
    page,
    sketcher: K.S,
    update(t) {
      titleIn(title, t, -0.1);
      const beat = 1 + 0.025 * Math.max(0, Math.sin(t * 7.5)) ** 8;
      place(heart, 960, 622, 388, 600, 0, beat);
      develop(heart, prog(t, 0, 0.6));
      K.S.update(t);
    },
  };
}

// =====================================================================================
// The Silk Road, east to west. Local 0 = 47.65 s.
// =====================================================================================
export function makeSilk(parent, opts = {}) {
  const K = kit(opts);
  const { page, back, imgs, front } = makePage(parent, opts.x ?? 0, opts.y ?? 0);
  const r = random(31);
  const title = tileTitle(page, "丝绸之路上走过什么？", "丝绸之路");
  const sand = svg("path", { d: "M180 760 Q600 690 960 740 T1780 720 L1780 830 Q1200 860 700 830 T180 840 Z", fill: "#ead2a4", opacity: 0, filter: "url(#wash)" }, back);
  const items = [
    { id: "pagoda", x: 1620, y: 560, w: 200, h: 349, t: 0 },
    { id: "mountain", x: 1210, y: 470, w: 330, h: 202, t: 0.08 },
    { id: "horse", x: 960, y: 690, w: 300, h: 198, t: 0.16 },
    { id: "castle", x: 330, y: 560, w: 330, h: 257, t: 0.24 },
  ].map((it) => ({ ...it, el: img(pic(it.id), imgs) }));
  items.forEach((it) => K.dev(it.t));
  const route = [[1540, 720], [1360, 650], [1180, 600], [1000, 610], [820, 560], [640, 610], [470, 640]];
  const routeInk = dashed(K, front, pathOf(handLine(route, r, 6, 12)), 0.25, 0.85, { stroke: "#c15f3c", "stroke-width": 6 }, "1 17", 0.7);
  const stops = [
    ["长安", 1500, 790, 0.3],
    ["敦煌", 1300, 700, 0.45],
    ["撒马尔罕", 760, 520, 0.62],
    ["罗马", 300, 740, 0.8],
  ];
  stops.forEach(([s, x, y, t]) => K.words(front, s, x, y, t, 0.04, { "font-size": 38, fill: "#141413" }));
  K.words(front, "丝绸 · 瓷器 · 香料 · 纸", 1150, 980, 0.9, 0.025, { "font-size": 32, fill: "#8b887f" });
  return {
    page,
    sketcher: K.S,
    update(t) {
      titleIn(title, t, -0.1);
      attr(sand, "opacity", String(f1(prog(t, 0, 0.5) * 60) / 100));
      items.forEach((it) => {
        place(it.el, it.x, it.y, it.w, it.h);
        develop(it.el, prog(t, it.t, it.t + 0.5));
      });
      K.S.update(t);
    },
  };
}

// =====================================================================================
// Who is who in Dream of the Red Chamber. Local 0 = 48.9 s.
// =====================================================================================
export function makeRed(parent, opts = {}) {
  const K = kit(opts);
  const { page, back, imgs, front } = makePage(parent, opts.x ?? 0, opts.y ?? 0);
  const r = random(61);
  const title = tileTitle(page, "红楼梦中的人物关系", "人物关系");
  const P = {
    baoyu: { id: "youth", name: "贾宝玉", x: 960, y: 560 },
    daiyu: { id: "grey", name: "林黛玉", x: 520, y: 720 },
    baochai: { id: "girl", name: "薛宝钗", x: 1400, y: 720 },
    jiamu: { id: "matriarch", name: "贾母", x: 470, y: 330 },
    xifeng: { id: "noblewoman", name: "王熙凤", x: 1460, y: 330 },
    xiren: { id: "maid", name: "袭人", x: 960, y: 900 },
  };
  const order = ["baoyu", "daiyu", "baochai", "jiamu", "xifeng", "xiren"];
  const H = 230;
  order.forEach((k, i) => {
    P[k].el = img(pic(P[k].id), imgs);
    P[k].t = i * 0.06;
    K.dev(P[k].t);
  });
  const links = [
    ["baoyu", "daiyu", "木石前盟", "#c8432e", 5],
    ["baoyu", "baochai", "金玉良缘", "#3a352c", 3],
    ["jiamu", "baoyu", "祖孙", "#3a352c", 3],
    ["xifeng", "jiamu", "孙媳", "#3a352c", 3],
    ["xiren", "baoyu", "丫鬟", "#3a352c", 3],
  ];
  links.forEach(([a, b, word, color, w], i) => {
    const A = P[a],
      B = P[b];
    const dx = B.x - A.x,
      dy = B.y - A.y,
      L = Math.hypot(dx, dy);
    const s = [A.x + (dx / L) * 140, A.y + (dy / L) * 140],
      e = [B.x - (dx / L) * 140, B.y - (dy / L) * 140];
    const t0 = 0.35 + i * 0.09;
    K.ink(back, handStroke(s, e, r, 10, 2), t0, t0 + 0.12, { stroke: color, "stroke-width": w }, 0.5);
    const mx = (s[0] + e[0]) / 2,
      my = (s[1] + e[1]) / 2;
    const bg = svg("rect", { x: mx - word.length * 17 - 10, y: my - 26, width: word.length * 34 + 20, height: 44, rx: 10, fill: "#faf9f5" }, front);
    K.words(front, word, mx - word.length * 17, my + 8, t0 + 0.1, 0.03, { "font-size": 32, fill: color });
  });
  order.forEach((k) => {
    const p = P[k];
    K.words(front, p.name, p.x - p.name.length * 19, p.y + H / 2 + 44, p.t + 0.3, 0.04, { "font-size": 38, fill: "#141413" });
  });
  return {
    page,
    sketcher: K.S,
    update(t) {
      titleIn(title, t, -0.1);
      order.forEach((k) => {
        const p = P[k];
        const w = H * 0.83;
        place(p.el, p.x, p.y, w, H);
        develop(p.el, prog(t, p.t, p.t + 0.5));
      });
      K.S.update(t);
    },
  };
}

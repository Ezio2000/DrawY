// The things in the film, painted: beans, cherries, leaves, a cup, coffee rings, the still
// life that hangs in the gallery, and the small studies that hang beside it.
import { rng, lerp, canvas } from "./core.js";
import { ellipse, bez, wash, lift, ink, paper, sprite, smooth, trace, Painting, fillPoly } from "./paint.js";
import { noise } from "./core.js";

export const INK = "#26180f";
export const C = {
  bean: "#64381c",
  beanDeep: "#2d160a",
  cherry: "#b8342a",
  cherryDeep: "#6b1611",
  leaf: "#687f41",
  leafDeep: "#3e5527",
  coffee: "#3b2112",
  crema: "#a26d3b",
  foam: "#ead6b4",
  porcelain: "#c8baa4",
  stain: "#9a6a3c",
  green: "#a9b06a",
  fire: "#e0782a",
  seal: "#b33b2c",
};

const closedInk = (g, P, o) => ink(g, [...P, P[0], P[1]], { closed: false, in: 0.02, out: 0.02, ...o });

/** A coffee bean on its side at the origin, long axis along x, L long. */
export function bean(g, L, o = {}) {
  const s = o.seed ?? 1,
    rx = L / 2,
    ry = L * 0.37;
  const body = ellipse(0, 0, rx, ry, 36);
  wash(g, body, o.tone ?? C.bean, { seed: s, layers: 26, alpha: 0.06, spread: 0.022, edge: 1.4, grain: 0.4 });
  // form: lit from the upper left
  g.save();
  trace(g, body);
  g.clip();
  const gr = g.createRadialGradient(-rx * 0.35, -ry * 0.45, L * 0.05, rx * 0.1, ry * 0.2, L * 0.62);
  const f = o.form ?? 1;
  gr.addColorStop(0, "rgba(255,240,220,0)");
  gr.addColorStop(0.55, `rgba(60,30,12,${0.18 * f})`);
  gr.addColorStop(1, `rgba(30,14,5,${0.62 * f})`);
  g.globalCompositeOperation = "multiply";
  g.fillStyle = gr;
  g.fillRect(-rx, -ry, L, ry * 2);
  g.restore();
  wash(g, ellipse(rx * 0.2, ry * 0.3, rx * 0.78, ry * 0.6, 28), o.deep ?? C.beanDeep, { seed: s + 1, layers: 22, alpha: 0.034, spread: 0.08, edge: 0.1, clip: body, grain: 0.45, soft: ry * 0.22 });
  wash(g, ellipse(-rx * 0.3, ry * 0.1, rx * 0.5, ry * 0.5, 24), "#8a4a26", { seed: s + 7, layers: 14, alpha: 0.03, spread: 0.1, edge: 0.2, clip: body, grain: 0.5, soft: ry * 0.18 });
  g.save();
  g.globalCompositeOperation = "destination-out";
  const hl = g.createRadialGradient(-rx * 0.38, -ry * 0.46, 0, -rx * 0.38, -ry * 0.46, rx * 0.42);
  hl.addColorStop(0, "rgba(0,0,0,0.32)");
  hl.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = hl;
  g.fillRect(-rx, -ry, L, ry * 2);
  g.restore();
  const crease = [
    [-rx * 0.84, ry * 0.08],
    [-rx * 0.34, -ry * 0.2],
    [rx * 0.3, ry * 0.22],
    [rx * 0.84, -ry * 0.06],
  ];
  g.save();
  g.globalCompositeOperation = "destination-out";
  ink(g, crease.map(([x, y]) => [x, y - ry * 0.17]), { w: L * 0.028, alpha: 0.22, seed: s + 3, wobble: 0.2 });
  g.restore();
  ink(g, crease.map(([x, y]) => [x, y + ry * 0.05]), { w: L * 0.09, color: "#3a1d0c", alpha: 0.35, seed: s + 6, wobble: 0.3 });
  ink(g, crease, { w: L * 0.05, color: o.creaseColor ?? "#1d0e06", alpha: 0.9, seed: s + 4, wobble: 0.3 });
  ink(g, smooth(body.slice(5, 31), 3), { w: Math.max(1.1, L * 0.011), alpha: 0.42, seed: s + 5, color: INK });
}

/** A ripe coffee cherry at the origin. */
export function cherry(g, R, o = {}) {
  const s = o.seed ?? 1;
  const body = ellipse(0, 0, R, R * 0.94, 26);
  wash(g, body, o.tone ?? C.cherry, { seed: s, layers: 24, alpha: 0.075, spread: 0.035, edge: 1.6, grain: 0.3 });
  wash(g, ellipse(R * 0.28, R * 0.28, R * 0.72, R * 0.62, 22), o.deep ?? C.cherryDeep, { seed: s + 1, layers: 14, alpha: 0.055, spread: 0.05, clip: body, edge: 0.4 });
  lift(g, ellipse(-R * 0.36, -R * 0.4, R * 0.3, R * 0.16, 16, -0.5), 0.75, { seed: s + 2 });
  ink(g, ellipse(R * 0.48, R * 0.46, R * 0.09, R * 0.08, 10).concat([[R * 0.57, R * 0.46]]), { w: R * 0.07, alpha: 0.8, seed: s + 3, in: 0.01, out: 0.01 });
  ink(g, smooth(body.slice(3, 20), 3), { w: Math.max(1.2, R * 0.04), alpha: 0.45, seed: s + 4 });
}

/** A leaf from the origin to (L, 0), W wide. */
export function leaf(g, L, W, o = {}) {
  const s = o.seed ?? 1;
  const top = bez([0, 0], [L * 0.28, -W * 1.05], [L * 0.75, -W * 0.85], [L, 0], 18);
  const bot = bez([L, 0], [L * 0.72, W * 0.9], [L * 0.25, W * 0.95], [0, 0], 18);
  const poly = [...top, ...bot.slice(1)];
  wash(g, poly, o.tone ?? C.leaf, { seed: s, layers: 22, alpha: 0.07, spread: 0.035, edge: 1.4, grain: 0.35 });
  wash(g, [...bez([0, 0], [L * 0.3, W * 0.15], [L * 0.7, W * 0.12], [L, 0], 14), ...bot.slice(1)], o.deep ?? C.leafDeep, { seed: s + 1, layers: 12, alpha: 0.05, clip: poly, edge: 0.4 });
  ink(g, bez([L * 0.02, 0], [L * 0.35, -W * 0.08], [L * 0.7, -W * 0.06], [L * 0.97, 0], 12), { w: Math.max(1.1, W * 0.06), alpha: 0.6, seed: s + 2, color: "#2c3a1b" });
  for (let k = 1; k <= 4; k++) {
    const x = L * (0.14 + 0.17 * k);
    ink(g, [[x, -W * 0.07], [x + L * 0.08, -W * 0.38], [x + L * 0.15, -W * 0.6]], { w: Math.max(0.8, W * 0.035), alpha: 0.35, seed: s + 10 + k, color: "#2c3a1b" });
    ink(g, [[x, -W * 0.02], [x + L * 0.08, W * 0.3], [x + L * 0.15, W * 0.52]], { w: Math.max(0.8, W * 0.035), alpha: 0.3, seed: s + 20 + k, color: "#2c3a1b" });
  }
  ink(g, top.slice(2, 17), { w: Math.max(1, W * 0.04), alpha: 0.45, seed: s + 3 });
}

/** A coffee ring: the mark a cup leaves. Coffee dries darkest at the rim it was spilled to,
 * so the ring is a crisp dark edge fading inward, never quite closed. */
export function ring(g, cx, cy, R, o = {}) {
  const r = rng(o.seed ?? 4),
    sd = o.seed ?? 4;
  const tone = o.tone ?? C.stain;
  const rad = (a, k = 0) => R * (1 + 0.018 * noise(a * 2.2 + sd, sd) + 0.008 * noise(a * 9 + sd, sd + 3)) - k;
  // the faint stain inside
  const inner = Array.from({ length: 72 }, (_, i) => {
    const a = (i / 72) * Math.PI * 2;
    return [cx + Math.cos(a) * rad(a, 4), cy + Math.sin(a) * rad(a, 4) * 0.98];
  });
  wash(g, inner, tone, { seed: sd + 1, layers: 6, alpha: 0.012 * (o.fill ?? 1), spread: 0.01, edge: 0, grain: 0.7 });
  g.save();
  g.lineJoin = g.lineCap = "round";
  const gapAt = r() * Math.PI * 2,
    gap = (o.gap ?? 0.15) * Math.PI;
  for (let k = 0; k < 9; k++) {
    g.strokeStyle = tone;
    g.globalAlpha = (0.32 - k * 0.032) * (o.strength ?? 1);
    g.lineWidth = (o.width ?? 2.4) * (k === 0 ? 1 : 1.6);
    g.beginPath();
    for (let i = 0; i <= 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      const dist = Math.abs(((a - gapAt + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      const fade = dist < gap ? dist / gap : 1;
      const p = [cx + Math.cos(a) * rad(a, k * 1.6), cy + Math.sin(a) * rad(a, k * 1.6) * 0.98];
      if (fade < 0.35 && k === 0) {
        g.moveTo(p[0], p[1]);
        continue;
      }
      if (i === 0) g.moveTo(p[0], p[1]);
      else g.lineTo(p[0], p[1]);
    }
    g.stroke();
  }
  // a couple of drops flung off it
  for (let i = 0; i < (o.drops ?? 2); i++) {
    const a = r() * Math.PI * 2,
      d = R * (1.08 + r() * 0.25),
      s = 3 + r() * 6;
    wash(g, ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, s, s * 0.9, 12), tone, { seed: sd + 20 + i, layers: 8, alpha: 0.12, spread: 0.08, edge: 2 });
  }
  g.restore();
}

/** A red seal, the painter's chop, with characters cut into it. */
export function seal(g, x, y, size, chars) {
  const r = rng(77);
  const sq = [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
  ];
  wash(g, sq, C.seal, { seed: 3, layers: 16, alpha: 0.11, spread: 0.012, edge: 0.6, grain: 0.7, iters: 3 });
  g.save();
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = "#000";
  g.globalAlpha = 0.92;
  g.font = `400 ${size * 0.44}px "Ma Shan Zheng"`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  [...chars].forEach((ch, i) => g.fillText(ch, x + size / 2, y + size * (0.29 + i * 0.44)));
  for (let i = 0; i < 40; i++) {
    g.globalAlpha = 0.3;
    g.beginPath();
    g.arc(x + r() * size, y + r() * size, r() * 2, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

// =====================================================================================
// The still life: a cup of coffee on its saucer, beans spilled before it, a sprig of the
// plant it came from. 1920×1080. The big bean is left out: it is its own sprite, so it can
// open.
// =====================================================================================
export const HERO = { x: 560, y: 830, L: 150, rot: -0.36 };
export function paintCover() {
  const P = new Painting(1920, 1080, { seed: 21, color: "#f2e8d4", vignette: 0.13 });
  const full = [0, 0, 1920, 1080];

  // the coffee's own marks on the paper
  P.put(full, (g) => {
    ring(g, 410, 290, 150, { seed: 5, strength: 1.1, gap: 0.22, drops: 3 });
    ring(g, 1650, 920, 104, { seed: 8, strength: 0.7, gap: 0.4 });
  });
  // the saucer and its shadow
  const saucer = ellipse(1090, 800, 410, 84, 72);
  P.put([600, 690, 1000, 260], (g) => {
    wash(g, ellipse(1150, 852, 440, 64, 48), "#93806a", { seed: 30, layers: 14, alpha: 0.03, spread: 0.04, edge: 0.2 });
    wash(g, saucer, "#d8ccb8", { seed: 31, layers: 10, alpha: 0.05, spread: 0.012, edge: 1.4, grain: 0.4 });
    wash(g, ellipse(1160, 816, 320, 58, 48), "#a3927b", { seed: 32, layers: 10, alpha: 0.035, spread: 0.03, clip: saucer, edge: 0.2 });
    ink(g, [...saucer, saucer[0], saucer[1]], { w: 2.4, alpha: 0.72, seed: 33, in: 0.01, out: 0.01 });
    ink(g, ellipse(1086, 794, 210, 34, 48).slice(2, 23), { w: 1.6, alpha: 0.45, seed: 34 });
  }, (g) => fillPoly(g, saucer));

  // the handle, then the cup over it
  const handle = [[1296, 538], [1416, 520], [1442, 636], [1362, 690], [1284, 690]];
  P.put([1260, 480, 230, 260], (g) => {
    ink(g, handle, { w: 30, color: "#e4d9c6", alpha: 1, seed: 40, vary: 0.08, in: 0.03, out: 0.03 });
    ink(g, handle.map(([x, y]) => [x + 5, y + 8]), { w: 12, color: "#a8977f", alpha: 0.5, seed: 41, vary: 0.2 });
    ink(g, [[1300, 523], [1436, 502], [1464, 646], [1368, 708], [1282, 706]], { w: 2.4, alpha: 0.75, seed: 42 });
    ink(g, [[1300, 554], [1400, 542], [1414, 626], [1352, 668], [1290, 670]], { w: 1.8, alpha: 0.6, seed: 43 });
  }, (g) => {
    g.lineWidth = 34;
    g.lineJoin = g.lineCap = "round";
    g.beginPath();
    handle.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  });
  const left = bez([842, 470], [842, 650], [905, 770], [1010, 784], 20);
  const bottom = bez([1010, 784], [1050, 790], [1110, 790], [1150, 784], 6);
  const right = bez([1150, 784], [1255, 770], [1318, 650], [1318, 470], 20);
  const body = [...left, ...bottom.slice(1), ...right.slice(1)];
  const rim = ellipse(1080, 470, 238, 56, 72);
  P.put([820, 400, 520, 400], (g) => {
    g.save();
    trace(g, body);
    g.clip();
    const gx = g.createLinearGradient(842, 0, 1318, 0);
    gx.addColorStop(0, "rgba(150,132,108,0.22)");
    gx.addColorStop(0.3, "rgba(150,132,108,0.0)");
    gx.addColorStop(0.58, "rgba(150,132,108,0.1)");
    gx.addColorStop(0.86, "rgba(120,102,80,0.5)");
    gx.addColorStop(1, "rgba(110,94,72,0.34)");
    g.fillStyle = gx;
    g.fillRect(820, 440, 520, 360);
    const gy = g.createLinearGradient(0, 640, 0, 790);
    gy.addColorStop(0, "rgba(120,100,76,0)");
    gy.addColorStop(1, "rgba(120,100,76,0.3)");
    g.fillStyle = gy;
    g.fillRect(820, 600, 520, 200);
    g.restore();
    wash(g, body, "#cbbfa9", { seed: 44, layers: 10, alpha: 0.03, spread: 0.01, edge: 0.6, grain: 0.6 });
    // a band of glaze around the bowl
    wash(g, [...bez([846, 556], [980, 590], [1180, 590], [1314, 556], 18), ...bez([1312, 584], [1180, 618], [980, 618], [850, 584], 18)], "#b3683f", { seed: 48, layers: 14, alpha: 0.075, spread: 0.008, clip: body, edge: 1 });
    ink(g, left, { w: 2.6, alpha: 0.82, seed: 49 });
    ink(g, [...bottom, ...right.slice(1)], { w: 2.8, alpha: 0.82, seed: 50 });
    ink(g, bez([880, 500], [870, 600], [900, 700], [960, 760], 12), { w: 1.2, alpha: 0.18, seed: 51 });
  }, (g) => {
    fillPoly(g, body);
    fillPoly(g, rim);
  });
  // the rim, and the coffee in it
  const surface = ellipse(1080, 478, 214, 45, 72);
  P.put([830, 400, 500, 140], (g) => {
    wash(g, rim, "#e3d8c6", { seed: 52, layers: 6, alpha: 0.05, spread: 0.006, edge: 0.4 });
    wash(g, surface, "#93592f", { seed: 53, layers: 22, alpha: 0.085, spread: 0.01, edge: 0.4, grain: 0.15 });
    g.save();
    trace(g, surface);
    g.clip();
    const gr = g.createRadialGradient(1080, 478, 120, 1080, 478, 214);
    gr.addColorStop(0, "rgba(60,30,14,0)");
    gr.addColorStop(1, "rgba(52,26,12,0.85)");
    g.setTransform(1, 0, 0, 0.21, 0, 478 * 0.79);
    g.fillStyle = gr;
    g.fillRect(860, 0, 440, 1200);
    g.restore();
    ink(g, [...rim, rim[0], rim[1]], { w: 2.6, alpha: 0.86, seed: 57, in: 0.01, out: 0.01 });
    ink(g, surface.slice(36, 72), { w: 1.5, alpha: 0.5, seed: 58 });
  }, (g) => fillPoly(g, rim));
  // foam, poured as a heart
  const heart = [];
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(a), 3),
      y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
    heart.push([1084 + x * 6.2, 480 + y * 1.55]);
  }
  P.put([960, 440, 250, 80], (g) => {
    wash(g, heart, "#ead7b6", { seed: 56, layers: 14, alpha: 0.06, spread: 0.02, edge: 1.2 });
    wash(g, ellipse(1084, 468, 40, 6, 20), "#b98a5b", { seed: 59, layers: 8, alpha: 0.05, edge: 0.4, clip: heart });
  }, (g) => fillPoly(g, heart));

  // beans spilled on the table, each with its small shadow
  const BEANS = [
    [380, 900, 92, 0.5],
    [730, 945, 100, -0.9],
    [420, 760, 82, 1.4],
    [810, 830, 88, 2.1],
    [600, 990, 90, 0.2],
    [920, 985, 78, -0.4],
    [270, 830, 74, -1.1],
  ];
  BEANS.forEach(([x, y, l, a], k) => {
    const sil = ellipse(x, y, l * 0.52, l * 0.39, 24, a);
    P.put([x - l, y - l, l * 2, l * 2], (g) => {
      wash(g, ellipse(x + 8, y + 14, l * 0.5, l * 0.22, 24, a), "#8f7b62", { seed: 140 + k, layers: 8, alpha: 0.04, edge: 0 });
      g.save();
      g.translate(x, y);
      g.rotate(a);
      bean(g, l, { seed: 150 + k * 9 });
      g.restore();
    }, (g) => fillPoly(g, sil));
  });
  P.put([HERO.x - 160, HERO.y - 120, 320, 260], (g) => wash(g, ellipse(HERO.x + 14, HERO.y + 24, HERO.L * 0.52, HERO.L * 0.2, 24, HERO.rot), "#8f7b62", { seed: 170, layers: 10, alpha: 0.045, edge: 0 }));

  // the sprig, top right: stem, leaves behind, cherries in front
  P.put([1400, 80, 520, 420], (g) => ink(g, [[1910, 130], [1800, 200], [1690, 270], [1560, 350], [1450, 400]], { w: 9, color: "#5b412a", alpha: 0.85, seed: 60, vary: 0.4 }));
  [
    [1820, 186, -2.6, 170, 54],
    [1745, 236, -1.0, 156, 48],
    [1690, 268, 2.1, 182, 56],
    [1600, 322, -2.3, 160, 50],
    [1560, 346, 1.3, 150, 46],
    [1470, 392, 2.8, 138, 44],
  ].forEach(([x, y, a, l, w], k) => {
    const draw = (g) => {
      g.save();
      g.translate(x, y);
      g.rotate(a);
      leaf(g, l, w, { seed: 70 + k * 5, tone: k % 2 ? C.leaf : "#738a48" });
      g.restore();
    };
    P.put([x - 200, y - 200, 400, 400], draw);
  });
  [
    [1668, 356, 26, C.cherry],
    [1700, 330, 30, C.cherry],
    [1738, 352, 28, "#a92d24"],
    [1706, 376, 29, "#c4472f"],
    [1548, 436, 24, "#c79a3a"],
    [1520, 418, 26, "#b8342a"],
    [1526, 458, 25, "#c4472f"],
  ].forEach(([x, y, R, tone], k) => {
    P.put([x - R * 2, y - R * 2, R * 4, R * 4], (g) => {
      g.save();
      g.translate(x, y);
      cherry(g, R, { seed: 100 + k * 7, tone, deep: tone === "#c79a3a" ? "#7a5a1c" : C.cherryDeep });
      g.restore();
    }, (g) => fillPoly(g, ellipse(x, y, R * 1.02, R * 0.96, 20)));
  });

  // the painter's chop: 动手
  P.put([1700, 930, 140, 140], (g) => seal(g, 1730, 960, 74, "动手"));
  return P.c;
}

/** The hero bean, painted big (`res`× its size) so the camera can go right up to it, in two
 * halves split along its crease. */
export function paintHero(res = 6) {
  const L = HERO.L,
    w = L * 1.2,
    h = L * 0.9;
  const whole = sprite(w, h, res, (g) => {
    g.translate(w / 2, h / 2);
    bean(g, L, { seed: 9 });
  });
  // the crease, as the line the halves part along
  const rx = L / 2,
    ry = L * 0.37;
  const crease = bez([-rx * 1.1, ry * 0.12], [-rx * 0.3, -ry * 0.36], [rx * 0.3, ry * 0.38], [rx * 1.1, -ry * 0.1], 30).map(([x, y]) => [x + w / 2, y + h / 2]);
  const half = (up) => {
    const c = canvas(whole.width, whole.height),
      g = c.getContext("2d");
    g.drawImage(whole, 0, 0);
    g.globalCompositeOperation = "destination-in";
    g.setTransform(res, 0, 0, res, 0, 0);
    g.beginPath();
    g.moveTo(crease[0][0], up ? -10 : h + 10);
    for (const p of crease) g.lineTo(p[0], p[1]);
    g.lineTo(crease.at(-1)[0], up ? -10 : h + 10);
    g.closePath();
    g.fill();
    return c;
  };
  return { whole, top: half(true), bottom: half(false), w, h, crease };
}

/** A small study for the other walls: a few marks of the same hand. */
export function paintStudy(kind, seed) {
  const w = 900,
    h = 640;
  const c = paper(w, h, { seed: 200 + seed, color: "#eee4cf", mottle: 50, fibres: 80, vignette: 0.14 });
  const g = c.getContext("2d");
  if (kind === "cherries") {
    ink(g, [[880, 60], [700, 180], [520, 300], [360, 380]], { w: 8, color: "#5b412a", seed: 1 });
    [[640, 230, 2.1, 160, 52], [560, 270, -2.4, 150, 48], [460, 330, 1.9, 140, 44]].forEach(([x, y, a, l, ww], k) => {
      g.save();
      g.translate(x, y);
      g.rotate(a);
      leaf(g, l, ww, { seed: 5 + k });
      g.restore();
    });
    [[520, 360, 34], [560, 384, 32], [522, 404, 31], [380, 410, 30], [404, 440, 28]].forEach(([x, y, R], k) => {
      g.save();
      g.translate(x, y);
      cherry(g, R, { seed: 30 + k });
      g.restore();
    });
  } else if (kind === "ring") {
    ring(g, 450, 320, 200, { seed: 3, width: 9, strength: 1.4, gap: 0.2, fill: 2 });
    ring(g, 560, 360, 120, { seed: 6, width: 5, strength: 0.9, gap: 0.5 });
  } else if (kind === "beans") {
    [[300, 300, 170, 0.4], [520, 360, 160, -0.6], [700, 290, 150, 1.2]].forEach(([x, y, l, a], k) => {
      g.save();
      g.translate(x, y);
      g.rotate(a);
      bean(g, l, { seed: 40 + k * 3 });
      g.restore();
    });
  } else if (kind === "pot") {
    const body = [...bez([340, 520], [300, 380], [360, 260], [450, 240], 14), ...bez([450, 240], [540, 260], [600, 380], [560, 520], 14)];
    wash(g, body, "#8c8273", { seed: 7, layers: 18, alpha: 0.06 });
    ink(g, [...body, body[0]], { w: 2.4, seed: 8 });
    ink(g, [[560, 330], [660, 300], [700, 230]], { w: 8, seed: 9 });
    ring(g, 640, 540, 90, { seed: 10, width: 4 });
  }
  return c;
}

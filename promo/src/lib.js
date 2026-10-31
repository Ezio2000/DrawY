// Helpers for a film that is a pure function of time: easing, a seeded hand, SVG and DOM
// builders, strokes that draw themselves, words that write themselves, and a cue sheet
// the score is written against.

export const W = 1920,
  H = 1080,
  BEAT = 60 / 96,
  BAR = BEAT * 4;

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const prog = (t, a, b) => clamp((t - a) / (b - a));
export const ease = {
  linear: (x) => x,
  inOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  inOut2: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  out: (x) => 1 - Math.pow(1 - x, 3),
  out2: (x) => 1 - (1 - x) * (1 - x),
  out5: (x) => 1 - Math.pow(1 - x, 5),
  in: (x) => x * x * x,
  in2: (x) => x * x,
  expoInOut: (x) =>
    x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2,
  back: (x) => {
    const c1 = 1.70158,
      c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  },
  // A damped spring that settles at 1.
  spring: (x) => (x >= 1 ? 1 : 1 - Math.exp(-6.5 * x) * Math.cos(11 * x)),
  sine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
};
/** 0 → 1 → 0 over [a, b], rising over `inD` and falling over `outD`. */
export const window_ = (t, a, b, inD = 0.3, outD = 0.3) =>
  Math.min(ease.out2(prog(t, a, a + inD)), 1 - ease.in2(prog(t, b - outD, b)));

/** The brand's xorshift: a deterministic wobble. */
export function random(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

const f1 = (n) => Math.round(n * 10) / 10;

// ---------- DOM ----------
const SVGNS = "http://www.w3.org/2000/svg";
export function svg(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}
export function div(cls, parent, style) {
  const el = document.createElement("div");
  if (cls) el.className = cls;
  if (style) Object.assign(el.style, style);
  if (parent) parent.appendChild(el);
  return el;
}
export function img(src, parent, style) {
  const el = document.createElement("img");
  el.src = src;
  el.className = "pic";
  el.decoding = "sync";
  if (style) Object.assign(el.style, style);
  if (parent) parent.appendChild(el);
  return el;
}
export const asset = (id) => `/materials/seed/files/${id}`;
export const pic = (id) => asset(id + ".webp");

/** Sets a style only when it changes; most frames move little. */
export function css(el, prop, value) {
  if (el.__s === undefined) el.__s = {};
  if (el.__s[prop] !== value) {
    el.__s[prop] = value;
    el.style[prop] = value;
  }
}
export function attr(el, name, value) {
  if (el.__a === undefined) el.__a = {};
  if (el.__a[name] !== value) {
    el.__a[name] = value;
    el.setAttribute(name, value);
  }
}
export const show = (el, on) => css(el, "display", on ? "" : "none");

// ---------- the hand ----------
/** A centre line as an unsteady hand draws it: points nudged, then a Catmull-Rom curve. */
export function handLine(pts, r, wobble = 6, step = 14) {
  const P = pts.map(([x, y]) => [x + (r() - 0.5) * wobble, y + (r() - 0.5) * wobble]);
  if (P.length === 1) P.push([P[0][0] + 1, P[0][1] + 1]);
  const at = (i) => P[Math.max(0, Math.min(P.length - 1, i))];
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const n = Math.max(1, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const cr = (p, q, s, u) =>
        0.5 * (2 * q + (s - p) * t + (2 * p - 5 * q + 4 * s - u) * t * t + (3 * q - p - 3 * s + u) * t * t * t);
      out.push([cr(a[0], b[0], c[0], d[0]), cr(a[1], b[1], c[1], d[1])]);
    }
  }
  out.push(P.at(-1));
  return out;
}
export const pathOf = (pts) => "M" + pts.map((p) => f1(p[0]) + " " + f1(p[1])).join("L");

/** A line from a to b drawn by hand: bowed a little, starting and ending a touch off. */
export function handStroke(a, b, r, bow = 3, over = 3) {
  const [ax, ay] = a,
    [bx, by] = b,
    dx = bx - ax,
    dy = by - ay,
    len = Math.hypot(dx, dy) || 1,
    ux = dx / len,
    uy = dy / len,
    nx = -uy,
    ny = ux;
  const j = () => (r() - 0.5) * over;
  const s = [ax - ux * r() * over + nx * j(), ay - uy * r() * over + ny * j()];
  const e = [bx + ux * r() * over * 1.4 + nx * j(), by + uy * r() * over * 1.4 + ny * j()];
  const k = (r() - 0.5) * 2 * bow;
  const c = [(s[0] + e[0]) / 2 + nx * k, (s[1] + e[1]) / 2 + ny * k];
  return `M${f1(s[0])} ${f1(s[1])}Q${f1(c[0])} ${f1(c[1])} ${f1(e[0])} ${f1(e[1])}`;
}

/** An ellipse as a hand goes round it once and a little past where it began. */
export function handEllipse(cx, cy, rx, ry, r, opts = {}) {
  const start = opts.start ?? r() * Math.PI * 2;
  const over = opts.over ?? 0.22 + r() * 0.18;
  const wob = opts.wobble ?? 0.025;
  const n = Math.max(24, Math.round((rx + ry) / 6));
  const ph1 = r() * 6,
    ph2 = r() * 6;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n,
      a = start + u * (Math.PI * 2 + over);
    const drift = 1 + wob * Math.sin(a * 2 + ph1) + wob * 0.6 * Math.sin(a * 3 + ph2) + (u - 0.5) * wob * 1.2;
    pts.push([cx + Math.cos(a) * rx * drift, cy + Math.sin(a) * ry * drift]);
  }
  return pathOf(pts);
}

/** A curved arrow from a to b, bending by `bend` (fraction of its length); returns the
 * shaft and the two strokes of its head. */
export function handArrow(a, b, r, bend = 0.15, head = 18) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    len = Math.hypot(dx, dy),
    nx = -dy / len,
    ny = dx / len;
  const c = [(a[0] + b[0]) / 2 + nx * len * bend, (a[1] + b[1]) / 2 + ny * len * bend];
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    pts.push([
      (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
      (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1],
    ]);
  }
  const shaft = pathOf(handLine(pts.filter((_, i) => i % 3 === 0 || i === 24), r, 2.5, 10));
  // tangent at the end
  const tx = b[0] - c[0],
    ty = b[1] - c[1],
    tl = Math.hypot(tx, ty),
    ang = Math.atan2(ty / tl, tx / tl);
  const h = (turn) => [b[0] - head * Math.cos(ang + turn), b[1] - head * Math.sin(ang + turn)];
  return [shaft, handStroke(h(0.48), b, r, 1, 1.2), handStroke(h(-0.48), b, r, 1, 1.2)];
}

/** Diagonal hatching inside a circle, as short strokes. */
export function hatchCircle(cx, cy, rad, r, gap = 14, angle = -0.8) {
  const out = [];
  const ux = Math.cos(angle),
    uy = Math.sin(angle),
    nx = -uy,
    ny = ux;
  for (let d = -rad + gap; d < rad; d += gap) {
    const half = Math.sqrt(Math.max(0, rad * rad - d * d)) * 0.86;
    if (half < 8) continue;
    const mx = cx + nx * d,
      my = cy + ny * d;
    out.push(handStroke([mx - ux * half, my - uy * half], [mx + ux * half, my + uy * half], r, 1.2, 3));
  }
  return out;
}

// ---------- strokes that draw themselves ----------
/** A path revealed along its length between t0 and t1; reports where the pencil is. */
export class Ink {
  constructor(parent, d, t0, t1, style = {}, ez = ease.inOut2) {
    this.el = svg("path", { d, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round", ...style }, parent);
    this.t0 = t0;
    this.t1 = t1;
    this.ez = ez;
    this.len = this.el.getTotalLength();
    this.el.style.strokeDasharray = `${this.len + 2} ${this.len + 2}`;
  }
  update(t) {
    const p = this.ez(prog(t, this.t0, this.t1));
    css(this.el, "strokeDashoffset", String(f1((this.len + 1) * (1 - p))));
    css(this.el, "visibility", p <= 0 ? "hidden" : "visible");
    return p;
  }
  point(t) {
    const p = this.ez(prog(t, this.t0, this.t1));
    const q = this.el.getPointAtLength(this.len * p);
    return [q.x, q.y];
  }
}

/** SVG text that appears a character at a time, with the pencil hopping along it. */
export class Words {
  constructor(parent, text, x, y, t0, per, style = {}) {
    this.el = svg("text", { x, y, ...style }, parent);
    this.chars = [...text];
    this.spans = this.chars.map((c) => {
      const s = svg("tspan", {}, this.el);
      s.textContent = c;
      return s;
    });
    this.t0 = t0;
    this.per = per;
    this.t1 = t0 + per * this.chars.length;
    this.boxes = null;
  }
  measure() {
    if (this.boxes) return;
    this.boxes = this.chars.map((_, i) => {
      try {
        const b = this.el.getExtentOfChar(i);
        return [b.x, b.y, b.width, b.height];
      } catch {
        return [0, 0, 0, 0];
      }
    });
  }
  update(t) {
    this.chars.forEach((_, i) => {
      const p = prog(t, this.t0 + i * this.per, this.t0 + (i + 1.6) * this.per);
      attr(this.spans[i], "fill-opacity", String(f1(p * 100) / 100));
    });
  }
  point(t) {
    this.measure();
    const k = clamp((t - this.t0) / this.per, 0, this.chars.length - 0.001);
    const i = Math.floor(k),
      u = k - i;
    const [x, y, w, h] = this.boxes[i];
    // a quick zigzag across the glyph, as a hand writes it
    const zig = Math.sin(u * Math.PI * 3) * 0.32;
    return [x + w * (0.1 + 0.8 * u), y + h * (0.55 + zig)];
  }
}

/** A list of things the pencil does in order; it travels between them with its point lifted. */
export class Sketcher {
  constructor() {
    this.tasks = [];
  }
  add(task) {
    this.tasks.push(task);
    this.tasks.sort((a, b) => a.t0 - b.t0);
    return task;
  }
  update(t) {
    for (const k of this.tasks) k.update(t);
  }
  /** Where the pencil is at t, and whether its point is on the paper. */
  pencil(t, linger = 0.5) {
    const T = this.tasks;
    if (!T.length) return null;
    if (t < T[0].t0 - 0.35) return null;
    for (let i = 0; i < T.length; i++) {
      const k = T[i];
      if (t >= k.t0 && t <= k.t1) return { at: k.point(t), down: true };
      const next = T[i + 1];
      if (t > k.t1 && next && t < next.t0) {
        const gap = next.t0 - k.t1;
        if (gap > 1.2 && t > k.t1 + linger && t < next.t0 - 0.35) return null;
        const a = k.point(k.t1),
          b = next.point(next.t0);
        const u = ease.inOut2(prog(t, k.t1, next.t0));
        return { at: [lerp(a[0], b[0], u), lerp(a[1], b[1], u)], down: false, lift: Math.sin(u * Math.PI) };
      }
    }
    if (t < T[0].t0) {
      const b = T[0].point(T[0].t0);
      return { at: b, down: false, lift: 1 - prog(t, T[0].t0 - 0.35, T[0].t0) };
    }
    const last = T.at(-1);
    if (t <= last.t1 + linger) return { at: last.point(last.t1), down: false, lift: prog(t, last.t1, last.t1 + 0.2) };
    return null;
  }
}

// ---------- a photograph developing ----------
/** Sets the look of an image `p` of the way through developing: a pale sepia ghost that
 * gains contrast, colour and focus. */
export function develop(el, p, extra = "") {
  if (p <= 0) {
    css(el, "opacity", "0");
    return;
  }
  const q = ease.out2(p);
  const blur = lerp(7, 0, ease.out(p));
  const sep = lerp(1, 0, q);
  const bri = lerp(1.55, 1, q);
  const con = lerp(0.45, 1, q);
  const sat = lerp(0.2, 1, q);
  css(el, "opacity", String(f1(clamp(p * 3.2) * 100) / 100));
  css(
    el,
    "filter",
    p >= 1
      ? extra || "none"
      : `blur(${f1(blur)}px) sepia(${f1(sep * 100) / 100}) brightness(${f1(bri * 100) / 100}) contrast(${f1(con * 100) / 100}) saturate(${f1(sat * 100) / 100}) ${extra}`,
  );
}

// ---------- the cue sheet ----------
export const CUES = [];
export const cue = (t, type, more = {}) => CUES.push({ t: Math.round(t * 1000) / 1000, type, ...more });

/** Registers the sound of a stroke: graphite on paper for as long as it is drawn. */
export function cueStroke(t0, t1, gain = 1, kind = "pencil") {
  if (t1 - t0 > 0.02) cue(t0, kind, { dur: Math.round((t1 - t0) * 1000) / 1000, gain });
}

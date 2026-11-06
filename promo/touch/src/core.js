// The film is a pure function of time. These are the few things every part of it needs:
// time shaping, a seeded hand, smooth noise, colour, the DOM, and the cue sheet the score is
// written against.

export const W = 1920,
  H = 1080,
  BPM = 96,
  BEAT = 60 / BPM,
  BAR = 4 * BEAT;

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, k) => a + (b - a) * k;
export const prog = (t, a, b) => clamp((t - a) / (b - a));
export const logLerp = (a, b, k) => Math.exp(lerp(Math.log(a), Math.log(b), k));
export const ease = {
  in2: (x) => x * x,
  in3: (x) => x * x * x,
  out2: (x) => 1 - (1 - x) * (1 - x),
  out3: (x) => 1 - Math.pow(1 - x, 3),
  out5: (x) => 1 - Math.pow(1 - x, 5),
  io2: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  io3: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  io5: (x) => (x < 0.5 ? 16 * Math.pow(x, 5) : 1 - Math.pow(-2 * x + 2, 5) / 2),
  sine: (x) => 0.5 - 0.5 * Math.cos(Math.PI * x),
  back: (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2),
  /** settles at 1 with a small overshoot */
  spring: (x) => (x >= 1 ? 1 : 1 - Math.exp(-7 * x) * Math.cos(10 * x)),
};
/** 0 → 1 → 0 across [a, b], rising over `i` and falling over `o`. */
export const bell = (t, a, b, i = 0.3, o = 0.3) => Math.min(ease.out2(prog(t, a, a + i)), 1 - ease.in2(prog(t, b - o, b)));
/** A click: 0 → 1 → 0 around time c. */
export const press = (t, c, d = 0.1) => (t > c - d && t < c + d ? Math.sin(prog(t, c - d, c + d) * Math.PI) : 0);

/** mulberry32: a small, fast, seeded generator. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const gauss = (r) => {
  const u = Math.max(1e-9, r()),
    v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** Smooth value noise in 1D, about -1..1. */
const hash = (i, s) => {
  let h = (i * 374761393 + s * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
export function noise(x, seed = 0) {
  const i = Math.floor(x),
    f = x - i,
    u = f * f * (3 - 2 * f);
  return lerp(hash(i, seed), hash(i + 1, seed), u) * 2 - 1;
}
/** Two octaves, for a camera that breathes. */
export const drift = (t, seed, speed = 0.35) => noise(t * speed, seed) * 0.7 + noise(t * speed * 2.3, seed + 7) * 0.3;

// ---------- colour ----------
export const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
export const mixHex = (a, b, k) => {
  const A = hex(a),
    B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], k))).join(",")})`;
};
export const rgba = (c, a) => `rgba(${hex(c).join(",")},${Math.round(a * 1000) / 1000})`;

// ---------- DOM ----------
export function el(tag, cls, parent, style) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (style) Object.assign(e.style, style);
  if (parent) parent.appendChild(e);
  return e;
}
const NS = "http://www.w3.org/2000/svg";
export function sv(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
/** Writes a style only when it changes. */
export function css(e, prop, value) {
  const c = e.__css || (e.__css = {});
  if (c[prop] !== value) {
    c[prop] = value;
    e.style[prop] = value;
  }
}
export const show = (e, on) => css(e, "display", on ? "" : "none");
export const r1 = (n) => Math.round(n * 10) / 10;
export const r3 = (n) => Math.round(n * 1000) / 1000;
export const op = (e, a) => css(e, "opacity", String(r3(clamp(a))));

/** A canvas of a given size, and its 2D context. */
export function canvas(w, h, parent, cls) {
  const c = document.createElement("canvas");
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  if (cls) c.className = cls;
  if (parent) parent.appendChild(c);
  return c;
}

// ---------- cameras ----------
/** A camera puts world point p on screen at (p - c) * z + centre + (ox, oy). */
export const project = (cam, p) => [(p[0] - cam.cx) * cam.z + W / 2 + (cam.ox || 0), (p[1] - cam.cy) * cam.z + H / 2 + (cam.oy || 0)];
export const unproject = (cam, s) => [(s[0] - W / 2 - (cam.ox || 0)) / cam.z + cam.cx, (s[1] - H / 2 - (cam.oy || 0)) / cam.z + cam.cy];
export function aim(world, cam) {
  css(world, "transform", `translate(${r1(W / 2 + (cam.ox || 0))}px,${r1(H / 2 + (cam.oy || 0))}px) scale(${Math.round(cam.z * 1e5) / 1e5}) translate(${r1(-cam.cx)}px,${r1(-cam.cy)}px)`);
}
/** Sets a 2D context so that world coordinates draw through `cam` onto a W×H screen scaled by s. */
export function camCtx(ctx, cam, s = 1) {
  ctx.setTransform(cam.z * s, 0, 0, cam.z * s, (W / 2 + (cam.ox || 0) - cam.cx * cam.z) * s, (H / 2 + (cam.oy || 0) - cam.cy * cam.z) * s);
}

// ---------- the cue sheet ----------
export const CUES = [];
export const cue = (t, type, more = {}) => CUES.push({ t: Math.round(t * 1000) / 1000, type, ...more });

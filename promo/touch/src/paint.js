// Watercolour, ink and paper on a 2D canvas. Everything in the film that looks painted is
// painted once, at load, by these: a wash is a polygon deformed again and again and laid
// down in many faint layers, so its edge goes soft and uneven and its pigment pools at the
// rim; an ink line is a filled outline whose width follows the pressure of a hand.
import { rng, gauss, clamp, lerp, noise, canvas } from "./core.js";

// ---------- polygons ----------
export function ellipse(cx, cy, rx, ry, n = 24, rot = 0) {
  const c = Math.cos(rot),
    s = Math.sin(rot);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2,
      x = Math.cos(a) * rx,
      y = Math.sin(a) * ry;
    return [cx + x * c - y * s, cy + x * s + y * c];
  });
}
/** Points along a cubic Bézier, for building outlines. */
export function bez(p0, p1, p2, p3, n = 16) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return out;
}
/** A Catmull-Rom curve through pts, resampled about every `step` px. */
export function smooth(pts, step = 4, closed = false) {
  const P = pts,
    n = P.length,
    at = (i) => (closed ? P[(i + n) % n] : P[Math.max(0, Math.min(n - 1, i))]);
  const out = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = at(i - 1),
      b = at(i),
      c = at(i + 1),
      d = at(i + 2);
    const k = Math.max(1, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / step));
    for (let j = 0; j < k; j++) {
      const t = j / k,
        t2 = t * t,
        t3 = t2 * t;
      const f = (p, q, r, s) => 0.5 * (2 * q + (r - p) * t + (2 * p - 5 * q + 4 * r - s) * t2 + (3 * q - p - 3 * r + s) * t3);
      out.push([f(a[0], b[0], c[0], d[0]), f(a[1], b[1], c[1], d[1])]);
    }
  }
  if (!closed) out.push(P[n - 1]);
  return out;
}
/** Points along straight segments, about every `step` px: for things with corners. */
export function straight(pts, step = 3) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < k; j++) out.push([lerp(a[0], b[0], j / k), lerp(a[1], b[1], j / k)]);
  }
  out.push(pts.at(-1));
  return out;
}
/** Midpoint displacement: each edge gets a new point pushed off by a Gaussian. */
export function deform(poly, iters, variance, r) {
  let P = poly.map((p) => [p[0], p[1], p[2] ?? 1]);
  for (let k = 0; k < iters; k++) {
    const out = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[i],
        b = P[(i + 1) % P.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const w = (a[2] + b[2]) / 2;
      const sd = len * variance * w;
      out.push(a, [(a[0] + b[0]) / 2 + gauss(r) * sd, (a[1] + b[1]) / 2 + gauss(r) * sd, w * (0.7 + r() * 0.6)]);
    }
    P = out;
  }
  return P;
}
export function trace(ctx, P) {
  ctx.beginPath();
  ctx.moveTo(P[0][0], P[0][1]);
  for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]);
  ctx.closePath();
}
const bbox = (P) => {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of P) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
};

// a field of speckles that lets the paper show through a wash
let grainTile = null;
function grain() {
  if (grainTile) return grainTile;
  const c = canvas(256, 256),
    g = c.getContext("2d"),
    im = g.createImageData(256, 256),
    r = rng(5);
  for (let i = 0; i < im.data.length; i += 4) {
    const v = r();
    im.data[i + 3] = v > 0.82 ? 255 * (v - 0.82) * 4 : 0;
  }
  g.putImageData(im, 0, 0);
  grainTile = c;
  return c;
}

/**
 * A watercolour wash of `color` over the polygon.
 * layers, alpha: how many faint coats and how strong each is; spread: how far the edge
 * wanders (a fraction of each edge); edge: how much pigment pools at the rim; grain: how
 * much paper shows through; clip: a polygon the wash stays inside.
 */
export function wash(ctx, poly, color, o = {}) {
  const r = rng(o.seed ?? 1);
  const spread = o.spread ?? 0.07;
  const base = deform(poly, o.iters ?? 2, spread, r);
  const [bx0, by0, bx1, by1] = bbox(base);
  const pad = Math.max(bx1 - bx0, by1 - by0) * 0.25 + 8;
  const x0 = bx0 - pad,
    y0 = by0 - pad,
    w = bx1 - bx0 + pad * 2,
    h = by1 - by0 + pad * 2;
  const m = ctx.getTransform();
  const s = Math.hypot(m.a, m.b);
  const tmp = canvas(w * s, h * s),
    t = tmp.getContext("2d");
  t.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
  t.fillStyle = color;
  t.strokeStyle = o.edgeColor ?? color;
  const layers = o.layers ?? 26,
    alpha = o.alpha ?? 0.055;
  for (let i = 0; i < layers; i++) {
    t.globalAlpha = alpha;
    trace(t, deform(base, 3, spread * (o.jitter ?? 0.8), r));
    t.fill();
  }
  const edge = o.edge ?? 1;
  if (edge > 0) {
    t.lineJoin = "round";
    for (let k = 0; k < 4; k++) {
      t.globalAlpha = alpha * edge * 1.5;
      t.lineWidth = (o.edgeW ?? 2) * (0.5 + r());
      trace(t, deform(base, 2, spread * 0.35, r));
      t.stroke();
    }
  }
  const gr = o.grain ?? 0.5;
  if (gr > 0) {
    t.globalCompositeOperation = "destination-out";
    t.globalAlpha = gr;
    t.setTransform(1, 0, 0, 1, 0, 0);
    const pat = t.createPattern(grain(), "repeat");
    pat.setTransform(new DOMMatrix().scale(Math.max(1, s * (o.grainScale ?? 0.6))));
    t.fillStyle = pat;
    t.fillRect(0, 0, tmp.width, tmp.height);
    t.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
  }
  if (o.clip && !o.soft) {
    t.globalCompositeOperation = "destination-in";
    t.globalAlpha = 1;
    t.fillStyle = "#000";
    trace(t, o.clip);
    t.fill();
  }
  ctx.save();
  if (o.clip && o.soft) {
    trace(ctx, o.clip);
    ctx.clip();
  }
  ctx.globalCompositeOperation = o.blend ?? "multiply";
  ctx.globalAlpha = o.opacity ?? 1;
  // wet on wet: the edge bleeds
  if (o.soft) ctx.filter = `blur(${Math.round(o.soft * s * 10) / 10}px)`;
  ctx.drawImage(tmp, x0, y0, w, h);
  ctx.restore();
}

/** Takes pigment away: a soft highlight lifted out of whatever is under it. */
export function lift(ctx, poly, amount = 0.6, o = {}) {
  const r = rng(o.seed ?? 9);
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  const base = deform(poly, 2, o.spread ?? 0.06, r);
  for (let i = 0; i < (o.layers ?? 10); i++) {
    ctx.globalAlpha = amount / (o.layers ?? 10);
    trace(ctx, deform(base, 2, 0.06, r));
    ctx.fill();
  }
  ctx.restore();
}

/**
 * An ink line through pts: smoothed, tapered at both ends, its width breathing as a pen's
 * pressure does. w is the full width; wobble nudges it off true.
 */
export function ink(ctx, pts, o = {}) {
  const seed = o.seed ?? 3;
  const P = o.sharp ? straight(pts, o.step ?? 3) : smooth(pts, o.step ?? 3, o.closed);
  const n = P.length;
  if (n < 2) return;
  const w = o.w ?? 2.4,
    wob = o.wobble ?? 0.8;
  const L = [],
    R = [];
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)],
      b = P[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0],
      ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const u = i / (n - 1);
    const taper = o.closed ? 1 : Math.pow(clamp(Math.min(u / (o.in ?? 0.12), (1 - u) / (o.out ?? 0.18))), 0.7);
    const pressure = 1 + (o.vary ?? 0.35) * noise(u * (o.waves ?? 5) + seed, seed);
    const hw = (w / 2) * Math.max(0.12, taper) * pressure;
    const off = wob * noise(u * 9 + seed * 3, seed + 1);
    const x = P[i][0] - ty * off,
      y = P[i][1] + tx * off;
    L.push([x - ty * hw, y + tx * hw]);
    R.push([x + ty * hw, y - tx * hw]);
  }
  ctx.save();
  ctx.fillStyle = o.color ?? "#2a1d14";
  ctx.globalAlpha = o.alpha ?? 0.9;
  ctx.beginPath();
  ctx.moveTo(L[0][0], L[0][1]);
  for (const p of L) ctx.lineTo(p[0], p[1]);
  for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A sheet of paper: a ground colour, slow mottling, tooth, a few fibres, darker edges. */
export function paper(w, h, o = {}) {
  const c = canvas(w, h),
    g = c.getContext("2d"),
    r = rng(o.seed ?? 11);
  g.fillStyle = o.color ?? "#efe6d3";
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < (o.mottle ?? 160); i++) {
    const x = r() * w,
      y = r() * h,
      R = (60 + r() * 260) * (o.scale ?? 1);
    const gr = g.createRadialGradient(x, y, 0, x, y, R);
    const dark = r() < 0.5;
    gr.addColorStop(0, dark ? "rgba(130,98,56,0.022)" : "rgba(255,252,240,0.05)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(x - R, y - R, R * 2, R * 2);
  }
  // tooth
  const im = g.getImageData(0, 0, w, h),
    d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (r() + r() - 1) * (o.tooth ?? 7);
    d[i] += v;
    d[i + 1] += v;
    d[i + 2] += v * 0.9;
  }
  g.putImageData(im, 0, 0);
  g.strokeStyle = "rgba(110,85,50,0.05)";
  g.lineWidth = 1;
  for (let i = 0; i < (o.fibres ?? 260); i++) {
    const x = r() * w,
      y = r() * h,
      a = r() * Math.PI,
      l = 8 + r() * 26;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 4, y + Math.sin(a) * l * 0.5 - 4, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  if (o.vignette !== 0) {
    const gr = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
    gr.addColorStop(0, "rgba(0,0,0,0)");
    gr.addColorStop(1, `rgba(110,80,45,${o.vignette ?? 0.12})`);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }
  return c;
}

/** A sprite: a transparent canvas painted at `res` times its size, drawn back at 1×. */
export function sprite(w, h, res, paint) {
  const c = canvas(w * res, h * res),
    g = c.getContext("2d");
  g.setTransform(res, 0, 0, res, 0, 0);
  paint(g);
  c.__w = w;
  c.__h = h;
  return c;
}
export const lerpPt = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];

/**
 * A painting built up object by object. Each object is painted on its own sheet and then
 * laid down with multiply; before that, the paper under its silhouette is restored, so what
 * it covers is hidden the way an opaque thing hides what is behind it.
 */
export class Painting {
  constructor(w, h, paperOpts) {
    this.w = w;
    this.h = h;
    this.pristine = paper(w, h, paperOpts);
    this.c = canvas(w, h);
    this.g = this.c.getContext("2d");
    this.g.drawImage(this.pristine, 0, 0);
  }
  /** box: [x, y, w, h] the object stays inside; paint(g) draws it; mask(g) fills its silhouette. */
  put(box, paint, mask) {
    const [x, y, w, h] = box.map(Math.round);
    if (mask) {
      const M = canvas(w, h),
        mg = M.getContext("2d");
      mg.translate(-x, -y);
      mg.fillStyle = mg.strokeStyle = "#000";
      mask(mg);
      mg.setTransform(1, 0, 0, 1, 0, 0);
      mg.globalCompositeOperation = "source-in";
      mg.drawImage(this.pristine, x, y, w, h, 0, 0, w, h);
      this.g.drawImage(M, x, y);
    }
    const L = canvas(w, h),
      lg = L.getContext("2d");
    lg.translate(-x, -y);
    paint(lg);
    this.g.save();
    this.g.globalCompositeOperation = "multiply";
    this.g.drawImage(L, x, y);
    this.g.restore();
  }
}
/** Fills a polygon as a path, for masks. */
export function fillPoly(g, P) {
  trace(g, P);
  g.fill();
}

let paperTile = null;
/** A tile of plain paper, to underpaint solid things on transparent sheets. */
export function paperPattern(g) {
  if (!paperTile) paperTile = paper(512, 512, { seed: 99, color: "#f1e7d3", mottle: 30, fibres: 40, vignette: 0 });
  return g.createPattern(paperTile, "repeat");
}
/**
 * A transparent sheet, for a layer that sits over others. Washes laid straight on it stay
 * transparent; a thing put with a mask is first underpainted with paper inside its
 * silhouette, so it hides whatever is behind, in this layer and the layers below.
 */
export class Sheet {
  constructor(w, h, res = 1, x = 0, y = 0) {
    this.x = x;
    this.y = y;
    this.res = res;
    this.c = canvas(w * res, h * res);
    this.g = this.c.getContext("2d");
    this.g.setTransform(res, 0, 0, res, -x * res, -y * res);
  }
  put(box, paint, mask) {
    const [x, y, w, h] = box;
    const res = this.res;
    if (mask) {
      this.g.save();
      this.g.fillStyle = this.g.strokeStyle = paperPattern(this.g);
      mask(this.g);
      this.g.restore();
    }
    const L = canvas(w * res, h * res),
      lg = L.getContext("2d");
    lg.setTransform(res, 0, 0, res, -x * res, -y * res);
    paint(lg);
    this.g.save();
    this.g.globalCompositeOperation = "multiply";
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    this.g.drawImage(L, (x - this.x) * res, (y - this.y) * res);
    this.g.restore();
  }
  /** Draws straight onto the sheet. */
  paint(fn) {
    fn(this.g);
  }
}

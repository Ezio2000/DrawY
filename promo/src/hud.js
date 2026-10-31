// What floats over the paper in screen space: the pencil, the cursor, captions, the
// composer, the title with its scene path, and the viewfinder of view_canvas.
import { div, svg, css, attr, show, clamp, lerp, prog, ease, window_, cue, random } from "./lib.js";

const f1 = (n) => Math.round(n * 10) / 10;

// ---------- pencil ----------
export class Pencil {
  constructor(parent) {
    this.root = div("abs", parent);
    const s = svg("svg", { width: 300, height: 300, viewBox: "-30 -150 300 300", style: "position:absolute;left:-30px;top:-150px;overflow:visible" }, this.root);
    this.shadowG = svg("g", { opacity: 0.16, filter: "url(#penShadow)" }, s);
    this.bodyG = svg("g", {}, s);
    const draw = (g, shadow) => {
      const st = shadow ? { fill: "#3a2a10" } : null;
      const P = (d, fill, extra = {}) =>
        svg("path", { d, fill: st ? st.fill : fill, stroke: st ? "none" : "#3a352c", "stroke-width": 2, "stroke-linejoin": "round", ...extra }, g);
      P("M44 -14 L178 -14 L178 14 L44 14 Z", "#e9a93a");
      if (!shadow) {
        P("M44 5 L178 5 L178 14 L44 14 Z", "#d18f27", { stroke: "none" });
        P("M44 -10 L178 -10 L178 -5 L44 -5 Z", "#f6c76e", { stroke: "none" });
        P("M44 -14 L178 -14 L178 14 L44 14 Z", "none");
      }
      P("M178 -14 L200 -14 L200 14 L178 14 Z", "#c15f3c");
      if (!shadow) {
        svg("path", { d: "M184 -14 L184 14 M190 -14 L190 14", stroke: "#8f4327", "stroke-width": 1.6 }, g);
      }
      P("M200 -13 L216 -13 Q226 -13 226 0 Q226 13 216 13 L200 13 Z", "#e8a28e");
      P("M44 -14 Q40 -9 44 -4 Q40 0 44 4 Q40 9 44 14 L13 4.6 L13 -4.6 Z", "#f3dfbd");
      P("M13 -4.6 L0 0 L13 4.6 Z", "#3a352c");
    };
    draw(this.shadowG, true);
    draw(this.bodyG, false);
    this.prev = null;
  }
  /** Places the point at screen (x, y); `lift` raises it off the paper. */
  update(state, angle = -38) {
    if (!state) {
      show(this.root, false);
      return;
    }
    show(this.root, true);
    const { x, y, lift = 0, alpha = 1, scale = 1 } = state;
    const L = clamp(lift);
    css(this.root, "transform", `translate(${f1(x)}px, ${f1(y)}px)`);
    css(this.root, "opacity", String(alpha));
    const sc = scale * (1 + 0.05 * L);
    attr(this.bodyG, "transform", `translate(${f1(-8 * L)} ${f1(-14 * L)}) rotate(${angle}) scale(${sc})`);
    attr(this.shadowG, "transform", `translate(${f1(10 + 18 * L)} ${f1(14 + 22 * L)}) rotate(${angle}) scale(${sc})`);
    attr(this.shadowG, "opacity", String(f1((0.16 - 0.06 * L) * 100) / 100));
  }
}

// ---------- cursor ----------
export class Cursor {
  constructor(parent) {
    this.root = div("abs", parent);
    this.ring = div("ripple", parent);
    const s = svg("svg", { width: 60, height: 70, viewBox: "-2 -2 30 38", style: "position:absolute;left:-3px;top:-3px;overflow:visible;filter:drop-shadow(0 4px 6px rgba(0,0,0,.18))" }, this.root);
    svg("path", { d: "M1 1 L1 27 L7.6 21 L12 31 L16.4 29 L12.2 19.6 L21 19.6 Z", fill: "#fff", stroke: "#141413", "stroke-width": 1.8, "stroke-linejoin": "round" }, s);
  }
  /** x, y in screen space; `press` 0..1 squeezes it; `ripple` 0..1 rings out from the point. */
  update(st) {
    if (!st) {
      show(this.root, false);
      show(this.ring, false);
      return;
    }
    show(this.root, true);
    css(this.root, "transform", `translate(${f1(st.x)}px, ${f1(st.y)}px) scale(${f1((1.5 - 0.22 * (st.press || 0)) * 100) / 100})`);
    css(this.root, "opacity", String(st.alpha ?? 1));
    const rp = st.ripple || 0;
    if (rp > 0 && rp < 1) {
      show(this.ring, true);
      const R = 12 + 70 * ease.out(rp);
      css(this.ring, "left", f1(st.x - R) + "px");
      css(this.ring, "top", f1(st.y - R) + "px");
      css(this.ring, "width", f1(R * 2) + "px");
      css(this.ring, "height", f1(R * 2) + "px");
      css(this.ring, "opacity", String(f1((1 - rp) * 100) / 100));
    } else show(this.ring, false);
  }
}

/** A cursor path: glides from a to b over [t0, t1], clicks at tc. */
export function cursorAt(t, { from, to, t0, t1, tc, out, target }) {
  if (t < t0 - 0.3 || t > out + 0.3) return null;
  const goal = target ? target(t) : to;
  const k = ease.inOut(prog(t, t0, t1));
  // a gentle arc on the way
  const mx = lerp(from[0], goal[0], k),
    my = lerp(from[1], goal[1], k) - Math.sin(k * Math.PI) * 60;
  const press = t >= tc - 0.08 && t <= tc + 0.12 ? Math.sin(prog(t, tc - 0.08, tc + 0.12) * Math.PI) : 0;
  const ripple = prog(t, tc, tc + 0.55);
  const alpha = Math.min(prog(t, t0 - 0.3, t0), 1 - prog(t, out, out + 0.3));
  return { x: mx, y: my, press, ripple: t >= tc ? ripple : 0, alpha };
}

// ---------- captions ----------
/** A line of type that rises in a character at a time, with a highlighter swept under
 * the words that matter, and an English line beneath. */
export class Caption {
  constructor(parent, { zh, en, t0, t1, y = 112, marks = [], size, cues = true }) {
    this.t0 = t0;
    this.t1 = t1;
    this.root = div("caption", parent, { top: y + "px" });
    const zhEl = div("zh", this.root);
    if (size) zhEl.style.fontSize = size + "px";
    this.chars = [];
    this.marks = [];
    // split zh into runs, marked or not
    let i = 0;
    const text = zh;
    const ranges = marks
      .map((m) => {
        const at = text.indexOf(m);
        return [at, at + m.length];
      })
      .filter((r) => r[0] >= 0)
      .sort((a, b) => a[0] - b[0]);
    let n = 0;
    const put = (str, host) => {
      for (const ch of str) {
        const s = document.createElement("span");
        s.textContent = ch;
        host.appendChild(s);
        this.chars.push({ el: s, i: n++ });
      }
    };
    for (const [a, b] of ranges) {
      put(text.slice(i, a), zhEl);
      const m = document.createElement("span");
      m.className = "mark";
      zhEl.appendChild(m);
      put(text.slice(a, b), m);
      this.marks.push({ el: m, at: a });
      i = b;
    }
    put(text.slice(i), zhEl);
    this.en = en ? div("en", this.root) : null;
    if (this.en) this.en.textContent = en;
    if (cues) {
      cue(t0, "caption");
      this.marks.forEach((m, k) => cue(t0 + 0.38 + m.at * 0.035 + k * 0.15, "marker"));
    }
  }
  update(t) {
    const on = t > this.t0 - 0.05 && t < this.t1 + 0.05;
    show(this.root, on);
    if (!on) return;
    const out = ease.in2(prog(t, this.t1 - 0.4, this.t1));
    css(this.root, "opacity", String(f1((1 - out) * 100) / 100));
    css(this.root, "transform", `translateY(${f1(-14 * out)}px)`);
    for (const c of this.chars) {
      const p = ease.out(prog(t, this.t0 + c.i * 0.035, this.t0 + c.i * 0.035 + 0.5));
      css(c.el, "opacity", String(f1(p * 100) / 100));
      css(c.el, "transform", `translateY(${f1((1 - p) * 26)}px)`);
      css(c.el, "filter", p < 1 ? `blur(${f1((1 - p) * 6)}px)` : "none");
    }
    this.marks.forEach((m, k) => {
      const a = this.t0 + 0.38 + m.at * 0.035 + k * 0.15;
      const p = ease.inOut2(prog(t, a, a + 0.42));
      css(m.el, "backgroundSize", `${f1(p * 100)}% 100%`);
    });
    if (this.en) {
      const p = ease.out(prog(t, this.t0 + 0.3, this.t0 + 0.9));
      css(this.en, "opacity", String(f1(p * 100) / 100));
      css(this.en, "transform", `translateY(${f1((1 - p) * 12)}px)`);
    }
  }
}

// ---------- marks ----------
/** The brand's spark: a terracotta star and a small lamp-yellow one. */
export function sparkSvg(parent, size = 30) {
  const s = svg("svg", { width: size, height: size, viewBox: "0 0 24 24", style: "overflow:visible;flex:none" }, parent);
  const big = svg("path", { d: "M10.6 3.3c.6 4.2 2.4 6.6 7 7.6-4.4 1-6.4 3.3-7 7.8-.8-4.4-2.9-6.7-7.1-7.7 4.4-1 6.3-3.4 7.1-7.7z", fill: "#d97757", style: "transform-origin:10.6px 11px" }, s);
  const small = svg("path", { d: "M18.7 14.2c.3 1.4.9 2.1 2.4 2.4-1.4.3-2.1 1.1-2.4 2.5-.3-1.4-1-2.2-2.4-2.5 1.4-.3 2.1-1 2.4-2.4z", fill: "#e9a93a", style: "transform-origin:18.7px 16.6px" }, s);
  return {
    el: s,
    twinkle(t, on = 1) {
      const a = on ? 1 + 0.16 * Math.sin(t * 5.2) : 1;
      const b = on ? 0.75 + 0.35 * Math.sin(t * 7.1 + 1.2) : 1;
      css(big, "transform", `scale(${f1(a * 100) / 100}) rotate(${on ? f1(Math.sin(t * 2.6) * 10) : 0}deg)`);
      css(small, "transform", `scale(${f1(b * 100) / 100})`);
    },
  };
}

/** The brand's lantern, as strokes the pencil can draw. Coordinates in its 24-unit box. */
export const LANTERN = {
  frame: [
    "M10.5 4.3c-.4-1.7 3.3-2 3.1-.2",
    "M8 6.6c1.2-1.6 6.7-1.7 8 0",
    "M6.9 6.9c3.4-.5 6.9-.4 10.3.2",
    "M8.4 7.4c-.8 3.7-.9 7.7-.3 11.5",
    "M15.7 7.3c.8 3.9.7 7.9.1 11.7",
    "M6.5 19.2c3.7-.6 7.5-.4 11.1.3",
    "M8.3 21.3c2.6.4 5.2.3 7.6-.3",
  ],
  rays: ["M3.7 7.4c.6.2 1.1.5 1.6.9", "M20.4 7.2c-.6.2-1.1.6-1.5 1", "M5.1 3.6c.4.5.8 1.1 1.1 1.7", "M18.8 3.5c-.4.5-.7 1.1-1 1.8"],
  candle: "M10.7 16.7c.9-.2 1.8-.2 2.7 0l-.1 2.2c-.8.2-1.7.2-2.5 0z",
  flame: "M12.1 10c1.6 1.7 2.1 2.9 2 3.9a2 2 0 0 1-4 .1c-.1-1.1.5-2.4 2-4z",
};

export function lanternSvg(parent, size) {
  const s = svg("svg", { width: size, height: size, viewBox: "0 0 24 24", style: "overflow:visible;flex:none" }, parent);
  svg("circle", { cx: 12, cy: 13.6, r: 5.2, fill: "#e9a93a", opacity: 0.16 }, s);
  const g = svg("g", { fill: "none", stroke: "#d97757", "stroke-width": 1.55, "stroke-linecap": "round", "stroke-linejoin": "round" }, s);
  LANTERN.frame.forEach((d) => svg("path", { d }, g));
  LANTERN.rays.forEach((d) => svg("path", { d, stroke: "#e9a93a", "stroke-width": 1.6 }, g));
  svg("path", { d: LANTERN.candle, fill: "#d97757", "fill-opacity": 0.85, "stroke-width": 0.9 }, g);
  svg("path", { d: LANTERN.flame, fill: "#e9a93a", stroke: "#e08f2c", "stroke-width": 0.7 }, g);
  return s;
}

// ---------- viewfinder ----------
export class Finder {
  constructor(parent, label) {
    this.root = div("finder", parent);
    for (let i = 0; i < 4; i++) this.root.appendChild(document.createElement("i"));
    this.flash = div("flash", this.root);
    this.tag = div("tag", this.root);
    this.tag.textContent = label;
  }
  update(st) {
    if (!st) return show(this.root, false);
    show(this.root, true);
    css(this.root, "left", f1(st.x) + "px");
    css(this.root, "top", f1(st.y) + "px");
    css(this.root, "width", f1(st.w) + "px");
    css(this.root, "height", f1(st.h) + "px");
    css(this.root, "opacity", String(f1(st.alpha * 100) / 100));
    css(this.flash, "opacity", String(f1((st.flash || 0) * 60) / 100));
    if (st.label !== undefined && this.tag.textContent !== st.label) this.tag.textContent = st.label;
  }
}

/** A grain of paper, laid over everything. */
export function paperGrain(parent) {
  const c = document.createElement("canvas");
  c.width = 960;
  c.height = 540;
  c.className = "grain";
  c.style.width = "1920px";
  c.style.height = "1080px";
  const g = c.getContext("2d");
  const im = g.createImageData(960, 540);
  const r = random(99);
  for (let i = 0; i < im.data.length; i += 4) {
    const v = 236 + Math.floor((r() + r() + r()) / 3 * 19);
    im.data[i] = v;
    im.data[i + 1] = v - 2;
    im.data[i + 2] = v - 6;
    im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  // a few long fibres
  g.globalAlpha = 0.05;
  g.strokeStyle = "#7a6a50";
  for (let k = 0; k < 220; k++) {
    const x = r() * 960,
      y = r() * 540,
      a = r() * Math.PI,
      l = 6 + r() * 22;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 3, y + Math.sin(a) * l * 0.5 - 3, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  c.style.opacity = "0.32";
  parent.appendChild(c);
  return c;
}

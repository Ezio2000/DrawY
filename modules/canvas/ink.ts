import type { Point } from "../contracts/index.ts";

/** A stretch of drawing the pen follows, timed in ms from when the drawing begins. */
export interface Mark {
  start: number;
  duration: number;
  /** The pen's tip in client coordinates, part way through the stroke. */
  tip: (progress: number) => Point | null;
}
interface Line {
  el: SVGGeometryElement;
  length: number;
  /** Screen pixels per unit of length, so every line is drawn at the same speed. */
  pixels: number;
  fill: string | null;
  opacity: string;
}
interface Sweep {
  el: Element;
  kind: "wash" | "word" | "picture";
  opacity: string;
}
/** A drawn module or link as an illustrator puts it on paper: its outlines first, drawn
 * along their length, then colour washed in, pictures developed and words written, each
 * in the reading direction. */
export interface Plan {
  host: HTMLElement;
  lines: Line[][];
  sweeps: Sweep[];
  /** Natural duration in ms before any compression. */
  time: number;
}
const unseen =
  "defs,marker,clipPath,mask,pattern,symbol,linearGradient,radialGradient,filter,title,desc,style,script";
const SPEED = 1.3; // screen px per ms
const line = (l: Line) =>
  Math.min(650, Math.max(90, (l.length * l.pixels) / SPEED));
const sweepTime = { wash: 620, word: 420, picture: 950 };
const ease = "cubic-bezier(0.45, 0.05, 0.35, 1)";

function scaleOf(el: SVGGraphicsElement) {
  const m = el.getScreenCTM();
  return m ? Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) : 1;
}
function ownText(el: Element) {
  for (const n of el.childNodes)
    if (n.nodeType === Node.TEXT_NODE && n.textContent!.trim()) return true;
  return false;
}
function clear(value: string) {
  return (
    value === "none" ||
    /^rgba\(.*,\s*0\)$/.test(value) ||
    value === "transparent"
  );
}
export function plan(host: HTMLElement): Plan {
  const root = host.shadowRoot!;
  const lines: Line[] = [],
    sweeps: Sweep[] = [],
    words: Element[] = [];
  for (const el of root.querySelectorAll("*")) {
    if (el.closest(unseen)) continue;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (el instanceof SVGGeometryElement) {
      const stroked = !clear(style.stroke) && parseFloat(style.strokeWidth) > 0,
        filled = !clear(style.fill) && style.fillOpacity !== "0";
      let length = 0;
      try {
        length = el.getTotalLength();
      } catch {}
      if (stroked && style.strokeDasharray === "none" && length > 0)
        lines.push({
          el,
          length,
          pixels: scaleOf(el),
          fill: filled ? style.fillOpacity : null,
          opacity: style.strokeOpacity,
        });
      else if (stroked || filled)
        sweeps.push({ el, kind: "wash", opacity: style.opacity });
    } else if (el instanceof SVGTextElement) {
      sweeps.push({ el, kind: "word", opacity: style.opacity });
    } else if (
      el instanceof SVGImageElement ||
      el instanceof HTMLImageElement ||
      el instanceof HTMLCanvasElement
    ) {
      sweeps.push({ el, kind: "picture", opacity: style.opacity });
    } else if (
      el instanceof HTMLElement &&
      ownText(el) &&
      !words.some((w) => w.contains(el))
    ) {
      words.push(el);
      sweeps.push({ el, kind: "word", opacity: style.opacity });
    }
  }
  // Up to a dozen strokes follow one another; denser drawings draw a few lines at once.
  const per = Math.ceil(lines.length / 12),
    groups: Line[][] = [];
  for (let i = 0; i < lines.length; i += per)
    groups.push(lines.slice(i, i + per));
  const drawn = groups.reduce((sum, g) => sum + Math.max(...g.map(line)), 0),
    sweepStart = drawn * 0.55,
    sweepEnd = sweeps.length
      ? sweepStart +
        Math.min(900, sweeps.length * 70) +
        Math.max(...sweeps.map((s) => sweepTime[s.kind]))
      : 0;
  return {
    host,
    lines: groups,
    sweeps,
    time: Math.max(
      drawn + (lines.some((l) => l.fill) ? 450 : 0),
      sweepEnd,
      lines.length || sweeps.length ? 0 : 900,
    ),
  };
}
function across(el: Element, kind: Sweep["kind"]) {
  return (p: number) => {
    const b = el.getBoundingClientRect();
    if (!b.width && !b.height) return null;
    return {
      x: b.left + b.width * p,
      y:
        kind === "word"
          ? b.top + b.height * 0.78
          : b.top + b.height * (0.5 + 0.28 * Math.sin(p * Math.PI * 3)),
    };
  };
}
/** Follows a path from its start to its end. */
export function along(el: SVGGeometryElement) {
  const length = el.getTotalLength();
  return (p: number) => {
    const m = el.getScreenCTM();
    if (!m) return null;
    const q = el.getPointAtLength(p * length);
    const r = new DOMPoint(q.x, q.y).matrixTransform(m);
    return { x: r.x, y: r.y };
  };
}
/** Puts a planned drawing on paper starting `start` ms from now, every duration scaled by
 * `pace`, and returns the marks for the pen to follow. */
export function play(p: Plan, start: number, pace: number): Mark[] {
  const marks: Mark[] = [];
  const at = (ms: number) => start + ms * pace,
    span = (ms: number) => Math.max(60, ms * pace);
  // Whatever the plan cannot see stays hidden until the pen reaches this drawing.
  p.host.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: 160,
    delay: start,
    fill: "backwards",
  });
  if (!p.lines.length && !p.sweeps.length) {
    const brush =
      "linear-gradient(100deg,#000 38%,rgba(0,0,0,.35) 50%,transparent 62%)";
    p.host.animate(
      [
        {
          maskImage: brush,
          WebkitMaskImage: brush,
          maskSize: "280% 100%",
          WebkitMaskSize: "280% 100%",
          maskPosition: "100% 0",
          WebkitMaskPosition: "100% 0",
        },
        {
          maskImage: brush,
          WebkitMaskImage: brush,
          maskSize: "280% 100%",
          WebkitMaskSize: "280% 100%",
          maskPosition: "0 0",
          WebkitMaskPosition: "0 0",
        },
      ],
      { duration: span(p.time), delay: start, easing: ease, fill: "backwards" },
    );
    marks.push({ start, duration: span(p.time), tip: across(p.host, "wash") });
    return marks;
  }
  let t = 0;
  for (const group of p.lines) {
    const longest = group.reduce((a, b) =>
      a.length * a.pixels > b.length * b.pixels ? a : b,
    );
    const duration = Math.max(...group.map(line));
    for (const l of group) {
      const own = line(l),
        dash = Number(l.el.getAttribute("pathLength")) || l.length;
      l.el.animate(
        [
          {
            strokeDasharray: `${dash} ${dash}`,
            strokeDashoffset: dash,
            strokeOpacity: 0,
          },
          { strokeOpacity: l.opacity, offset: 0.04 },
          {
            strokeDasharray: `${dash} ${dash}`,
            strokeDashoffset: 0,
            strokeOpacity: l.opacity,
          },
        ],
        { duration: span(own), delay: at(t), easing: ease, fill: "backwards" },
      );
      if (l.fill)
        l.el.animate([{ fillOpacity: 0 }, { fillOpacity: l.fill }], {
          duration: span(450),
          delay: at(t + own * 0.8),
          easing: "ease-out",
          fill: "backwards",
        });
    }
    marks.push({
      start: at(t),
      duration: span(duration),
      tip: along(longest.el),
    });
    t += duration;
  }
  let s = t * 0.55;
  const gap = Math.min(70, 900 / Math.max(1, p.sweeps.length));
  for (const sweep of p.sweeps) {
    const duration = sweepTime[sweep.kind],
      html = sweep.el instanceof HTMLElement;
    sweep.el.animate(
      [
        {
          clipPath: "inset(-15% 100% -15% -15%)",
          opacity: 0,
          ...(html ? { filter: "blur(4px)" } : {}),
        },
        {
          clipPath: "inset(-15% -15% -15% -15%)",
          opacity: sweep.opacity,
          ...(html ? { filter: "blur(0)" } : {}),
        },
      ],
      {
        duration: span(duration),
        delay: at(s),
        easing: "cubic-bezier(0.3, 0.1, 0.3, 1)",
        fill: "backwards",
      },
    );
    if (sweep.kind !== "wash" || sweep.el.getBoundingClientRect().width > 40)
      marks.push({
        start: at(s),
        duration: span(duration),
        tip: across(sweep.el, sweep.kind),
      });
    s += gap;
  }
  return marks;
}

/** A loose pencil outline for a module still being laid out: an oval around compact
 * shapes and a rounded box around long ones, wavering slightly and running on past where
 * it began, as a hand blocks in a composition. */
export function gesture(width: number, height: number, seed: number) {
  let state = seed >>> 0 || 1;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const ratio = width / height,
    oval = ratio > 0.6 && ratio < 1.7,
    n = 30,
    from = -Math.PI * (0.7 + random() * 0.2),
    points: Point[] = [];
  for (let i = 0; i <= n + 4; i++) {
    const a = from + (i / n) * Math.PI * 2,
      grow = 1 + 0.035 * (i / n) + (random() - 0.5) * 0.025,
      c = Math.cos(a),
      s = Math.sin(a),
      // A squarish superellipse for boxes, a plain ellipse for ovals.
      e = oval ? 1 : 0.42,
      x = Math.sign(c) * Math.abs(c) ** e,
      y = Math.sign(s) * Math.abs(s) ** e;
    points.push({
      x: width / 2 + x * (width / 2) * (oval ? 0.93 : 0.96) * grow,
      y: height / 2 + y * (height / 2) * (oval ? 0.93 : 0.96) * grow,
    });
  }
  const f = (v: number) => Math.round(v * 10) / 10;
  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i - 1] || points[i],
      b = points[i],
      c = points[i + 1],
      e = points[i + 2] || c;
    d += `C${f(b.x + (c.x - a.x) / 6)} ${f(b.y + (c.y - a.y) / 6)} ${f(c.x - (e.x - b.x) / 6)} ${f(c.y - (e.y - b.y) / 6)} ${f(c.x)} ${f(c.y)}`;
  }
  return d;
}

/** Loose diagonal shading on one side of a pencilled outline, leaving its name in the middle
 * clear; `across` mirrors it for cross-hatching. Strokes run at 45° on the page whatever the
 * shape's proportions, clipped to the oval inside it. */
export function hatching(
  width: number,
  height: number,
  seed: number,
  across = false,
) {
  let state = (seed ^ 0x9e3779b9) >>> 0 || 1;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const A = 1 / (0.4 * width) ** 2,
    B = 1 / (0.4 * height) ** 2,
    // Distance from the centre to the oval along the lower-right diagonal.
    reach = Math.sqrt(2 / (A + B)),
    gap = Math.min(14, Math.max(4, Math.min(width, height) / 12)),
    f = (v: number) => Math.round(v * 10) / 10;
  let d = "";
  for (let s = reach * 0.22, n = 0; s < reach * 0.92 && n < 14; s += gap, n++) {
    // Points (s+t, s-t)/√2 from the centre on the oval (x²A + y²B = 1).
    const a = A + B,
      b = 2 * s * (A - B),
      c = s * s * a - 2,
      root = b * b - 4 * a * c;
    if (root <= 0) break;
    const t1 = (-b - Math.sqrt(root)) / (2 * a),
      t2 = (-b + Math.sqrt(root)) / (2 * a),
      trim = (t2 - t1) * (0.04 + random() * 0.12),
      end = (t: number) =>
        `${f(width / 2 + ((across ? -1 : 1) * (s + t)) / Math.SQRT2)} ${f(height / 2 + (s - t) / Math.SQRT2)}`;
    d += `M${end(t1 + trim)}L${end(t2 - trim * random())}`;
  }
  return d;
}

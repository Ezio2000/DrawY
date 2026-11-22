import { cx } from "./cx.ts";
import { random } from "./pen.tsx";

/* The interface's icons, drawn by hand like the lantern and the panel mark: each side of a
 * shape bows a little, strokes run on a little past where they start and end, rings
 * overlap where they close, and some carry one touch of the blue pencil. Every stroke is
 * worked out once, from points on a 24-unit grid and a seed, so an icon looks the same
 * each time it is drawn. */

type Pt = readonly [number, number];
type Part = { d: string; tone?: "accent" | "fill" };

const f = (n: number) => Math.round(n * 100) / 100;
const at = ([x, y]: Pt) => `${f(x)} ${f(y)}`;

/** A point `d` units on from `a`, away from `b`. */
function past(a: Pt, b: Pt, d: number): Pt {
  const len = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
  return [a[0] + ((a[0] - b[0]) / len) * d, a[1] + ((a[1] - b[1]) / len) * d];
}

/** Straight strokes from point to point: each side bowed a little one way or the other,
 * the stroke run on past its two ends. */
function lines(points: Pt[], seed: number, { bow = 0.7, over = 0.75 } = {}) {
  const r = random(seed);
  const p = [...points];
  if (over) {
    p[0] = past(p[0], p[1], over * (0.4 + r() * 0.6));
    p[p.length - 1] = past(p[p.length - 1], p[p.length - 2], over * (0.4 + r() * 0.6));
  }
  let d = "M" + at(p[0]);
  for (let i = 1; i < p.length; i++) {
    const [ax, ay] = p[i - 1],
      [bx, by] = p[i];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const k = (r() - 0.5) * 2 * bow * Math.min(1, len / 9);
    d += `Q${at([(ax + bx) / 2 - ((by - ay) / len) * k, (ay + by) / 2 + ((bx - ax) / len) * k])} ${at(p[i])}`;
  }
  return d;
}

/** A closed shape, drawn round once and on a little over its first side. */
const shape = (points: Pt[], seed: number) =>
  lines([...points, points[0], [points[0][0] + (points[1][0] - points[0][0]) * 0.22, points[0][1] + (points[1][1] - points[0][1]) * 0.22]], seed, {
    over: 0,
  });

/** A smooth stroke through points, each nudged a little (Catmull-Rom, as cubic curves). */
function curve(points: Pt[], seed: number, nudge = 0.25) {
  const r = random(seed);
  const p = points.map(([x, y]) => [x + (r() - 0.5) * 2 * nudge, y + (r() - 0.5) * 2 * nudge] as Pt);
  let d = "M" + at(p[0]);
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i - 1] ?? p[i],
      b = p[i],
      c = p[i + 1],
      e = p[i + 2] ?? c;
    d += `C${at([b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6])} ${at([c[0] - (e[0] - b[0]) / 6, c[1] - (e[1] - b[1]) / 6])} ${at(c)}`;
  }
  return d;
}

/** A ring or an arc round (cx, cy): never quite round, and a whole ring overlaps where it
 * closes. `from` and `sweep` are in radians, clockwise on screen. */
function ring(cx: number, cy: number, rx: number, ry: number, seed: number, from = -2, sweep = Math.PI * 2 + 0.5) {
  const r = random(seed);
  const n = Math.max(6, Math.round(Math.abs(sweep) / 0.45));
  const phase = r() * Math.PI * 2,
    drift = (r() - 0.5) * 0.1;
  const points: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = from + (sweep * i) / n,
      s = 1 + 0.04 * Math.sin(2 * a + phase) + (drift * i) / n;
    points.push([cx + rx * s * Math.cos(a), cy + ry * s * Math.sin(a)]);
  }
  return curve(points, seed + 1, 0);
}

/** An icon from its parts; `fill` parts are tinted with the blue pencil under their line,
 * `accent` ones are drawn in it. */
function icon(name: string, draw: (seed: () => number) => Part[]) {
  let n = 0;
  for (const ch of name) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  const parts = draw(() => (n = (n * 1103515245 + 12345) >>> 0));
  function Icon({ size = 18, className }: { size?: number; className?: string }) {
    return (
      <svg
        className={cx(`hand-mark hand-icon${className ? ` ${className}` : ""}`)}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden
      >
        {parts.map((p, i) =>
          p.tone === "fill" ? (
            <g key={i}>
              <path className={cx("mark-accent-fill")} d={p.d} />
              <path d={p.d} />
            </g>
          ) : (
            <path key={i} className={p.tone === "accent" ? cx("mark-accent") : undefined} d={p.d} />
          ),
        )}
      </svg>
    );
  }
  Icon.displayName = name;
  return Icon;
}

export type HandIcon = ReturnType<typeof icon>;

export const Home = icon("Home", (s) => [
  { d: lines([[3.2, 11.4], [12, 3.6], [20.8, 11.4]], s()) },
  { d: lines([[5.7, 9.8], [5.7, 19.9], [18.3, 19.9], [18.3, 9.8]], s()) },
  { d: lines([[10.1, 19.9], [10.1, 14.6], [13.9, 14.6], [13.9, 19.9]], s(), { over: 0 }), tone: "fill" },
]);

export const Library = icon("Library", (s) => [
  { d: shape([[12, 3.3], [16.4, 10.3], [7.6, 10.3]], s()) },
  { d: shape([[3.9, 13.6], [10.1, 13.6], [10.1, 19.8], [3.9, 19.8]], s()) },
  { d: ring(17, 16.7, 3.2, 3.2, s()), tone: "fill" },
]);

export const Undo = icon("Undo", (s) => [
  { d: lines([[8.9, 4.5], [4.3, 9.1], [8.9, 13.7]], s()) },
  { d: curve([[4.8, 9.1], [10, 9], [14.6, 9.1], [18.5, 10.9], [19.9, 14.5], [18.4, 18.3], [14.6, 19.9], [10.4, 19.9]], s(), 0.15) },
]);

export const Pencil = icon("Pencil", (s) => [
  { d: shape([[16, 4.2], [19.8, 8], [8.9, 18.9], [4.2, 19.8], [5.1, 15.1]], s()) },
  { d: lines([[13.4, 6.9], [17.1, 10.6]], s(), { over: 0.2 }) },
  { d: lines([[12.6, 20.4], [20.3, 20.3]], s()), tone: "accent" },
]);

export const Talk = icon("Talk", (s) => [
  { d: lines([[14.2, 8.2], [14.2, 4.2], [3.8, 4.2], [3.8, 11.4], [5.2, 11.4], [5.2, 13.9], [7.8, 11.4], [8.6, 11.4]], s()) },
  {
    d: shape([[10.2, 8.8], [20.3, 8.8], [20.3, 16], [18.9, 16], [18.9, 18.7], [16.1, 16], [10.2, 16]], s()),
    tone: "fill",
  },
]);

export const Versions = icon("Versions", (s) => [
  { d: ring(12.4, 12.3, 7.7, 7.7, s(), Math.PI + 0.3, -Math.PI * 1.83) },
  { d: lines([[6.9, 2.8], [6.9, 7], [11.1, 7]], s(), { over: 0.3 }) },
  { d: lines([[12.4, 8.3], [12.4, 12.6], [15.3, 14.3]], s(), { over: 0.2 }), tone: "accent" },
]);

export const Export = icon("Export", (s) => [
  { d: lines([[12, 3.5], [12, 14.2]], s()), tone: "accent" },
  { d: lines([[7.8, 10.2], [12, 14.4], [16.2, 10.2]], s()), tone: "accent" },
  { d: lines([[4, 14.6], [4, 19.7], [20, 19.7], [20, 14.6]], s()) },
]);

export const Settings = icon("Settings", (s) => [
  { d: lines([[3.8, 7.4], [12.2, 7.4]], s()) },
  { d: lines([[17.2, 7.4], [20.2, 7.4]], s()) },
  { d: ring(14.7, 7.4, 2.4, 2.4, s()), tone: "fill" },
  { d: lines([[3.8, 16.6], [6.4, 16.6]], s()) },
  { d: lines([[11.4, 16.6], [20.2, 16.6]], s()) },
  { d: ring(8.9, 16.6, 2.4, 2.4, s()) },
]);

export const Records = icon("Records", (s) => [
  { d: shape([[5.4, 3.6], [15.6, 3.6], [18.7, 6.7], [18.7, 20.4], [5.4, 20.4]], s()) },
  { d: lines([[8.6, 9.2], [15.4, 9.2]], s(), { over: 0.3 }) },
  { d: lines([[8.6, 12.7], [15.4, 12.7]], s(), { over: 0.3 }) },
  { d: lines([[8.6, 16.2], [12.6, 16.2]], s(), { over: 0.3 }), tone: "accent" },
]);

export const LogOut = icon("LogOut", (s) => [
  { d: lines([[10.2, 4], [4.9, 4], [4.9, 20], [10.2, 20]], s()) },
  { d: lines([[10, 12], [19.8, 12]], s()), tone: "accent" },
  { d: lines([[16.2, 8.2], [20, 12], [16.2, 15.8]], s()), tone: "accent" },
]);

export const LogIn = icon("LogIn", (s) => [
  { d: lines([[13.8, 4], [19.1, 4], [19.1, 20], [13.8, 20]], s()) },
  { d: lines([[4, 12], [13.8, 12]], s()), tone: "accent" },
  { d: lines([[10.1, 8.2], [13.9, 12], [10.1, 15.8]], s()), tone: "accent" },
]);

export const Globe = icon("Globe", (s) => [
  { d: ring(12, 12, 8.3, 8.3, s()) },
  { d: ring(12, 12, 3.7, 8.2, s(), -Math.PI / 2, Math.PI * 2 + 0.3), tone: "accent" },
  { d: lines([[4, 12], [20, 12]], s(), { over: 0.1 }) },
]);

export const Devices = icon("Devices", (s) => [
  { d: shape([[2.9, 4.8], [15.4, 4.8], [15.4, 14.6], [2.9, 14.6]], s()) },
  { d: lines([[9.1, 14.8], [9.1, 18.8]], s(), { over: 0 }) },
  { d: lines([[6.2, 19.1], [12, 19.1]], s()) },
  { d: shape([[16.9, 9.4], [21.4, 9.4], [21.4, 20.2], [16.9, 20.2]], s()), tone: "fill" },
]);

export const Trash = icon("Trash", (s) => [
  { d: lines([[3.8, 6.4], [20.2, 6.4]], s()) },
  { d: lines([[9.1, 6.2], [9.4, 3.7], [14.6, 3.7], [14.9, 6.2]], s(), { over: 0 }) },
  { d: lines([[5.9, 6.6], [6.9, 20.2], [17.1, 20.2], [18.1, 6.6]], s(), { over: 0.2 }) },
  { d: lines([[10, 10.4], [10.2, 16.4]], s(), { over: 0.2 }) },
  { d: lines([[14, 10.4], [13.8, 16.4]], s(), { over: 0.2 }) },
]);

const lid: Pt[] = [[2.6, 12.2], [6.8, 7], [12, 5.6], [17.2, 7], [21.4, 12], [17.2, 17], [12, 18.4], [6.8, 17], [2.6, 12.2], [4, 10.2]];

export const Eye = icon("Eye", (s) => [
  { d: curve(lid, s()) },
  { d: ring(12, 12, 3.1, 3.1, s()), tone: "fill" },
]);

export const EyeShut = icon("EyeShut", (s) => [
  { d: curve(lid, s()) },
  { d: ring(12, 12, 3.1, 3.1, s()), tone: "fill" },
  { d: lines([[4.2, 3.8], [19.8, 20.2]], s()) },
]);

export const ArrowRight = icon("ArrowRight", (s) => [
  { d: lines([[4, 12], [19.6, 12]], s()) },
  { d: lines([[13.6, 6], [19.8, 12], [13.6, 18]], s()) },
]);

export const Back = icon("Back", (s) => [{ d: lines([[15.2, 4.6], [7.7, 12], [15.2, 19.4]], s()) }]);

export const Down = icon("Down", (s) => [{ d: lines([[5.6, 9], [12, 15.4], [18.4, 9]], s()) }]);

export const UpDown = icon("UpDown", (s) => [
  { d: lines([[8, 9.2], [12, 5.2], [16, 9.2]], s()) },
  { d: lines([[8, 14.8], [12, 18.8], [16, 14.8]], s()) },
]);

export const Plus = icon("Plus", (s) => [
  { d: lines([[12, 4.6], [12, 19.4]], s()) },
  { d: lines([[4.6, 12], [19.4, 12]], s()) },
]);

export const Share = icon("Share", (s) => [
  { d: lines([[8.2, 9.4], [5, 9.4], [5, 20.2], [19, 20.2], [19, 9.4], [15.8, 9.4]], s()) },
  { d: lines([[12, 3.6], [12, 14.6]], s()), tone: "accent" },
  { d: lines([[8.4, 7], [12, 3.4], [15.6, 7]], s()), tone: "accent" },
]);

export const Loupe = icon("Loupe", (s) => [
  { d: ring(10.4, 10.4, 6.5, 6.5, s()), tone: "fill" },
  { d: lines([[15.3, 15.3], [20.5, 20.5]], s()) },
]);

export const Palette = icon("Palette", (s) => [
  {
    d: curve(
      [[12, 3.6], [18.4, 5.6], [20.6, 11.2], [18, 15.2], [14.6, 14.6], [12.9, 17], [13.7, 19.8], [11, 20.5], [5.5, 18.2], [3.4, 11.8], [6, 5.6], [12, 3.6], [14.2, 3.9]],
      s(),
      0.15,
    ),
  },
  { d: ring(8, 10.4, 1.1, 1.1, s()), tone: "fill" },
  { d: ring(12.2, 7.6, 1.1, 1.1, s()), tone: "fill" },
  { d: ring(16.4, 9.8, 1.1, 1.1, s()), tone: "fill" },
]);

/** The mark of a person: the first letter of their name, inked inside a ring drawn by hand. */
const avatarRing = ring(12, 12, 10.4, 10.2, 977, -1.9, Math.PI * 2 + 0.6);
export function Avatar({ name }: { name: string }) {
  return (
    <span className={cx("hand-avatar")}>
      <svg viewBox="0 0 24 24" aria-hidden>
        <path className={cx("hand-avatar-ground")} d={avatarRing} />
        <path d={avatarRing} />
      </svg>
      <b>{[...name][0]?.toUpperCase()}</b>
    </span>
  );
}

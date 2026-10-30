import { useEffect, useMemo, useRef } from "react";
import { reducedMotion } from "@drawy/ui";
import { cx } from "./cx.ts";

/** A pencil drawn by hand, its point at the lower left of its box. */
export function Pen({
  className,
  size = 32,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      className={cx(`pen${className ? ` ${className}` : ""}`)}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
    >
      <path
        className={cx("pen-body")}
        d="M9.6 22.4 23.9 8.2c1.3-1.3 3.2-1.1 4.1.1.8 1.1.7 2.6-.4 3.7L13.3 26.2c-1.4.1-2.8-1.6-3.7-3.8z"
      />
      <path className={cx("pen-band")} d="M21.4 10.7c1.2.4 2.1 1.3 2.6 2.5" />
      <path className={cx("pen-wood")} d="M9.6 22.4 7.3 28l5.9-1.8" />
      <path className={cx("pen-lead")} d="M7.3 28l.9-2.4 1.6 1.5z" />
    </svg>
  );
}

/** The lantern beside the name, drawn by hand: strokes that bow a little and run past
 * their corners, a candle, its flame and a few rays of light. */
export function Lantern({
  size = 18,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={cx(`lantern${className ? ` ${className}` : ""}`)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle className={cx("lantern-glow")} cx="12" cy="13.6" r="5.2" />
      <g className={cx("lantern-rays")}>
        <path d="M3.7 7.4c.6.2 1.1.5 1.6.9" />
        <path d="M20.4 7.2c-.6.2-1.1.6-1.5 1" />
        <path d="M5.1 3.6c.4.5.8 1.1 1.1 1.7" />
        <path d="M18.8 3.5c-.4.5-.7 1.1-1 1.8" />
      </g>
      <g className={cx("lantern-frame")}>
        <path d="M10.5 4.3c-.4-1.7 3.3-2 3.1-.2" />
        <path d="M8 6.6c1.2-1.6 6.7-1.7 8 0" />
        <path d="M6.9 6.9c3.4-.5 6.9-.4 10.3.2" />
        <path d="M8.4 7.4c-.8 3.7-.9 7.7-.3 11.5" />
        <path d="M15.7 7.3c.8 3.9.7 7.9.1 11.7" />
        <path d="M6.5 19.2c3.7-.6 7.5-.4 11.1.3" />
        <path d="M8.3 21.3c2.6.4 5.2.3 7.6-.3" />
      </g>
      <path
        className={cx("lantern-candle")}
        d="M10.7 16.7c.9-.2 1.8-.2 2.7 0l-.1 2.2c-.8.2-1.7.2-2.5 0z"
      />
      <path
        className={cx("lantern-flame")}
        d="M12.1 10c1.6 1.7 2.1 2.9 2 3.9a2 2 0 0 1-4 .1c-.1-1.1.5-2.4 2-4z"
      />
    </svg>
  );
}

/** The name, written by hand in ink: a capital S, two small e's and a Y whose stem drops
 * below the line. */
export function Wordmark({
  height = 24,
  className,
}: {
  height?: number;
  className?: string;
}) {
  return (
    <svg
      className={cx(`wordmark${className ? ` ${className}` : ""}`)}
      width={height * 2}
      height={height}
      viewBox="0 0 48 24"
      aria-hidden
    >
      <path d="M11.2 4.6C9.6 2.6 5.2 2.4 4 5.2C2.6 8.6 7.6 9.8 9.8 11.6C12.4 13.8 11.6 18 8 18.8C5.6 19.4 3.4 18.4 2.4 16.6" />
      <path d="M16.4 14.2C18.8 14.4 21.6 13.4 21.2 11.2C20.8 9.2 17.6 9.4 16.4 11.8C15 14.6 16.4 18.4 19.8 18.4C21.4 18.4 22.6 17.6 23.4 16.6" />
      <path d="M26 14.2C28.4 14.4 31.2 13.4 30.8 11.2C30.4 9.2 27.2 9.4 26 11.8C24.6 14.6 26 18.4 29.4 18.4C31 18.4 32.2 17.6 33 16.6" />
      <path d="M35.6 3.4C36.6 6.6 38.4 9.2 41.2 10M46.2 2.6C44.2 6.6 42.2 11.6 41.4 16C41 18.6 40.8 20.6 41 22.6" />
    </svg>
  );
}

/** The marks of the product, drawn by hand like the home title: ink lines that bow a
 * little and run past where they meet, in the colour around them, with one touch of the
 * AI's terracotta. */

/** The way back to the works: a magnifying glass over a small drawing, for exploring
 * one idea after another. */
export function Loupe({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={cx(`hand-mark loupe${className ? ` ${className}` : ""}`)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        className={cx("mark-accent-fill")}
        d="M9.8 5.4c2.9-.3 5.2 1.9 5.3 4.6.1 2.9-2.1 5.1-5 5.2-2.7.1-5-2-5.1-4.7-.1-2.7 2-4.9 4.8-5.1z"
      />
      <path
        pathLength={1}
        d="M15.6 7.9c-1-3-4.5-4.6-7.5-3.4-3.2 1.2-4.6 5-3.2 8 1.4 3.1 5.4 4.3 8.3 2.5 2.3-1.4 3.4-4.1 2.8-6.7-.2-.7-.4-1.2-.8-1.8"
      />
      <path
        pathLength={1}
        className={cx("mark-thick")}
        d="M14.6 14.8c1.5 1.6 3 3.2 4.6 4.8"
      />
      <path
        pathLength={1}
        className={cx("mark-accent")}
        d="M7.7 11.9 11.9 8.5"
      />
      <circle className={cx("mark-accent-dot")} cx="7.6" cy="12" r="1.35" />
      <circle className={cx("mark-accent-dot")} cx="12" cy="8.4" r="1.35" />
    </svg>
  );
}

/** A side panel: a page with a column along its left edge, the levels strung down it like
 * the drawing under the loupe. The column deepens while the panel is open. */
export function PanelMark({
  size = 24,
  open = false,
}: {
  size?: number;
  open?: boolean;
}) {
  return (
    <svg
      className={cx("hand-mark panel-mark")}
      data-open={open || undefined}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        className={cx("mark-accent-fill")}
        d="M4.5 5.8c1.5-.1 3-.2 4.4-.2.2 4.3.2 8.6 0 12.9-1.5.1-2.9.1-4.4 0-.3-4.2-.3-8.5 0-12.7z"
      />
      <path d="M5.6 5.2C10.4 4.8 15.3 4.8 19.2 5.1Q20.3 5.2 20.3 6.3C20.5 10.2 20.5 14.1 20.3 18Q20.2 19.1 19.1 19.2C14.4 19.6 9.6 19.6 4.9 19.2Q3.9 19.1 3.8 18.1C3.6 14.2 3.6 10.3 3.9 6.3Q4 5.3 5.2 5.15L7.4 5.05" />
      <path d="M9.4 4.5C9.1 9.5 9.2 14.6 9.5 19.8" />
      <path
        className={cx("mark-accent")}
        d="M6.8 8.2C6.6 10.7 6.7 13.3 6.9 15.8"
      />
      <circle className={cx("mark-accent-dot")} cx="6.8" cy="8.2" r="1.1" />
      <circle className={cx("mark-accent-dot")} cx="6.75" cy="12" r="1.1" />
      <circle className={cx("mark-accent-dot")} cx="6.9" cy="15.8" r="1.1" />
    </svg>
  );
}

/** The AI: a spark in terracotta, a smaller one beside it; it twinkles while the AI
 * works. */
export function Spark({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={cx(`hand-mark spark${className ? ` ${className}` : ""}`)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        className={cx("spark-big")}
        d="M10.6 3.3c.6 4.2 2.4 6.6 7 7.6-4.4 1-6.4 3.3-7 7.8-.8-4.4-2.9-6.7-7.1-7.7 4.4-1 6.3-3.4 7.1-7.7z"
      />
      <path
        className={cx("spark-small")}
        d="M18.7 14.2c.3 1.4.9 2.1 2.4 2.4-1.4.3-2.1 1.1-2.4 2.5-.3-1.4-1-2.2-2.4-2.5 1.4-.3 2.1-1 2.4-2.4z"
      />
    </svg>
  );
}

/** A deterministic wobble, so the same sketch is drawn the same way each time. */
export function random(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

type Pt = [number, number];
/** A line from a to b as a hand draws it: bowed a little, starting and ending a touch off. */
function stroke(
  a: Pt,
  b: Pt,
  r: () => number,
  bow = 2.2,
  overshoot = 1.6,
): string {
  const [ax, ay] = a,
    [bx, by] = b,
    dx = bx - ax,
    dy = by - ay,
    len = Math.hypot(dx, dy) || 1,
    ux = dx / len,
    uy = dy / len,
    nx = -uy,
    ny = ux;
  const jitter = () => (r() - 0.5) * overshoot;
  const s: Pt = [
    ax - ux * r() * overshoot + nx * jitter(),
    ay - uy * r() * overshoot + ny * jitter(),
  ];
  const e: Pt = [
    bx + ux * r() * overshoot * 1.6 + nx * jitter(),
    by + uy * r() * overshoot * 1.6 + ny * jitter(),
  ];
  const k = (r() - 0.5) * 2 * bow;
  const c: Pt = [(s[0] + e[0]) / 2 + nx * k, (s[1] + e[1]) / 2 + ny * k];
  return `M${s[0].toFixed(1)} ${s[1].toFixed(1)}Q${c[0].toFixed(1)} ${c[1].toFixed(1)} ${e[0].toFixed(1)} ${e[1].toFixed(1)}`;
}
/** A box drawn as one stroke going round, its last corner overlapping its first. */
function box(
  x: number,
  y: number,
  w: number,
  h: number,
  r: () => number,
): string[] {
  const corners: Pt[] = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  return corners.map((p, i) => stroke(p, corners[(i + 1) % 4], r, 1.6, 2.2));
}
function arrow(a: Pt, b: Pt, r: () => number): string[] {
  const line = stroke(a, b, r, 3, 0.6);
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const head = (turn: number): Pt => [
    b[0] - 9 * Math.cos(angle + turn),
    b[1] - 9 * Math.sin(angle + turn),
  ];
  return [
    line,
    stroke(head(0.5), b, r, 0.6, 0.5),
    stroke(head(-0.5), b, r, 0.6, 0.5),
  ];
}
/** The sketch the pencil makes while the AI composes: three boxes joined by arrows. */
function sketch(seed: number): string[] {
  const r = random(seed);
  return [
    ...box(14, 52, 52, 34, r),
    ...arrow([72, 69], [100, 69], r),
    ...box(106, 52, 52, 34, r),
    ...arrow([164, 69], [192, 69], r),
    ...box(198, 52, 46, 34, r),
  ];
}

/** How long the pencil takes over each line, in seconds. */
const DRAW = 0.32;
/** Where the pencil rests once the sketch is drawn, beside its last box. */
const REST = { x: 250, y: 40 };

/** A pencil sketching on the empty stage while the AI composes the first drawing: a few
 * boxes and arrows drawn line by line, once; then the pencil rests beside them until the
 * drawing arrives, so nothing appears on the stage only to be wiped away. While the AI
 * waits for answers the sketch stands drawn with the pencil resting. */
/** A hand drawing a diagram; `paused` stops it, `resting` also dims it and puts the pen
 * away. */
export function Sketching({
  paused = false,
  resting = false,
}: {
  paused?: boolean;
  resting?: boolean;
}) {
  const root = useRef<SVGSVGElement>(null),
    pen = useRef<SVGGElement>(null),
    drawing = useRef<SVGGElement>(null);
  const paths = useMemo(() => sketch(7), []);
  useEffect(() => {
    const svg = root.current;
    if (!svg || !drawing.current) return;
    const lines = Array.from(drawing.current.querySelectorAll("path"));
    const lengths = lines.map((l) => l.getTotalLength());
    const place = (x: number, y: number) =>
      pen.current?.style.setProperty(
        "transform",
        `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`,
      );
    const rest = () => {
      lines.forEach((l) => (l.style.strokeDashoffset = "0"));
      svg.dataset.resting = "";
      place(REST.x, REST.y);
    };
    lines.forEach((l, k) => {
      l.style.strokeDasharray = `${lengths[k]}`;
      l.style.strokeDashoffset = `${lengths[k]}`;
    });
    if (paused || reducedMotion() || svg.dataset.resting !== undefined)
      return rest();
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.max(0, now - start) / 1000,
        k = Math.floor(t / DRAW);
      if (k >= lines.length) return rest();
      for (let j = 0; j < lines.length; j++) {
        const progress = j < k ? 1 : j > k ? 0 : (t - j * DRAW) / DRAW;
        lines[j].style.strokeDashoffset = `${lengths[j] * (1 - progress)}`;
      }
      const at = lines[k].getPointAtLength(
        lengths[k] * Math.min(1, (t - k * DRAW) / DRAW),
      );
      place(at.x, at.y);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paths, paused]);
  return (
    <svg
      className={cx("sketching")}
      ref={root}
      viewBox="0 0 260 132"
      data-resting={resting || undefined}
      aria-hidden
    >
      <g className={cx("sketch-drawing")} ref={drawing}>
        {paths.map((d, k) => (
          <path key={k} d={d} />
        ))}
      </g>
      <g ref={pen} className={cx("sketch-pen")}>
        <g transform="translate(-7 -28)">
          <Pen />
        </g>
      </g>
    </svg>
  );
}

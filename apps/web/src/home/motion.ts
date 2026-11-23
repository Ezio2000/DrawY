import { useEffect, useState } from "react";
import { reducedMotion } from "../ui/primitives.tsx";

/* The home page's moving parts that are not drawings: text typed out as if someone were
 * asking, a sheet of paper turned up by its corner, and finding what scrolls the page. Anyone
 * who asked for less motion gets the words whole, at once. */

/** Milliseconds per character: Chinese characters carry more each, so they come slower. */
const pace = (text: string) => (/[\u3400-\u9fff]/.test(text) ? 95 : 42);

/** One question after another, typed out, held, then cleared for the next, so an empty box
 * shows what one might ask in it. While `held`, the current question stays whole and nothing
 * moves. */
export function useCycledTyping(lines: readonly string[], held: boolean) {
  const [at, setAt] = useState(0);
  const [shown, setShown] = useState(0);
  const index = at % lines.length;
  const line = lines[index] ?? "";
  useEffect(() => {
    if (held || reducedMotion()) return;
    const timer =
      shown < line.length
        ? setTimeout(() => setShown(shown + 1), pace(line) * (shown === 0 ? 4 : 1))
        : setTimeout(() => {
            setShown(0);
            setAt((i) => i + 1);
          }, 2400);
    return () => clearTimeout(timer);
  }, [held, shown, line]);
  return { index, text: held || reducedMotion() ? line : line.slice(0, shown) };
}

/** The nearest element above `el` that scrolls up and down: the home page's sheet. */
export function scroller(el: HTMLElement): HTMLElement {
  for (let at = el.parentElement; at; at = at.parentElement)
    if (/(auto|scroll)/.test(getComputedStyle(at).overflowY)) return at;
  return document.scrollingElement as HTMLElement;
}

type Point = [number, number];

/** The part of a w×h sheet on one side of the line through `m` with normal `n`: the side `n`
 * points to when `ahead`, else the other; as a clip-path polygon. */
function side(w: number, h: number, m: Point, n: Point, ahead: boolean): string {
  const corners: Point[] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  const how = (p: Point) => ((p[0] - m[0]) * n[0] + (p[1] - m[1]) * n[1]) * (ahead ? 1 : -1);
  const out: Point[] = [];
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % 4];
    const ha = how(a),
      hb = how(b);
    if (ha >= 0) out.push(a);
    if (ha >= 0 !== hb >= 0) {
      const t = ha / (ha - hb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  });
  if (out.length < 3) return "polygon(0 0, 0 0, 0 0)";
  return `polygon(${out.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(", ")})`;
}

/** A sheet partly turned up by its bottom right corner, `e` of the way (0 lying flat, 1 gone
 * over the top edge it is bound along): what of its face still lies flat (`keep`), the part
 * folded back (`fold`, in the sheet's own coordinates) and the matrix that lays it over
 * (`flip`), the light on the paper's back as it curls (`back`), and the shadow it throws on
 * the sheet beneath (`cast`). The corner travels up the sheet along a bow to the left, so the
 * fold starts as a diagonal across the corner and ends along the top edge. */
export function turnedUp(e: number, w: number, h: number) {
  const corner: Point = [w, h];
  const to: Point = [w - 0.55 * w * Math.sin(Math.PI * e), h - 2 * h * e];
  const dx = corner[0] - to[0],
    dy = corner[1] - to[1],
    len = Math.hypot(dx, dy) || 1;
  // The fold is the line halfway between where the corner was and where it is now.
  const n: Point = [dx / len, dy / len];
  const m: Point = [(corner[0] + to[0]) / 2, (corner[1] + to[1]) / 2];
  const along = m[0] * n[0] + m[1] * n[1];
  const flip = `matrix(${1 - 2 * n[0] * n[0]}, ${-2 * n[0] * n[1]}, ${-2 * n[0] * n[1]}, ${1 - 2 * n[1] * n[1]}, ${2 * along * n[0]}, ${2 * along * n[1]})`;
  // Gradients run across the fold: where the fold falls along a w×h box's gradient line.
  const angle = (Math.atan2(n[0], -n[1]) * 180) / Math.PI;
  const span = Math.abs(w * n[0]) + Math.abs(h * n[1]);
  const fold0 = (m[0] - w / 2) * n[0] + (m[1] - h / 2) * n[1] + span / 2;
  const at = (d: number) => `${(fold0 + d).toFixed(1)}px`;
  const lift = Math.sin(Math.PI * Math.min(1, e * 1.4));
  return {
    keep: side(w, h, m, n, false),
    fold: side(w, h, m, n, true),
    flip,
    // The curl catches the light just past the fold, and the paper dims towards its tip.
    back: `linear-gradient(${angle}deg, rgba(70, 58, 40, 0.22) ${at(0)}, rgba(255, 255, 255, 0.7) ${at(4)}, rgba(255, 255, 255, 0.18) ${at(26)}, rgba(255, 255, 255, 0) ${at(90)}, rgba(70, 58, 40, 0.12) ${at(span)})`,
    // Beneath, a soft shadow along the fold, widening as the sheet lifts, and the whole sheet
    // brightening as it comes into the open.
    cast: `linear-gradient(${angle}deg, rgba(18, 14, 10, 0) ${at(-1)}, rgba(18, 14, 10, ${0.2 + 0.25 * lift}) ${at(0)}, rgba(18, 14, 10, ${0.1 * lift}) ${at(24 + 40 * lift)}, rgba(18, 14, 10, 0) ${at(60 + 120 * lift)}), linear-gradient(rgba(10, 10, 14, ${0.3 * (1 - e)}), rgba(10, 10, 14, ${0.3 * (1 - e)}))`,
  };
}

import type { Bounds, Link, LinkEnd, Point, Side } from "./index.ts";
export interface Camera {
  x: number;
  y: number;
  scale: number;
}
export function union(boxes: Bounds[]): Bounds {
  if (!boxes.length) return { x: 0, y: 0, width: 800, height: 500 };
  const x = Math.min(...boxes.map((b) => b.x)),
    y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}
export function fit(
  bounds: Bounds,
  width: number,
  height: number,
  maxScale = 1.5,
): Camera {
  // The drawing keeps a margin of paper in proportion to the view around it, and no more
  // than 64px of it where the view is small (a phone), whose width the drawing needs.
  const margin = (side: number, share: number) => Math.max(Math.min(64, side * 0.05), side * share);
  const scale = Math.max(
    0.02,
    Math.min(
      (width - margin(width, 0.1)) / bounds.width,
      (height - margin(height, 0.08)) / bounds.height,
      maxScale,
    ),
  );
  return {
    scale,
    x: width / 2 - (bounds.x + bounds.width / 2) * scale,
    y: height / 2 - (bounds.y + bounds.height / 2) * scale,
  };
}
export function zoom(camera: Camera, point: Point, factor: number): Camera {
  const scale = Math.min(8, Math.max(0.02, camera.scale * factor));
  const ratio = scale / camera.scale;
  return {
    scale,
    x: point.x - (point.x - camera.x) * ratio,
    y: point.y - (point.y - camera.y) * ratio,
  };
}
/** The size of the opening view the author is shown, and that sizes are judged in. */
export const OPENING_VIEW = { width: 1440, height: 900 };
/** The smallest text a reader can read in the opening view, in its pixels. */
export const MIN_TEXT = 14;
/** How a scene of this extent opens: the scale it is drawn at in the opening view, and the
 * text size in scene units that comes out at the smallest readable size. */
export function opening(bounds: Bounds) {
  const { scale } = fit(bounds, OPENING_VIEW.width, OPENING_VIEW.height);
  return { scale, smallestSize: Math.ceil(MIN_TEXT / scale) };
}
export const sidePoint: Record<Side, Point> = {
  left: { x: 0, y: 0.5 },
  right: { x: 1, y: 0.5 },
  top: { x: 0.5, y: 0 },
  bottom: { x: 0.5, y: 1 },
};
/** The side of a module a point on it sits on, if it sits on one. */
export function sideOf(a: Point): Side | null {
  const d: [Side, number][] = [
    ["left", a.x],
    ["right", 1 - a.x],
    ["top", a.y],
    ["bottom", 1 - a.y],
  ];
  const [side, distance] = d.reduce((b, e) => (e[1] < b[1] ? e : b));
  return distance <= 0.05 ? side : null;
}
/** The side of a box facing a point in scene units. */
export function facing(b: Bounds, p: Point): Side {
  const dx = (p.x - (b.x + b.width / 2)) / b.width,
    dy = (p.y - (b.y + b.height / 2)) / b.height;
  return Math.abs(dx) > Math.abs(dy)
    ? dx < 0
      ? "left"
      : "right"
    : dy < 0
      ? "top"
      : "bottom";
}
const centre = (b: Bounds): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const placed = (b: Bounds, at: Point) => ({ x: b.x + at.x * b.width, y: b.y + at.y * b.height });
/** A named place on a module, as a share of its size. */
const shareOf = (at: NonNullable<LinkEnd["at"]>): Point =>
  typeof at === "string" ? sidePoint[at] : { x: at[0], y: at[1] };
/** Where the two ends of a link meet their modules, in scene units, and the side each is
 * on. An end that names no place takes the side facing the other end, so it follows as the
 * modules move. */
export function linkEnds(link: Pick<Link, "from" | "to">, box: (moduleId: string) => Bounds) {
  const a = box(link.from.moduleId),
    b = box(link.to.moduleId);
  const fixed = (end: LinkEnd, of: Bounds) => (end.at === undefined ? centre(of) : placed(of, shareOf(end.at)));
  const end = (e: LinkEnd, of: Bounds, far: Point) => {
    const share = e.at === undefined ? sidePoint[facing(of, far)] : shareOf(e.at);
    return { ...placed(of, share), side: sideOf(share) };
  };
  return {
    from: end(link.from, a, fixed(link.to, b)),
    to: end(link.to, b, fixed(link.from, a)),
  };
}

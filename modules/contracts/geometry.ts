import type { Bounds, Link, LinkEnd, Point, Scene, Side } from "./index.ts";
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
/** A box's outline from its top left, clockwise: where links meet a module that declares
 * none of its own. */
export const boxOutline = (b: Bounds): Point[] => [
  { x: b.x, y: b.y },
  { x: b.x + b.width, y: b.y },
  { x: b.x + b.width, y: b.y + b.height },
  { x: b.x, y: b.y + b.height },
  { x: b.x, y: b.y },
];
/** The point a share of the way along a line through points. */
export function pointAlong(points: Point[], t: number): Point {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let left = Math.max(0, Math.min(1, t)) * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const k = lengths[i] ? Math.min(1, left / lengths[i]) : 0;
      return { x: points[i].x + (points[i + 1].x - points[i].x) * k, y: points[i].y + (points[i + 1].y - points[i].y) * k };
    }
    left -= lengths[i];
  }
  return points.at(-1)!;
}
/** The point of a line through points nearest another, how far along it that is as a share
 * of its length, and how far off. */
export function nearestAlong(points: Point[], p: Point): { t: number; point: Point; distance: number } {
  let best = { t: 0, point: points[0] ?? p, distance: Infinity },
    walked = 0;
  const lengths = points.slice(1).map((q, i) => Math.hypot(q.x - points[i].x, q.y - points[i].y));
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < lengths.length; i++) {
    const a = points[i],
      b = points[i + 1],
      l = lengths[i];
    const k = l ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (l * l))) : 0;
    const q = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.distance) best = { t: (walked + l * k) / total, point: q, distance: d };
    walked += l;
  }
  return best;
}
/** A named place on a module, as a share of its size. */
const shareOf = (at: Side | number[]): Point =>
  typeof at === "string" ? sidePoint[at] : { x: at[0], y: at[1] };
/** What placing a link's ends needs to know of the scene: each module's box, the line round
 * a module that declares one, and where another link's ends are. */
export interface Placing {
  box: (moduleId: string) => Bounds | undefined;
  outline?: (moduleId: string) => Point[] | undefined;
  line?: (linkId: string) => { from: Point; to: Point } | undefined;
}
/** Where one end of a link is in the scene, and the side of its module it is on (null for
 * a point inside it, along another link or free); `far` is where the other end is, which an
 * end that follows its module faces. */
export function endPlace(e: LinkEnd, far: Point, placing: Placing): Point & { side: Side | null } {
  if ("moduleId" in e) {
    const of = placing.box(e.moduleId) ?? { x: 0, y: 0, width: 1, height: 1 };
    if (e.at === undefined) {
      const share = sidePoint[facing(of, far)];
      return { ...placed(of, share), side: sideOf(share) };
    }
    if (typeof e.at === "object" && !Array.isArray(e.at)) {
      const p = pointAlong(placing.outline?.(e.moduleId) ?? boxOutline(of), e.at.along);
      return { ...p, side: sideOf({ x: (p.x - of.x) / of.width, y: (p.y - of.y) / of.height }) };
    }
    const share = shareOf(e.at);
    return { ...placed(of, share), side: sideOf(share) };
  }
  if ("linkId" in e) {
    const line = placing.line?.(e.linkId);
    return { ...(line ? pointAlong([line.from, line.to], e.along) : far), side: null };
  }
  return { x: e.x, y: e.y, side: null };
}
/** Where an end stands for the other end to face: the middle of a module it follows. */
function anchorOf(e: LinkEnd, placing: Placing): Point {
  if ("moduleId" in e && e.at === undefined) return centre(placing.box(e.moduleId) ?? { x: 0, y: 0, width: 0, height: 0 });
  return endPlace(e, { x: 0, y: 0 }, placing);
}
/** Where the two ends of a link are, in scene units, and the side of its module each is on.
 * An end on a module that names no place takes the side facing the other end, so it follows
 * as the modules move. */
export function linkEnds(link: Pick<Link, "from" | "to">, placing: Placing) {
  return {
    from: endPlace(link.from, anchorOf(link.to, placing), placing),
    to: endPlace(link.to, anchorOf(link.from, placing), placing),
  };
}
/** A link hanging from a module by one end with its other end free, as a line pulled down
 * from a box: when the module moves, the free end moves with it, so the line keeps its
 * shape. The link's ends after the modules moved by `by`, or null when they stay. */
export function carried(link: Pick<Link, "from" | "to">, by: Map<string, Point>): Pick<Link, "from" | "to"> | null {
  const shift = (free: LinkEnd, held: LinkEnd) => {
    const d = "moduleId" in held ? by.get(held.moduleId) : undefined;
    return d && !("moduleId" in free) && !("linkId" in free) && (d.x || d.y) ? { x: free.x + d.x, y: free.y + d.y } : null;
  };
  const from = shift(link.from, link.to),
    to = shift(link.to, link.from);
  return from || to ? { from: from ?? link.from, to: to ?? link.to } : null;
}
/** Placing links in a scene as it is saved, without drawing it: modules by their boxes
 * (an outline a drawing declares is only known where it is drawn, so ends along one are
 * placed along the box), links riding on links by those links' ends. */
export function scenePlacing(scene: Pick<Scene, "modules" | "links">): Placing {
  const boxes = new Map(scene.modules.map((m) => [m.id, m.bounds]));
  const links = new Map(scene.links.map((l) => [l.id, l]));
  const placing: Placing & { depth: number } = {
    depth: 0,
    box: (id) => boxes.get(id),
    line: (id) => {
      const l = links.get(id);
      if (!l || placing.depth > 6) return undefined;
      placing.depth++;
      try {
        return linkEnds(l, placing);
      } finally {
        placing.depth--;
      }
    },
  };
  return placing;
}

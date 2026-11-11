import type { Bounds, LinkEnd, Point, Side } from "./index.ts";
import { linkEnds, sideOf, union } from "./geometry.ts";

/* How the links of a scene run between their modules. A link's look is its drawing's; where
 * it goes is worked out here for the whole scene at once, because a line that runs at right
 * angles has to know what stands in its way and which other lines share its sides. The
 * runtime routes the links each time modules move and hands every link drawing its route, so
 * a connection never carries offsets of its own that a dragged module would leave behind. */

export type RouteKind = "curve" | "straight" | "smooth" | "elbow";
export interface RouteOptions {
  kind: RouteKind;
  /** For a curve, how far it bows, as its drawing reads it; for an elbow, how far along the
   * way its cross segment sits, from -0.5 to 0.5 around the middle. */
  bend: number;
  /** Shares a port with the other links that leave the same side of its module, or arrive
   * at it, as the branches of a tree share a trunk. Otherwise every link has its own port. */
  trunk: boolean;
  /** The way the figure reads, which a link follows where it can: out of the side that
   * faces that way and into the side that faces back. */
  flow?: Side;
  /** The room its words take, when it has any. */
  label?: { width: number; height: number };
  /** Where along the line its words go, 0 at the start to 1 at the end. */
  labelAt: number;
}
export interface Routed {
  kind: RouteKind;
  /** Scene units, from its start to its end; an elbow's turns are the points between. */
  points: Point[];
  fromSide: Side | null;
  toSide: Side | null;
  /** The centre of its words, where there is room for them. */
  label?: Point;
  /** Modules it passes through though neither end is on them. */
  crosses: string[];
}
export interface RouteLink {
  id: string;
  from: LinkEnd;
  to: LinkEnd;
  options: RouteOptions;
}
type Box = {
  id: string;
  x: number;
  y: number;
  r: number;
  b: number;
  /** Words on the ground: better crossed than a module, where something has to be. */
  soft?: boolean;
  /** Ground neither end stands in, another group's frame: a line may run over it between
   * the modules it holds, and goes round it where that is not much further. */
  ground?: boolean;
  /** A frame an end stands in: nothing to go round, but its edge is drawn, and a line run
   * down it would read as part of the frame. */
  rim?: boolean;
  /** One of the link's own ends, at its true size. */
  end?: boolean;
  /** So near a port that the line leaves beside it with no margin: a side to avoid. */
  tight?: boolean;
  /** How far it was grown past the thing itself. */
  grown?: number;
};

/** Characters that take a full em: CJK, kana, hangul and full-width forms. */
const WIDE = /[ᄀ-ᇿ⺀-鿿ꥠ-꥿가-퟿豈-﫿︰-﹏＀-｠￠-￦]/;
/** How wide words come out at a font size, near enough to leave room for them before they
 * are drawn: a full em for each wide character, a little over half for the rest. */
export function textWidth(text: string, size: number, weight = 400) {
  let em = 0;
  for (const ch of text)
    em += WIDE.test(ch)
      ? 1
      : ch === " "
        ? 0.3
        : /[A-Z0-9MWmw@%]/.test(ch)
          ? 0.66
          : 0.52;
  return em * size * (weight >= 600 ? 1.04 : 1);
}
/** How a link runs, read from its data and the work's style: the keys every link drawing
 * shares (`route`, `bend`, `label`, `size`, `labelAt`, and the marks at its ends), so a
 * drawing of the author's own is routed like the library's. */
export function routing(
  data: Record<string, unknown>,
  style: Record<string, string> = {},
): RouteOptions {
  const asked = data.route ?? style.route;
  const kind: RouteKind =
    asked === "elbow" || asked === "corner"
      ? "elbow"
      : asked === "straight" || asked === "smooth"
        ? asked
        : "curve";
  const text = typeof data.label === "string" ? data.label : "";
  const size = Number(data.size ?? 14) || 14;
  const lines = text.split("\n");
  const at = data.labelAt;
  const flow = { down: "bottom", right: "right", up: "top", left: "left" }[
    String(style.flow)
  ] as Side | undefined;
  return {
    kind,
    bend: Number(data.bend ?? 0) || 0,
    trunk: data.trunk === true,
    ...(flow ? { flow } : {}),
    ...(text
      ? {
          label: {
            width:
              Math.max(...lines.map((l) => textWidth(l, size))) + size * 0.7,
            height: lines.length * size * 1.3 + 2,
          },
        }
      : {}),
    labelAt:
      at === "source"
        ? 0.16
        : at === "target"
          ? 0.84
          : typeof at === "number"
            ? at
            : 0.5,
  };
}

const DIR: Record<Side, Point> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};
const SIDES: Side[] = ["right", "bottom", "left", "top"];
const boxOf = (id: string, b: Bounds, grow = 0): Box => ({
  id,
  x: b.x - grow,
  y: b.y - grow,
  r: b.x + b.width + grow,
  b: b.y + b.height + grow,
});
const holds = (o: Box, p: Point) =>
  p.x > o.x && p.x < o.r && p.y > o.y && p.y < o.b;
const inside = (outer: Bounds, inner: Bounds) =>
  outer.x <= inner.x &&
  outer.y <= inner.y &&
  outer.x + outer.width >= inner.x + inner.width &&
  outer.y + outer.height >= inner.y + inner.height &&
  outer.width * outer.height > inner.width * inner.height;
/** Whether a segment passes through the inside of a box. */
function through(p: Point, q: Point, o: Box) {
  const x0 = Math.min(p.x, q.x),
    x1 = Math.max(p.x, q.x),
    y0 = Math.min(p.y, q.y),
    y1 = Math.max(p.y, q.y);
  if (x0 === x1) return p.x > o.x && p.x < o.r && y1 > o.y && y0 < o.b;
  if (y0 === y1) return p.y > o.y && p.y < o.b && x1 > o.x && x0 < o.r;
  // A slanted segment: clipped to the box, Liang–Barsky.
  let t0 = 0,
    t1 = 1;
  const dx = q.x - p.x,
    dy = q.y - p.y;
  for (const [pp, qq] of [
    [-dx, p.x - o.x],
    [dx, o.r - p.x],
    [-dy, p.y - o.y],
    [dy, o.b - p.y],
  ]) {
    if (pp === 0) {
      if (qq <= 0) return false;
      continue;
    }
    const t = qq / pp;
    if (pp < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  return t1 - t0 > 1e-6;
}
const add = (p: Point, d: Point, by: number): Point => ({
  x: p.x + d.x * by,
  y: p.y + d.y * by,
});
const lengthOf = (pts: Point[]) =>
  pts.reduce(
    (n, p, i) =>
      i ? n + Math.abs(p.x - pts[i - 1].x) + Math.abs(p.y - pts[i - 1].y) : 0,
    0,
  );
/** A line without the points it repeats or runs straight through. */
export function simplified(pts: Point[]) {
  const kept: Point[] = [];
  for (const p of pts) {
    const last = kept.at(-1);
    if (!last || Math.abs(p.x - last.x) > 0.01 || Math.abs(p.y - last.y) > 0.01)
      kept.push(p);
  }
  return kept.filter((p, i) => {
    if (i === 0 || i === kept.length - 1) return true;
    const a = kept[i - 1],
      b = kept[i + 1];
    return (
      Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > 0.01
    );
  });
}
/** The module that lies under the whole figure, if one does: see the runtime's layers. */
export function backdropOf(
  modules: { id: string; bounds: Bounds }[],
): string | undefined {
  const [bottom] = modules;
  if (!bottom || modules.length < 2) return undefined;
  const all = union(modules.map((m) => m.bounds)),
    b = bottom.bounds;
  const across =
    Math.min(b.x + b.width, all.x + all.width) - Math.max(b.x, all.x);
  const down =
    Math.min(b.y + b.height, all.y + all.height) - Math.max(b.y, all.y);
  return across > 0 && down > 0 && across * down >= 0.9 * all.width * all.height
    ? bottom.id
    : undefined;
}
/** The modules that are ground for the links: a backdrop under the whole figure, and any
 * module that holds a linked module inside it and lies below it, as a frame holds its parts
 * and lanes hold their steps. Links are drawn over these and may run across them. */
export function groundOf(
  modules: { id: string; bounds: Bounds }[],
  links: { from: LinkEnd; to: LinkEnd }[],
): Set<string> {
  const ground = new Set<string>();
  const back = backdropOf(modules);
  if (back) ground.add(back);
  const linked = new Set(
    links.flatMap((l) => [l.from.moduleId, l.to.moduleId]),
  );
  modules.forEach((m, i) => {
    for (let j = i + 1; j < modules.length; j++)
      if (linked.has(modules[j].id) && inside(m.bounds, modules[j].bounds)) {
        ground.add(m.id);
        break;
      }
  });
  return ground;
}

const BEND = 28,
  HIT = 1600,
  /** What running within the margin kept round a thing costs, short of passing through it. */
  SQUEEZE = 60;
/** What passing through a thing costs a line, in units of its length. */
const toll = (o: Box) => (o.ground ? HIT / 8 : o.soft ? HIT / 4 : HIT);
/** The room lines keep: clear of what they pass, out of a port before they turn, and between
 * two that share a channel. A drawing that routes lines among its own small parts asks for
 * less than a scene's modules get. */
export interface Spacing {
  margin: number;
  stub: number;
  lane: number;
}
const SPACING: Spacing = { margin: 14, stub: 20, lane: 12 };

/** Finds the boxes near a place without looking at every one: a scene of a few hundred
 * modules is routed many times a second while one of them is dragged. What it returns is in
 * the order the boxes were given. */
function indexed<T extends { x: number; y: number; r: number; b: number }>(
  items: T[],
) {
  const CELL = 256;
  const cells = new Map<number, number[]>();
  const everywhere: number[] = [];
  const cell = (v: number) => Math.floor(v / CELL);
  const key = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);
  items.forEach((o, n) => {
    const i0 = cell(o.x),
      i1 = cell(o.r),
      j0 = cell(o.y),
      j1 = cell(o.b);
    if (!(i1 - i0 < 64 && j1 - j0 < 64) || !Number.isFinite(i0 + i1 + j0 + j1))
      return void everywhere.push(n);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        const list = cells.get(k);
        if (list) list.push(n);
        else cells.set(k, [n]);
      }
  });
  const stamp = new Uint32Array(items.length);
  let tick = 0;
  return (x: number, y: number, r: number, b: number): T[] => {
    tick++;
    const found = [...everywhere];
    const i0 = cell(x),
      i1 = cell(r),
      j0 = cell(y),
      j1 = cell(b);
    if (!(i1 - i0 < 256 && j1 - j0 < 256))
      return items.filter((o) => o.r >= x && o.x <= r && o.b >= y && o.y <= b);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++)
        for (const n of cells.get(key(i, j)) ?? [])
          if (stamp[n] !== tick) {
            stamp[n] = tick;
            const o = items[n];
            if (o.r >= x && o.x <= r && o.b >= y && o.y <= b) found.push(n);
          }
    return found.sort((m, n) => m - n).map((n) => items[n]);
  };
}

interface EndSpec {
  id: string;
  box: Bounds;
  /** A place the link names; otherwise any side. */
  fixed?: { point: Point; side: Side | null };
  sides: Side[];
}
/** What earlier calls worked out for each link, kept by whoever routes the same scene again
 * and again as its modules are dragged. A link's sides and its way between its ports depend
 * only on its two ends and on what stands near them, so both are taken from here while
 * those are exactly as they were; a route is the same with or without it. */
export type RouteMemo = Map<
  string,
  {
    sides?: { key: number[]; sa: Side; sb: Side };
    way?: {
      key: number[];
      sa: Side;
      sb: Side;
      pa: Point;
      pb: Point;
      pts: Point[];
    };
  }
>;
const alike = (m: number[], n: number[]) =>
  m.length === n.length && m.every((v, i) => v === n[i]);
const CODE: Record<Side, number> = { left: 1, right: 2, top: 3, bottom: 4 };
interface Plan {
  /** Everything its sides and its way depend on but the ports it is given. */
  sig: number[];
  link: RouteLink;
  a: EndSpec;
  b: EndSpec;
  sa: Side;
  sb: Side;
  pa: Point;
  pb: Point;
  obstacles: Box[];
  points: Point[];
}
const portOn = (b: Bounds, side: Side, t = 0.5): Point =>
  side === "left"
    ? { x: b.x, y: b.y + b.height * t }
    : side === "right"
      ? { x: b.x + b.width, y: b.y + b.height * t }
      : side === "top"
        ? { x: b.x + b.width * t, y: b.y }
        : { x: b.x + b.width * t, y: b.y + b.height };
const mid = (b: Bounds): Point => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

/** The simple ways between two ports: straight, one turn, or two around a shared channel.
 * `k` is how far along the way a cross segment sits. */
function shapes(
  pa: Point,
  sa: Side,
  pb: Point,
  sb: Side,
  s: number,
  k: number,
  A: Bounds,
  B: Bounds,
) {
  const da = DIR[sa],
    db = DIR[sb];
  const a1 = add(pa, da, s),
    b1 = add(pb, db, s);
  const out: Point[][] = [];
  const level = da.x !== 0,
    levelB = db.x !== 0;
  // Everything below is written for a level start; an upright one is the same with x and y
  // swapped.
  const flip = (p: Point): Point => ({ x: p.y, y: p.x });
  const t = level ? (p: Point) => p : flip;
  const P = t(pa),
    Q = t(pb),
    P1 = t(a1),
    Q1 = t(b1),
    dA = t(da),
    dB = t(db);
  const boxT = (r: Bounds) =>
    level ? r : { x: r.y, y: r.x, width: r.height, height: r.width };
  const RA = boxT(A),
    RB = boxT(B);
  const push = (...pts: Point[]) => out.push(pts.map(t));
  if (level === levelB) {
    if (dA.x === -dB.x) {
      if ((Q.x - P.x) * dA.x >= 2 * s - 0.01) {
        if (Math.abs(P.y - Q.y) < 0.5) push(P, Q);
        else {
          const mx = P1.x + (Q1.x - P1.x) * k;
          push(P, { x: mx, y: P.y }, { x: mx, y: Q.y }, Q);
        }
      } else {
        // Facing away from each other: out, across between or beyond the two, and back in.
        const top = Math.min(RA.y, RB.y) - s,
          bottom = Math.max(RA.y + RA.height, RB.y + RB.height) + s;
        const between =
          RA.y + RA.height < RB.y
            ? (RA.y + RA.height + RB.y) / 2
            : RB.y + RB.height < RA.y
              ? (RB.y + RB.height + RA.y) / 2
              : undefined;
        for (const my of [between, top, bottom])
          if (my !== undefined)
            push(P, P1, { x: P1.x, y: my }, { x: Q1.x, y: my }, Q1, Q);
      }
    } else {
      const x = dA.x > 0 ? Math.max(P1.x, Q1.x) : Math.min(P1.x, Q1.x);
      push(P, { x, y: P.y }, { x, y: Q.y }, Q);
    }
  } else {
    const corner = { x: Q.x, y: P.y };
    if (
      (corner.x - P.x) * dA.x >= s - 0.01 &&
      (corner.y - Q.y) * dB.y >= s - 0.01
    )
      push(P, corner, Q);
    else push(P, P1, { x: P1.x, y: Q1.y }, Q1, Q);
  }
  return out.map(simplified);
}
/** What a way costs: its length, its turns and, far above both, what it runs through. */
function costOf(pts: Point[], obstacles: Box[]) {
  let hits = 0,
    over = 0,
    edge = 0;
  let cost = lengthOf(pts) + BEND * Math.max(0, pts.length - 2);
  // What the line spans, to pass over what lies wholly beside it (it is most of them).
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  const NEAR = 6;
  const inner: Box = { id: "", x: 0, y: 0, r: 0, b: 0 };
  for (const o of obstacles) {
    if (o.tight) cost += 140;
    if (o.r < x0 - NEAR || o.x > x1 + NEAR || o.b < y0 - NEAR || o.y > y1 + NEAR) continue;
    // Into a grown thing's margin, short of the thing itself.
    if (!drawnEdge(o)) {
      const g = o.grown ?? 0;
      inner.x = o.x + g;
      inner.y = o.y + g;
      inner.r = o.r - g;
      inner.b = o.b - g;
      let into = false,
        cut = false,
        along = false;
      for (let i = 1; i < pts.length; i++) {
        if (!into && through(pts[i - 1], pts[i], o)) into = true;
        if (through(pts[i - 1], pts[i], inner)) {
          cut = true;
          break;
        }
        if (!along && alongEdge(pts[i - 1], pts[i], inner)) along = true;
      }
      if (cut) {
        hits++;
        cost += toll(o);
      } else if (into) {
        if (along) edge++;
        cost += SQUEEZE;
      }
      continue;
    }
    for (let i = 1; i < pts.length; i++) {
      const crossed = !o.rim && through(pts[i - 1], pts[i], o);
      if (crossed || alongEdge(pts[i - 1], pts[i], o)) {
        if (!crossed) edge++;
        if (o.ground || o.rim) over++;
        else if (crossed) hits++;
        cost += crossed ? toll(o) : HIT / 8;
        break;
      }
    }
  }
  return { hits, over, edge, cost };
}
/** Whether a thing's box is its drawn outline, not one grown by a margin: a frame, an end, or
 * a thing met at its true edge because it stands too close to a port for any margin. */
const drawnEdge = (o: Box) => !!(o.ground || o.rim || o.end || o.tight);
/** Whether a stretch runs down the drawn edge of a thing, where it cannot be told from it. */
function alongEdge(p: Point, q: Point, o: Box) {
  const NEAR = 6,
    LONG = 24;
  if (p.y === q.y) {
    const run =
      Math.min(Math.max(p.x, q.x), o.r) - Math.max(Math.min(p.x, q.x), o.x);
    return (
      run > LONG && (Math.abs(p.y - o.y) < NEAR || Math.abs(p.y - o.b) < NEAR)
    );
  }
  if (p.x === q.x) {
    const run =
      Math.min(Math.max(p.y, q.y), o.b) - Math.max(Math.min(p.y, q.y), o.y);
    return (
      run > LONG && (Math.abs(p.x - o.x) < NEAR || Math.abs(p.x - o.r) < NEAR)
    );
  }
  return false;
}
/** A way round what stands between two ports, searched on the lines along the edges of the
 * things in the way. It always finds one; where nothing clear exists it passes through as
 * little as it can. */
function search(
  pa: Point,
  sa: Side,
  pb: Point,
  sb: Side,
  s: number,
  obstacles: Box[],
  prefer: Point,
  margin: number,
) {
  const a1 = add(pa, DIR[sa], s),
    b1 = add(pb, DIR[sb], s);
  const R = 140;
  const region = {
    x: Math.min(a1.x, b1.x) - R,
    y: Math.min(a1.y, b1.y) - R,
    r: Math.max(a1.x, b1.x) + R,
    b: Math.max(a1.y, b1.y) + R,
  };
  const near = obstacles.filter(
    (o) => o.r > region.x && o.x < region.r && o.b > region.y && o.y < region.b,
  );
  const line = (values: number[]) =>
    [...new Set(values.map((v) => Math.round(v * 100) / 100))].sort(
      (m, n) => m - n,
    );
  // A drawn outline (a frame, an end, a thing met at its true edge) would swallow a line run
  // down it: the lines a route may take by one keep a margin off its edge on either side, and
  // run down the middle of a gap too narrow for that.
  const frames = near.filter(drawnEdge),
    solid = near.filter((o) => !drawnEdge(o));
  const keep = Math.min(margin / 2, 6);
  const lines = (fixed: number[], drawn: number[], grown: number[], truly: number[]) => {
    // Where every thing's outline is drawn: its own edge, inside the margin it was grown by.
    const edges = [...new Set([...drawn, ...truly])].sort((m, n) => m - n);
    const mids: number[] = [];
    for (let n = 1; n < edges.length; n++)
      if (edges[n] - edges[n - 1] > keep * 2 && edges[n] - edges[n - 1] < margin * 2)
        mids.push((edges[n] + edges[n - 1]) / 2);
    const clear = (v: number) => !edges.some((e) => Math.abs(v - e) < keep);
    return line([...fixed, ...[...grown, ...drawn.flatMap((e) => [e - margin, e + margin]), ...mids].filter(clear)]);
  };
  const by = (o: Box) => (o.grown ?? margin);
  const xs = lines(
      [a1.x, b1.x, prefer.x, region.x, region.r],
      frames.flatMap((o) => [o.x, o.r]),
      solid.flatMap((o) => [o.x, o.r]),
      solid.flatMap((o) => [o.x + by(o), o.r - by(o)]),
    ),
    ys = lines(
      [a1.y, b1.y, prefer.y, region.y, region.b],
      frames.flatMap((o) => [o.y, o.b]),
      solid.flatMap((o) => [o.y, o.b]),
      solid.flatMap((o) => [o.y + by(o), o.b - by(o)]),
    );
  const nx = xs.length,
    ny = ys.length;
  const ix = (v: number) => xs.indexOf(Math.round(v * 100) / 100),
    iy = (v: number) => ys.indexOf(Math.round(v * 100) / 100);
  const start = [ix(a1.x), iy(a1.y)],
    goal = [ix(b1.x), iy(b1.y)];
  // right, down, left, up
  const steps = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  const dirOf = (d: Point) =>
    steps.findIndex(([x, y]) => x === d.x && y === d.y);
  const startDir = dirOf(DIR[sa]),
    // The last stretch runs into the port, against the way the port faces.
    endDir = (dirOf(DIR[sb]) + 2) % 4;
  const key = (i: number, j: number, d: number) => (j * nx + i) * 4 + d;
  const best = new Float64Array(nx * ny * 4).fill(Infinity);
  const came = new Int32Array(nx * ny * 4).fill(-1);
  // A heap of the places reached, nearest the goal by what they cost and still have to go;
  // kept in three plain lists, as this runs for many links each time a module is dragged.
  const hf: number[] = [],
    hg: number[] = [],
    hk: number[] = [];
  const swap = (m: number, n: number) => {
    const f = hf[m],
      g = hg[m],
      k = hk[m];
    hf[m] = hf[n];
    hg[m] = hg[n];
    hk[m] = hk[n];
    hf[n] = f;
    hg[n] = g;
    hk[n] = k;
  };
  const pushHeap = (f: number, g: number, k: number) => {
    hf.push(f);
    hg.push(g);
    hk.push(k);
    for (let n = hf.length - 1; n > 0;) {
      const up = (n - 1) >> 1;
      if (hf[up] <= hf[n]) break;
      swap(up, n);
      n = up;
    }
  };
  /** Takes the nearest out, leaving what it cost in `g` and where it is in `at`. */
  let g = 0,
    at = 0;
  const popHeap = () => {
    g = hg[0];
    at = hk[0];
    const last = hf.length - 1;
    swap(0, last);
    hf.pop();
    hg.pop();
    hk.pop();
    for (let n = 0; ;) {
      const l = n * 2 + 1,
        r = l + 1;
      let m = n;
      if (l < last && hf[l] < hf[m]) m = l;
      if (r < last && hf[r] < hf[m]) m = r;
      if (m === n) break;
      swap(m, n);
      n = m;
    }
  };
  // What each step between neighbouring crossings of the lines passes through, worked out
  // once: `level[j * nx + i]` from (i, j) to (i + 1, j), `upright` from (i, j) to (i, j + 1).
  const level = new Float32Array(nx * ny),
    upright = new Float32Array(nx * ny);
  const first = (line: number[], above: number) => {
    let lo = 0,
      hi = line.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (line[m] > above) hi = m;
      else lo = m + 1;
    }
    return lo;
  };
  // A thing grown by a margin costs a little within the margin and its full toll within
  // itself, so a line squeezes between two things standing close rather than cut one.
  const paints: { o: Box; hit: number }[] = [];
  for (const o of near) {
    if (o.rim) continue;
    if (drawnEdge(o)) paints.push({ o, hit: toll(o) });
    else {
      const g = o.grown ?? margin;
      paints.push({ o, hit: SQUEEZE }, { o: { ...o, x: o.x + g, y: o.y + g, r: o.r - g, b: o.b - g }, hit: toll(o) - SQUEEZE });
    }
  }
  for (const { o, hit } of paints) {
    // Lines strictly inside it, and steps that overlap it.
    const j0 = first(ys, o.y),
      i0 = first(xs, o.x);
    // Another group's frame costs a line once for each edge it crosses, and its length again
    // while inside, so the price of passing through does not hang on how many lines run there.
    const ground = o.ground;
    const cost = (m: number, n: number, lo: number, hi: number) =>
      !ground
        ? hit
        : (m < lo !== n < lo || m === lo || n === lo ? hit / 2 : 0) +
          (m < hi !== n < hi || m === hi || n === hi ? hit / 2 : 0) +
          Math.max(0, Math.min(n, hi) - Math.max(m, lo));
    for (let j = j0; j < ny && ys[j] < o.b; j++)
      for (let i = Math.max(0, i0 - 1); i < nx - 1 && xs[i] < o.r; i++)
        if (xs[i + 1] > o.x)
          level[j * nx + i] += cost(xs[i], xs[i + 1], o.x, o.r);
    for (let i = i0; i < nx && xs[i] < o.r; i++)
      for (let j = Math.max(0, j0 - 1); j < ny - 1 && ys[j] < o.b; j++)
        if (ys[j + 1] > o.y)
          upright[j * nx + i] += cost(ys[j], ys[j + 1], o.y, o.b);
  }
  const h = (i: number, j: number) =>
    Math.abs(xs[i] - b1.x) + Math.abs(ys[j] - b1.y);
  best[key(start[0], start[1], startDir)] = 0;
  pushHeap(h(start[0], start[1]), 0, key(start[0], start[1], startDir));
  let found = -1;
  while (hf.length) {
    popHeap();
    if (g > best[at]) continue;
    const d = at & 3,
      cell = at >> 2,
      i = cell % nx,
      j = (cell - i) / nx;
    if (i === goal[0] && j === goal[1]) {
      found = at;
      break;
    }
    const from = g,
      here = at;
    for (let nd = 0; nd < 4; nd++) {
      if ((nd + 2) % 4 === d) continue;
      const ni = i + steps[nd][0],
        nj = j + steps[nd][1];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      let c =
        Math.abs(xs[ni] - xs[i]) +
        Math.abs(ys[nj] - ys[j]) +
        (nd === 0
          ? level[j * nx + i]
          : nd === 2
            ? level[j * nx + ni]
            : nd === 1
              ? upright[j * nx + i]
              : upright[nj * nx + i]);
      if (nd !== d)
        c +=
          BEND +
          0.02 * (Math.abs(xs[i] - prefer.x) + Math.abs(ys[j] - prefer.y));
      // Arriving at the goal sideways costs the turn into the port.
      if (ni === goal[0] && nj === goal[1] && nd !== endDir)
        c += nd === (endDir + 2) % 4 ? HIT : BEND;
      const to = key(ni, nj, nd);
      if (from + c < best[to]) {
        best[to] = from + c;
        came[to] = here;
        pushHeap(from + c + h(ni, nj), from + c, to);
      }
    }
  }
  if (found < 0) return undefined;
  const path: Point[] = [];
  for (let at = found; at >= 0; at = came[at]) {
    const cell = at >> 2;
    path.push({ x: xs[cell % nx], y: ys[Math.floor(cell / nx)] });
  }
  return simplified([pa, ...path.reverse(), pb]);
}

/** Where every link of a scene runs. `modules` are in stacking order, bottom first. */
export function routeLinks(
  links: RouteLink[],
  /** In stacking order, bottom first. A module whose shape comes to a point at the middle
   * of each side (a diamond, a circle) is met only there. */
  modules: { id: string; bounds: Bounds; pointed?: boolean }[],
  /** Places on the ground that lines and their words go round: a frame's name, the headers
   * of lanes. Each is named by the module it is on. */
  keepClear: { id: string; bounds: Bounds }[] = [],
  spacing: Partial<Spacing> = {},
  memo?: RouteMemo,
): Map<string, Routed> {
  const { margin: MARGIN, stub: STUB } = { ...SPACING, ...spacing };
  const out = new Map<string, Routed>();
  const boxes = new Map(modules.map((m) => [m.id, m.bounds]));
  const back = backdropOf(modules);
  const ground = groundOf(modules, links);
  const solid = modules
    .filter((m) => m.id !== back)
    .map((m) => ({ ...boxOf(m.id, m.bounds), bounds: m.bounds }));
  const near = indexed(solid);
  /** What a module is to a link between two others: an end of it, something in its way, or
   * neither (ground under an end, or a thing lying on one, like a badge on a block's corner). */
  const standing = (
    m: { id: string; bounds: Bounds },
    a: string,
    b: string,
    A: Bounds,
    B: Bounds,
  ) =>
    m.id === a || m.id === b
      ? "end"
      : inside(m.bounds, A) ||
          inside(m.bounds, B) ||
          inside(A, m.bounds) ||
          inside(B, m.bounds)
        ? undefined
        : "way";
  // A way is looked for within this of a link's two ends, and along the edges of whatever
  // reaches into that; so what can stand in its way is what lies within all of those.
  const REACH = 200 + STUB + MARGIN;
  const around = (A: Bounds, B: Bounds) => {
    const u = union([A, B]);
    let x = u.x - REACH,
      y = u.y - REACH,
      r = u.x + u.width + REACH,
      b = u.y + u.height + REACH;
    const close = near(x, y, r, b);
    const reach = close.filter(
      (m) => !inside(m.bounds, A) && !inside(m.bounds, B),
    );
    const ex = Math.min(x, ...reach.map((m) => m.x)) - MARGIN,
      ey = Math.min(y, ...reach.map((m) => m.y)) - MARGIN,
      er = Math.max(r, ...reach.map((m) => m.r)) + MARGIN,
      eb = Math.max(b, ...reach.map((m) => m.b)) + MARGIN;
    return ex < x || ey < y || er > r || eb > b ? near(ex, ey, er, eb) : close;
  };
  const plans: Plan[] = [];
  const loops = new Map<string, number>();
  for (const link of links) {
    const A = boxes.get(link.from.moduleId),
      B = boxes.get(link.to.moduleId);
    if (!A || !B) continue;
    if (
      link.options.kind === "smooth" &&
      link.from.moduleId !== link.to.moduleId
    ) {
      out.set(link.id, smooth(link, A, B));
      continue;
    }
    if (link.options.kind !== "elbow") {
      const { from, to } = linkEnds(link, (id) => boxes.get(id)!);
      out.set(link.id, {
        kind: link.options.kind,
        points: [
          { x: from.x, y: from.y },
          { x: to.x, y: to.y },
        ],
        fromSide: from.side,
        toSide: to.side,
        crosses: [],
      });
      continue;
    }
    if (link.from.moduleId === link.to.moduleId) {
      const nth = loops.get(link.from.moduleId) ?? 0;
      loops.set(link.from.moduleId, nth + 1);
      out.set(link.id, loop(A, nth));
      continue;
    }
    const spec = (end: LinkEnd, box: Bounds): EndSpec => {
      if (Array.isArray(end.at)) {
        const share = { x: end.at[0], y: end.at[1] };
        const side = sideOf(share);
        return {
          id: end.moduleId,
          box,
          fixed: {
            point: {
              x: box.x + share.x * box.width,
              y: box.y + share.y * box.height,
            },
            side,
          },
          sides: side ? [side] : SIDES,
        };
      }
      return { id: end.moduleId, box, sides: end.at ? [end.at] : SIDES };
    };
    const a = spec(link.from, A),
      b = spec(link.to, B);
    // What stands in this link's way: every module but the ground under either end. Its own
    // ends count at their true size, so it never cuts back through where it started.
    const obstacles: Box[] = [];
    for (const m of around(A, B)) {
      const is = standing(m, a.id, b.id, A, B);
      if (is === "end") obstacles.push({ ...boxOf(m.id, m.bounds), end: true });
      else if (is && ground.has(m.id))
        obstacles.push({ ...boxOf(m.id, m.bounds), ground: true, grown: 0 });
      else if (is) obstacles.push({ ...boxOf(m.id, m.bounds, MARGIN), grown: MARGIN });
      else if (ground.has(m.id) && (inside(m.bounds, A) || inside(m.bounds, B)))
        obstacles.push({ ...boxOf(m.id, m.bounds), rim: true, grown: 0 });
    }
    // What a ground keeps clear stands in the way like a module, unless an end is on it.
    for (const c of keepClear)
      if (
        !holds(boxOf("", c.bounds), mid(A)) &&
        !holds(boxOf("", c.bounds), mid(B))
      )
        obstacles.push({ ...boxOf(c.id, c.bounds, 4), soft: true, grown: 4 });
    const sig = [
      A.x,
      A.y,
      A.width,
      A.height,
      B.x,
      B.y,
      B.width,
      B.height,
      link.options.bend,
      MARGIN,
      STUB,
    ];
    sig.push(link.options.flow ? CODE[link.options.flow] : 0);
    for (const e of [a, b])
      sig.push(
        e.fixed?.point.x ?? 0,
        e.fixed?.point.y ?? 0,
        e.fixed ? 1 : 0,
        e.sides.length === 1 ? CODE[e.sides[0]] : 0,
      );
    for (const o of obstacles)
      sig.push(
        o.x,
        o.y,
        o.r,
        o.b,
        (o.id === a.id ? 1 : o.id === b.id ? 2 : 0) +
          (o.soft ? 4 : 0) +
          (o.ground ? 8 : 0) +
          (o.rim ? 16 : 0),
      );
    plans.push({
      sig,
      link,
      a,
      b,
      sa: a.sides[0],
      sb: b.sides[0],
      pa: mid(A),
      pb: mid(B),
      obstacles,
      points: [],
    });
  }
  if (memo) {
    const routed = new Set(plans.map((p) => p.link.id));
    for (const id of memo.keys()) if (!routed.has(id)) memo.delete(id);
  }
  const stubOf = (p: Plan) => {
    // Shorter where the two stand close, so the turn still fits between them.
    const A = p.a.box,
      B = p.b.box;
    const gapX = Math.max(B.x - (A.x + A.width), A.x - (B.x + B.width)),
      gapY = Math.max(B.y - (A.y + A.height), A.y - (B.y + B.height));
    const gap = Math.max(gapX, gapY);
    return Math.max(6, Math.min(STUB, gap > 0 ? gap / 2 : STUB));
  };
  const clear = (
    p: Plan,
    pa: Point,
    pb: Point,
    s: number,
    sa: Side,
    sb: Side,
  ) => {
    // A thing so close that the line cannot leave its port clear of it is met at its true
    // edge, by the margin given up there.
    const a1 = add(pa, DIR[sa], s),
      b1 = add(pb, DIR[sb], s);
    const close = (o: Box) =>
      !o.rim &&
      o.id !== p.a.id &&
      o.id !== p.b.id &&
      (holds(o, a1) || holds(o, b1) || holds(o, pa) || holds(o, pb));
    if (!p.obstacles.some(close)) return p.obstacles;
    return p.obstacles.flatMap((o) => {
      if (!close(o)) return [o];
      const by = o.grown ?? MARGIN;
      const tight = {
        ...o,
        x: o.x + by,
        y: o.y + by,
        r: o.r - by,
        b: o.b - by,
        tight: true,
        grown: 0,
      };
      return holds(tight, pa) || holds(tight, pb) ? [] : [tight];
    });
  };
  const pointOf = (e: EndSpec, side: Side, t = 0.5) =>
    e.fixed?.point ?? portOn(e.box, side, t);
  // What following the figure's flow is worth to a link whose end lies ahead of its start.
  const OPPOSITE: Record<Side, Side> = {
    left: "right",
    right: "left",
    top: "bottom",
    bottom: "top",
  };
  const along = (p: Plan, sa: Side, sb: Side) => {
    const f = p.link.options.flow;
    if (!f) return 0;
    const A = p.a.box,
      B = p.b.box;
    const ahead =
      f === "bottom"
        ? B.y - (A.y + A.height)
        : f === "top"
          ? A.y - (B.y + B.height)
          : f === "right"
            ? B.x - (A.x + A.width)
            : A.x - (B.x + B.width);
    return ahead >= 12
      ? (sa === f ? 150 : 0) + (sb === OPPOSITE[f] ? 150 : 0)
      : 0;
  };
  // First, which side each end leaves by, judged with every port at the middle of its side.
  // A pointed shape has one place a side, so each further link there costs more than the
  // last, and its branches leave by different points while they can.
  const pointed = new Set(modules.filter((m) => m.pointed).map((m) => m.id));
  const taken = new Map<string, number>();
  const crowd = (id: string, side: Side) =>
    pointed.has(id) ? 90 * (taken.get(id + "\n" + side) ?? 0) : 0;
  const count = (p: Plan) => {
    for (const [id, side] of [
      [p.a.id, p.sa],
      [p.b.id, p.sb],
    ])
      taken.set(id + "\n" + side, (taken.get(id + "\n" + side) ?? 0) + 1);
  };
  for (const p of plans) {
    const s = stubOf(p),
      k = 0.5 + Math.max(-0.45, Math.min(0.45, p.link.options.bend));
    const key = [
      ...p.sig,
      ...p.a.sides.map((side) => crowd(p.a.id, side)),
      ...p.b.sides.map((side) => crowd(p.b.id, side)),
    ];
    const known = memo?.get(p.link.id)?.sides;
    if (known && alike(known.key, key)) {
      p.sa = known.sa;
      p.sb = known.sb;
      count(p);
      continue;
    }
    let bestCost = Infinity;
    for (const sa of p.a.sides)
      for (const sb of p.b.sides) {
        const pa = pointOf(p.a, sa),
          pb = pointOf(p.b, sb);
        const obstacles = clear(p, pa, pb, s, sa, sb);
        for (const pts of shapes(pa, sa, pb, sb, s, k, p.a.box, p.b.box)) {
          // A side that faces the other end is preferred among equals.
          const away =
            (DIR[sa].x * (pb.x - pa.x) + DIR[sa].y * (pb.y - pa.y) < 0
              ? 12
              : 0) +
            (DIR[sb].x * (pa.x - pb.x) + DIR[sb].y * (pa.y - pb.y) < 0
              ? 12
              : 0);
          const cost =
            costOf(pts, obstacles).cost +
            away -
            along(p, sa, sb) +
            crowd(p.a.id, sa) +
            crowd(p.b.id, sb);
          if (cost < bestCost - 0.01) {
            bestCost = cost;
            p.sa = sa;
            p.sb = sb;
          }
        }
      }
    count(p);
    memo?.set(p.link.id, {
      ...memo.get(p.link.id),
      sides: { key, sa: p.sa, sb: p.sb },
    });
  }
  // Then the ports. Each link has its own on the side it meets, so every line can be followed
  // from end to end; they stand along the side in the order of where their other ends lie,
  // which keeps them from crossing. Links drawn as a trunk share one port a side instead:
  // those that leave it, and those that arrive.
  type Port = { plans: { p: Plan; end: "a" | "b" }[]; toward: number };
  const sidesUsed = new Map<string, Map<string, Port>>();
  for (const p of plans)
    for (const end of ["a", "b"] as const) {
      const e = p[end],
        side = end === "a" ? p.sa : p.sb;
      if (e.fixed) continue;
      const other = mid(end === "a" ? p.b.box : p.a.box);
      const along = side === "left" || side === "right" ? other.y : other.x;
      const where = e.id + "\n" + side;
      const ports = sidesUsed.get(where) ?? new Map<string, Port>();
      sidesUsed.set(where, ports);
      const group = p.link.options.trunk
        ? end === "a"
          ? "out"
          : "in"
        : "own:" + p.link.id;
      const port = ports.get(group) ?? { plans: [], toward: 0 };
      port.plans.push({ p, end });
      port.toward += along;
      ports.set(group, port);
    }
  const share = new Map<Plan, { a: number; b: number }>();
  const upright = (side: Side) => side === "left" || side === "right";
  type Row = {
    side: Side;
    box: Bounds;
    ports: Port[];
    at: number[];
    gap: number;
  };
  const rows: Row[] = [];
  for (const [where, ports] of sidesUsed) {
    const side = where.split("\n")[1] as Side;
    const list = [...ports.entries()]
      .sort(
        ([mk, m], [nk, n]) =>
          m.toward / m.plans.length - n.toward / n.plans.length ||
          (mk < nk ? -1 : 1),
      )
      .map(([, port]) => port);
    const box = list[0].plans[0].p[list[0].plans[0].end].box;
    const length = upright(side) ? box.height : box.width,
      start = upright(side) ? box.y : box.x;
    const gap =
      list.length > 1 && !pointed.has(where.split("\n")[0])
        ? Math.min(
            24,
            (length * (list.length > 4 ? 0.86 : 0.7)) / (list.length - 1),
          )
        : 0;
    rows.push({
      side,
      box,
      ports: list,
      at: list.map(
        (_, i) => start + length / 2 + (i - (list.length - 1) / 2) * gap,
      ),
      gap,
    });
  }
  // A link between two sides that face each other runs straight when its two ports stand
  // level, so each port moves towards its partner as far as its neighbours on the side allow.
  const placeOf = new Map<Plan, { a?: [Row, number]; b?: [Row, number] }>();
  for (const row of rows)
    row.ports.forEach((port, i) => {
      for (const { p, end } of port.plans)
        placeOf.set(p, { ...placeOf.get(p), [end]: [row, i] });
    });
  for (let pass = 0; pass < 3; pass++)
    for (const row of rows) {
      if (pointed.has(row.ports[0].plans[0].p[row.ports[0].plans[0].end].id))
        continue;
      const length = upright(row.side) ? row.box.height : row.box.width,
        start = upright(row.side) ? row.box.y : row.box.x;
      const pad = Math.min(10, length * 0.14),
        lo = start + pad,
        hi = start + length - pad;
      const wanted = row.ports.map((port, i) => {
        const partners = port.plans.flatMap(({ p, end }) => {
          const far = placeOf.get(p)?.[end === "a" ? "b" : "a"];
          if (!far || far[0].side !== OPPOSITE[row.side]) return [];
          // Only where the two sides look at each other across a gap.
          const gapBetween =
            row.side === "right"
              ? far[0].box.x - (row.box.x + row.box.width)
              : row.side === "left"
                ? row.box.x - (far[0].box.x + far[0].box.width)
                : row.side === "bottom"
                  ? far[0].box.y - (row.box.y + row.box.height)
                  : row.box.y - (far[0].box.y + far[0].box.height);
          const at = far[0].at[far[1]];
          return gapBetween > 0 && at >= lo && at <= hi ? [at] : [];
        });
        return partners.length
          ? partners.reduce((m, n) => m + n, 0) / partners.length
          : row.at[i];
      });
      for (let i = 1; i < wanted.length; i++)
        wanted[i] = Math.max(wanted[i], wanted[i - 1] + row.gap);
      wanted[wanted.length - 1] = Math.min(
        wanted[wanted.length - 1],
        Math.max(hi, row.at[wanted.length - 1]),
      );
      for (let i = wanted.length - 2; i >= 0; i--)
        wanted[i] = Math.min(wanted[i], wanted[i + 1] - row.gap);
      row.at = wanted;
    }
  for (const row of rows) {
    const length = upright(row.side) ? row.box.height : row.box.width,
      start = upright(row.side) ? row.box.y : row.box.x;
    row.ports.forEach((port, i) => {
      for (const { p, end } of port.plans) {
        const s = share.get(p) ?? { a: 0.5, b: 0.5 };
        s[end] = (row.at[i] - start) / length;
        share.set(p, s);
      }
    });
  }
  // Now each link's way between its ports.
  for (const p of plans) {
    const s = stubOf(p),
      k = 0.5 + Math.max(-0.45, Math.min(0.45, p.link.options.bend));
    const t = share.get(p) ?? { a: 0.5, b: 0.5 };
    const key = [...p.sig, CODE[p.sa], CODE[p.sb], t.a, t.b];
    const known = memo?.get(p.link.id)?.way;
    if (known && alike(known.key, key)) {
      p.sa = known.sa;
      p.sb = known.sb;
      p.pa = known.pa;
      p.pb = known.pb;
      p.points = known.pts.map((q) => ({ ...q }));
      continue;
    }
    const attempt = (sa: Side, sb: Side) => {
      const pa = pointOf(p.a, sa, t.a),
        pb = pointOf(p.b, sb, t.b);
      const obstacles = clear(p, pa, pb, s, sa, sb);
      let best: (ReturnType<typeof costOf> & { pts: Point[] }) | undefined;
      for (const pts of shapes(pa, sa, pb, sb, s, k, p.a.box, p.b.box)) {
        const c = costOf(pts, obstacles);
        if (!best || c.cost < best.cost) best = { pts, ...c };
      }
      if (best && !best.hits && !best.over) return { ...best, pa, pb };
      const a1 = add(pa, DIR[sa], s),
        b1 = add(pb, DIR[sb], s);
      const found = search(
        pa,
        sa,
        pb,
        sb,
        s,
        obstacles,
        { x: a1.x + (b1.x - a1.x) * k, y: a1.y + (b1.y - a1.y) * k },
        MARGIN,
      );
      if (found) {
        const c = costOf(found, obstacles);
        if (!best || c.cost < best.cost) best = { pts: found, ...c };
      }
      return { ...best!, pa, pb };
    };
    let chosen = attempt(p.sa, p.sb);
    if (chosen.hits || chosen.edge) {
      // Another pair of sides may get through where this one cannot, or keep off a frame's
      // edge where this one has to run down it to reach its port.
      for (const sa of p.a.sides)
        for (const sb of p.b.sides) {
          if (!(chosen.hits || chosen.edge) || (sa === p.sa && sb === p.sb))
            continue;
          const other = attempt(sa, sb);
          if (other.cost < chosen.cost) {
            chosen = other;
            p.sa = sa;
            p.sb = sb;
          }
        }
    }
    p.pa = chosen.pa;
    p.pb = chosen.pb;
    p.points = chosen.pts.map((q) => ({ ...q }));
    memo?.set(p.link.id, {
      ...memo.get(p.link.id),
      way: { key, sa: p.sa, sb: p.sb, pa: p.pa, pb: p.pb, pts: chosen.pts },
    });
  }
  apart(plans, { ...SPACING, ...spacing });
  /** The modules a line passes through though neither end is on them. */
  const passes = (line: Point[], a: string, b: string, inset: number) => {
    const A = boxes.get(a)!,
      B = boxes.get(b)!;
    const xs = line.map((q) => q.x),
      ys = line.map((q) => q.y);
    return near(
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    )
      .filter((m) => !ground.has(m.id) && standing(m, a, b, A, B) === "way")
      .filter((m) => {
        const o = boxOf(m.id, m.bounds, -inset);
        return line.some((q, i) => i > 0 && through(line[i - 1], q, o));
      })
      .map((m) => m.id);
  };
  for (const p of plans) {
    const crosses = passes(p.points, p.a.id, p.b.id, 0);
    out.set(p.link.id, {
      kind: "elbow",
      points: p.points,
      fromSide: p.a.fixed ? p.a.fixed.side : p.sa,
      toSide: p.b.fixed ? p.b.fixed.side : p.sb,
      crosses,
    });
  }
  // Straight and curved lines say what they pass through, though nothing moves them.
  for (const link of links) {
    const r = out.get(link.id);
    if (!r || r.kind === "elbow" || link.from.moduleId === link.to.moduleId)
      continue;
    r.crosses = passes(
      sampled(r, link.options.bend),
      link.from.moduleId,
      link.to.moduleId,
      2,
    );
  }
  words(
    links,
    out,
    [
      ...modules.filter((m) => !ground.has(m.id)),
      ...keepClear.map((c) => ({ id: c.id + " ", bounds: c.bounds })),
    ],
    union(modules.map((m) => m.bounds)),
  );
  return out;
}
/** Whether a line of straight steps passes through the inside of a box. */
export function passes(line: Point[], box: Bounds, inset = 0) {
  const o = boxOf("", box, -inset);
  return line.some((q, i) => i > 0 && through(line[i - 1], q, o));
}
/** The modules that stand in the way of a link between two of them: every other one but the
 * ground (see `groundOf`), whatever else either end stands in, and what lies on an end. */
export function inTheWay<M extends { id: string; bounds: Bounds }>(
  modules: M[],
  from: string,
  to: string,
  ground: Set<string>,
): M[] {
  const A = modules.find((m) => m.id === from)?.bounds,
    B = modules.find((m) => m.id === to)?.bounds;
  if (!A || !B) return [];
  return modules.filter(
    (m) =>
      !ground.has(m.id) &&
      m.id !== from &&
      m.id !== to &&
      !inside(m.bounds, A) &&
      !inside(m.bounds, B) &&
      !inside(A, m.bounds) &&
      !inside(B, m.bounds),
  );
}
/** A line that is not routed, as the library's arrow draws it, in short straight steps: a
 * bow between its ends for a curve, one sweep square to its sides for a smooth one. */
export function sampled(
  r: Pick<Routed, "kind" | "points" | "fromSide" | "toSide">,
  bend = 0,
): Point[] {
  const a = r.points[0],
    b = r.points.at(-1)!;
  if (r.kind === "elbow" || r.kind === "straight") return r.points;
  let c1: Point, c2: Point;
  if (r.kind === "smooth") {
    const far = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
    const da = r.fromSide
        ? DIR[r.fromSide]
        : far
          ? { x: Math.sign(b.x - a.x) || 1, y: 0 }
          : { x: 0, y: Math.sign(b.y - a.y) || 1 },
      db = r.toSide ? DIR[r.toSide] : { x: -da.x, y: -da.y };
    const reach = Math.max(
      18,
      (Math.abs(da.x ? b.x - a.x : b.y - a.y) ||
        Math.hypot(b.x - a.x, b.y - a.y)) * 0.5,
    );
    c1 = add(a, da, reach);
    c2 = add(b, db, reach);
  } else {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const c = {
      x: (a.x + b.x) / 2 - ((b.y - a.y) / len) * bend * len,
      y: (a.y + b.y) / 2 + ((b.x - a.x) / len) * bend * len,
    };
    // The same bow as a cubic.
    c1 = { x: a.x + ((c.x - a.x) * 2) / 3, y: a.y + ((c.y - a.y) * 2) / 3 };
    c2 = { x: b.x + ((c.x - b.x) * 2) / 3, y: b.y + ((c.y - b.y) * 2) / 3 };
  }
  return Array.from({ length: 17 }, (_, i) => {
    const t = i / 16,
      u = 1 - t;
    return {
      x:
        u * u * u * a.x +
        3 * u * u * t * c1.x +
        3 * u * t * t * c2.x +
        t * t * t * b.x,
      y:
        u * u * u * a.y +
        3 * u * u * t * c1.y +
        3 * u * t * t * c2.y +
        t * t * t * b.y,
    };
  });
}
/** A link that leaves one side and arrives at the opposite one in a single sweep, as the
 * branches of a tree or a mind map do: along the figure's flow where its end lies ahead,
 * else across whichever gap parts the two modules. */
function smooth(link: RouteLink, A: Bounds, B: Bounds): Routed {
  const OPP: Record<Side, Side> = {
    left: "right",
    right: "left",
    top: "bottom",
    bottom: "top",
  };
  const gapX = Math.max(B.x - (A.x + A.width), A.x - (B.x + B.width)),
    gapY = Math.max(B.y - (A.y + A.height), A.y - (B.y + B.height));
  const flow = link.options.flow;
  // Without a flow to follow it runs across the page wherever the two stand side by side,
  // the way words read and a mind map branches.
  const level = flow ? flow === "left" || flow === "right" : gapX > 0;
  const lone = level && gapX <= 0 ? false : !level && gapY <= 0 ? true : level;
  let sa: Side = lone
    ? mid(B).x >= mid(A).x
      ? "right"
      : "left"
    : mid(B).y >= mid(A).y
      ? "bottom"
      : "top";
  let sb: Side = OPP[sa];
  const place = (end: LinkEnd, box: Bounds, side: Side) => {
    if (Array.isArray(end.at))
      return {
        p: {
          x: box.x + end.at[0] * box.width,
          y: box.y + end.at[1] * box.height,
        },
        side: sideOf({ x: end.at[0], y: end.at[1] }),
      };
    const on = end.at ?? side;
    return { p: portOn(box, on), side: on as Side | null };
  };
  const a = place(link.from, A, sa),
    b = place(link.to, B, sb);
  return {
    kind: "smooth",
    points: [a.p, b.p],
    fromSide: a.side,
    toSide: b.side,
    crosses: [],
  };
}
/** A link from a module back to itself: out of its right side and round into its top. */
function loop(box: Bounds, nth: number): Routed {
  const reach = 26 + nth * 14;
  const y = box.y + box.height * 0.3,
    x = box.x + box.width * 0.72;
  return {
    kind: "elbow",
    points: [
      { x: box.x + box.width, y },
      { x: box.x + box.width + reach, y },
      { x: box.x + box.width + reach, y: box.y - reach },
      { x, y: box.y - reach },
      { x, y: box.y },
    ],
    fromSide: "right",
    toSide: "top",
    crosses: [],
  };
}
/** Sets apart the stretches of different links that would lie on top of one another along
 * a shared channel. Links from one port, or into one, are branches of a trunk and stay
 * together; any others run side by side, a lane each, ordered so they cross least. */
function apart(plans: Plan[], { margin: MARGIN, lane: LANE }: Spacing) {
  type Stretch = {
    p: Plan;
    i: number;
    upright: boolean;
    at: number;
    lo: number;
    hi: number;
    down: boolean;
    lead: number;
    /** The first or last stretch, which belongs to its port: others make way for it. */
    fixed: boolean;
  };
  const stretches: Stretch[] = [];
  for (const p of plans) {
    const pts = p.points;
    // Only a stretch between two turns can move; the first and last belong to their ports.
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        b = pts[i + 1];
      const upright = Math.abs(a.x - b.x) < 0.01;
      if (!upright && Math.abs(a.y - b.y) >= 0.01) continue;
      stretches.push({
        p,
        i,
        fixed: i === 0 || i === pts.length - 2,
        upright,
        at: upright ? a.x : a.y,
        lo: Math.min(upright ? a.y : a.x, upright ? b.y : b.x),
        hi: Math.max(upright ? a.y : a.x, upright ? b.y : b.x),
        down: upright ? b.y > a.y : b.x > a.x,
        lead: upright ? a.y : a.x,
      });
    }
  }
  const same = (m: Point, n: Point) =>
    Math.abs(m.x - n.x) < 0.5 && Math.abs(m.y - n.y) < 0.5;
  const kin = (m: Plan, n: Plan) => same(m.pa, n.pa) || same(m.pb, n.pb);
  /** A lone stretch run closer to a thing than the margin, where there is room either side
   * of it, moves to the middle of the gap: two things standing close leave one way between,
   * and a line down the middle of it is told from both. */
  /** The free way either side of a stretch: from the nearest thing on one side to the nearest
   * on the other, over the length it runs; none where it runs through something already. */
  const gapOf = (g: Stretch): [number, number] | undefined => {
    let lo = -Infinity,
      hi = Infinity;
    const itself = (o: Box) => {
      const by = o.grown ?? 0;
      return { ...o, x: o.x + by, y: o.y + by, r: o.r - by, b: o.b - by };
    };
    for (const o of g.p.obstacles) {
      if (o.ground || o.rim || o.soft) continue;
      const t = itself(o);
      const [from, to, near, far] = g.upright ? [t.y, t.b, t.x, t.r] : [t.x, t.r, t.y, t.b];
      if (to <= g.lo + 1 || from >= g.hi - 1) continue;
      if (far <= g.at + 0.5) lo = Math.max(lo, far);
      else if (near >= g.at - 0.5) hi = Math.min(hi, near);
      else return undefined; // It runs through one already: leave it to what said so.
    }
    return Number.isFinite(lo) && Number.isFinite(hi) && hi - lo >= 4 ? [lo, hi] : undefined;
  };
  const centre = (g: Stretch) => {
    const pts = g.p.points,
      a = pts[g.i],
      b = pts[g.i + 1];
    const gap = gapOf(g);
    if (!gap) return;
    const [lo, hi] = gap;
    const target = hi - lo >= MARGIN * 2 ? Math.min(Math.max(g.at, lo + MARGIN), hi - MARGIN) : (lo + hi) / 2;
    const shift = target - g.at;
    if (Math.abs(shift) < 0.5) return;
    const before = pts[g.i - 1],
      after = pts[g.i + 2];
    const moved = g.upright
      ? [{ x: a.x + shift, y: a.y }, { x: b.x + shift, y: b.y }]
      : [{ x: a.x, y: a.y + shift }, { x: b.x, y: b.y + shift }];
    // It must not pass its neighbours' far ends.
    const keeps = g.upright
      ? Math.sign(a.x - before.x) === Math.sign(moved[0].x - before.x) && Math.sign(after.x - b.x) === Math.sign(after.x - moved[1].x)
      : Math.sign(a.y - before.y) === Math.sign(moved[0].y - before.y) && Math.sign(after.y - b.y) === Math.sign(after.y - moved[1].y);
    if (!keeps) return;
    pts[g.i] = moved[0];
    pts[g.i + 1] = moved[1];
  };
  const used = new Set<Stretch>();
  // Stretches by which way they run and where, in bins as wide as two may be apart and still
  // lie together, so each looks only at its own bin and the two beside it.
  const bins = new Map<string, Stretch[]>();
  const binOf = (upright: boolean, at: number) => (upright ? "|" : "-") + Math.floor(at / 5);
  for (const s of stretches) {
    const k = binOf(s.upright, s.at);
    const bin = bins.get(k);
    if (bin) bin.push(s);
    else bins.set(k, [s]);
  }
  const besides = (g: Stretch) =>
    [-1, 0, 1].flatMap((d) => bins.get((g.upright ? "|" : "-") + (Math.floor(g.at / 5) + d)) ?? []);
  for (const s of stretches) {
    if (used.has(s)) continue;
    // Everything lying along the same line as this stretch, gathered through overlaps.
    const group = [s];
    used.add(s);
    for (let n = 0; n < group.length; n++)
      for (const o of besides(group[n]))
        if (
          !used.has(o) &&
          o.upright === group[n].upright &&
          Math.abs(o.at - group[n].at) < 5 &&
          o.hi > group[n].lo + 3 &&
          o.lo < group[n].hi - 3
        ) {
          used.add(o);
          group.push(o);
        }
    if (group.every((g) => g.fixed)) continue;
    // Branches of one trunk take one lane, and so do the stretches held by ports, which
    // cannot move: the others take lanes beside them.
    const lanes: Stretch[][] = [];
    for (const g of group) {
      const lane = lanes.find(
        (l) => (g.fixed && l[0].fixed) || l.some((o) => kin(o.p, g.p)),
      );
      if (lane) lane.push(g);
      else lanes.push([g]);
    }
    if (lanes.length < 2) {
      if (group.length === 1 && !s.fixed) centre(s);
      continue;
    }
    // A stretch running down or right keeps to the far side of one that starts later, and
    // the other way round for those running up or left: they then need not cross.
    const order = (l: Stretch[]) => (l[0].down ? -l[0].lead : 1e6 + l[0].lead);
    lanes.sort((m, n) => order(m) - order(n));
    // Where the lanes go: centred on the line, or, where one is held, out from that one,
    // in order or else all to one side of it.
    const held = lanes.findIndex((l) => l.some((g) => g.fixed));
    const places: ((n: number) => number)[] =
      held < 0
        ? [(n) => n - (lanes.length - 1) / 2]
        : [
            (n) => n - held,
            (n) => (n === held ? 0 : n < held ? n + 1 : n),
            (n) => (n === held ? 0 : n < held ? -(n + 1) : -n),
          ];
    let step = LANE;
    let place = places[0];
    const room = (by: number) =>
      lanes.every((lane, n) =>
        lane.every((g) => {
          const shift = place(n) * by;
          if (g.fixed) return shift === 0;
          const pts = g.p.points,
            a = pts[g.i],
            b = pts[g.i + 1];
          const moved = g.upright
            ? [
                { x: a.x + shift, y: a.y },
                { x: b.x + shift, y: b.y },
              ]
            : [
                { x: a.x, y: a.y + shift },
                { x: b.x, y: b.y + shift },
              ];
          // It must not pass its neighbours' far ends, nor run into anything.
          const before = pts[g.i - 1],
            after = pts[g.i + 2];
          const keeps = g.upright
            ? Math.sign(a.x - before.x) === Math.sign(moved[0].x - before.x) &&
              Math.sign(after.x - b.x) === Math.sign(after.x - moved[1].x)
            : Math.sign(a.y - before.y) === Math.sign(moved[0].y - before.y) &&
              Math.sign(after.y - b.y) === Math.sign(after.y - moved[1].y);
          return (
            keeps &&
            !g.p.obstacles.some((o) => {
              if (o.ground || o.rim) return false;
              // Into a thing's margin is allowed where the lanes need it; into the thing
              // itself never, unless the stretch already ran through it (along its edge
              // is not through it).
              const g0 =
                o.grown ?? (o.id === g.p.a.id || o.id === g.p.b.id ? 0 : MARGIN);
              const box = (by: number) => ({ ...o, x: o.x + by, y: o.y + by, r: o.r - by, b: o.b - by });
              // Touching the thing counts for where it would go; only running inside it
              // counts for where it already ran.
              const itself = box(g0 - 1),
                inside = box(g0 + 0.5);
              return (
                through(moved[0], moved[1], itself) && !through(a, b, inside)
              );
            })
          );
        }),
      );
    const fits = () => places.some((f) => ((place = f), room(step)));
    while (step >= 2.5 && !fits()) step *= 0.75;
    if (step < 2.5) {
      // Too narrow for lanes a full step apart: spread them evenly across the free way,
      // as far from the things either side as from one another.
      if (held >= 0) continue;
      let lo = -Infinity,
        hi = Infinity;
      for (const g of group) {
        const gap = gapOf(g);
        if (!gap) {
          lo = Infinity;
          break;
        }
        lo = Math.max(lo, gap[0]);
        hi = Math.min(hi, gap[1]);
      }
      if (!(hi - lo >= 4)) continue;
      const each = (hi - lo) / (lanes.length + 1);
      step = 1;
      place = (n) => lo + each * (n + 1) - lanes[n][0].at;
      if (!room(1)) continue;
    }
    lanes.forEach((lane, n) => {
      const shift = place(n) * step;
      if (!shift) return;
      for (const g of lane) {
        const pts = g.p.points;
        if (g.upright) {
          pts[g.i].x += shift;
          pts[g.i + 1].x += shift;
        } else {
          pts[g.i].y += shift;
          pts[g.i + 1].y += shift;
        }
      }
    });
  }
}
/** Finds room for each link's words: on its line, clear of the modules, of other links'
 * words and, where it can be, of other lines. */
function words(
  links: RouteLink[],
  routes: Map<string, Routed>,
  /** What words keep off: the modules that are not ground, and what the ground keeps clear. */
  modules: { id: string; bounds: Bounds }[],
  whole: Bounds,
) {
  const placed: Box[] = [];
  const near = indexed(
    modules.map((m) => ({ ...boxOf(m.id, m.bounds, 3), bounds: m.bounds })),
  );
  // Every stretch of every line, to know which of them a place for words would lie on.
  const stretches = indexed(
    [...routes].flatMap(([id, r]) =>
      r.points.slice(1).map((q, i) => {
        const p = r.points[i];
        return {
          id,
          p,
          q,
          x: Math.min(p.x, q.x),
          y: Math.min(p.y, q.y),
          r: Math.max(p.x, q.x),
          b: Math.max(p.y, q.y),
        };
      }),
    ),
  );
  // Words stay within the figure: beyond its edge they are cut from a picture of it.
  const figure = boxOf("", whole);
  const overlap = (m: Box, n: Box) =>
    Math.max(0, Math.min(m.r, n.r) - Math.max(m.x, n.x)) *
    Math.max(0, Math.min(m.b, n.b) - Math.max(m.y, n.y));
  for (const link of links) {
    const r = routes.get(link.id),
      size = link.options.label;
    if (!r || !size || r.kind !== "elbow") continue;
    const pts = r.points,
      total = lengthOf(pts) || 1;
    let best: { at: Point; score: number } | undefined;
    let run = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        b = pts[i];
      const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      const level = Math.abs(a.y - b.y) < 0.01;
      for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const on = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const along = (run + len * t) / total;
        const beside = level ? size.height / 2 + 5 : size.width / 2 + 6;
        for (const [n, at] of [
          on,
          level ? { x: on.x, y: on.y - beside } : { x: on.x + beside, y: on.y },
          level ? { x: on.x, y: on.y + beside } : { x: on.x - beside, y: on.y },
        ].entries()) {
          const box: Box = {
            id: link.id,
            x: at.x - size.width / 2,
            y: at.y - size.height / 2,
            r: at.x + size.width / 2,
            b: at.y + size.height / 2,
          };
          let score =
            Math.abs(along - link.options.labelAt) * 220 + (n ? 14 : 0);
          // Words want to lie along a level stretch long enough to hold them.
          if (level && len < size.width + 8 && !n) score += 30;
          if (
            box.x < figure.x ||
            box.y < figure.y ||
            box.r > figure.r ||
            box.b > figure.b
          )
            score += 400;
          for (const m of near(box.x, box.y, box.r, box.b))
            score += Math.min(4000, overlap(box, m) * 4);
          for (const o of placed) score += Math.min(4000, overlap(box, o) * 6);
          const struck = new Set<string>();
          for (const s of stretches(box.x, box.y, box.r, box.b))
            if (s.id !== link.id && !struck.has(s.id) && through(s.p, s.q, box))
              struck.add(s.id);
          score += 260 * struck.size;
          if (!best || score < best.score - 0.01) best = { at, score };
        }
      }
      run += len;
    }
    if (best) {
      r.label = best.at;
      placed.push({
        id: link.id,
        x: best.at.x - size.width / 2,
        y: best.at.y - size.height / 2,
        r: best.at.x + size.width / 2,
        b: best.at.y + size.height / 2,
      });
    }
  }
}

/** A line a drawing runs between two of its own parts, ready to draw. */
export interface Connection {
  /** SVG path data, in the units the boxes were given in. */
  path: string;
  /** Where it ends, and the way it is heading there, for a mark at its end. */
  tip: Point;
  heading: Point;
  /** The centre of its words, where it has any. */
  label?: Point;
  /** Parts it passes through though neither end is on them, when no way round was found. */
  crosses: string[];
}
/** Lines between the parts of one drawing — the relations across the branches of a tree or a
 * mind map — kept clear of the parts they do not belong to. Each is a gentle bow between its
 * two ends where one runs clear on either side; where neither does, it goes round at right
 * angles with rounded turns, by the same routing a scene's links have. */
export function connect(
  boxes: { id: string; bounds: Bounds }[],
  lines: { from: string; to: string; label?: string; size?: number }[],
  spacing: Partial<Spacing> = {},
): (Connection | undefined)[] {
  const byId = new Map(boxes.map((b) => [b.id, b.bounds]));
  const near = indexed(
    boxes.map((b) => ({ ...boxOf(b.id, b.bounds, 2), bounds: b.bounds })),
  );
  const hits = (line: Point[], a: string, b: string) => {
    const xs = line.map((p) => p.x),
      ys = line.map((p) => p.y);
    return near(
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    )
      .filter(
        (o) =>
          o.id !== a &&
          o.id !== b &&
          line.some((q, i) => i > 0 && through(line[i - 1], q, o)),
      )
      .map((o) => o.id);
  };
  const unit = (p: Point, q: Point) => {
    const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
  };
  /** Where the way from a box's middle towards a point leaves it, a little clear of its edge. */
  const edge = (R: Bounds, to: Point) => {
    const c = mid(R);
    const dx = to.x - c.x,
      dy = to.y - c.y;
    const k = Math.min(
      (R.width / 2 + 4) / Math.abs(dx || 1e-6),
      (R.height / 2 + 4) / Math.abs(dy || 1e-6),
    );
    return { x: c.x + dx * k, y: c.y + dy * k };
  };
  type Bowed = { p: Point; c: Point; q: Point; crosses: string[] };
  const bowed: (Bowed | undefined)[] = lines.map((line) => {
    const A = byId.get(line.from),
      B = byId.get(line.to);
    if (!A || !B || line.from === line.to) return undefined;
    const p = edge(A, mid(B)),
      q = edge(B, mid(A));
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const bow = Math.min(len * 0.2, 48);
    let best: Bowed | undefined;
    for (const by of [bow, -bow, bow * 2, -bow * 2]) {
      const c = {
        x: (p.x + q.x) / 2 - ((q.y - p.y) / len) * by,
        y: (p.y + q.y) / 2 + ((q.x - p.x) / len) * by,
      };
      const curve = Array.from({ length: 17 }, (_, i) => {
        const t = i / 16;
        return {
          x: (1 - t) * (1 - t) * p.x + 2 * t * (1 - t) * c.x + t * t * q.x,
          y: (1 - t) * (1 - t) * p.y + 2 * t * (1 - t) * c.y + t * t * q.y,
        };
      });
      const crosses = hits(curve, line.from, line.to);
      if (!best || crosses.length < best.crosses.length)
        best = { p, c, q, crosses };
      if (!crosses.length) break;
    }
    return best;
  });
  // Those no bow takes clear are routed together, so they share sides and channels well.
  const routed = routeLinks(
    lines.flatMap((line, i) =>
      bowed[i]?.crosses.length
        ? [
            {
              id: String(i),
              from: { moduleId: line.from },
              to: { moduleId: line.to },
              options: routing({
                route: "elbow",
                label: line.label,
                size: line.size,
              }),
            },
          ]
        : [],
    ),
    boxes,
    [],
    spacing,
  );
  const placed: Box[] = [];
  const overlap = (m: Box, n: Box) =>
    Math.max(0, Math.min(m.r, n.r) - Math.max(m.x, n.x)) *
    Math.max(0, Math.min(m.b, n.b) - Math.max(m.y, n.y));
  return lines.map((line, i) => {
    const bow = bowed[i];
    if (!bow) return undefined;
    const round = routed.get(String(i));
    if (round && round.crosses.length < bow.crosses.length) {
      const pts = round.points,
        n = pts.length;
      let path = `M${pts[0].x} ${pts[0].y}`;
      for (let k = 1; k < n - 1; k++) {
        const at = pts[k],
          inn = unit(at, pts[k - 1]),
          out = unit(at, pts[k + 1]);
        const r = Math.min(
          10,
          Math.hypot(at.x - pts[k - 1].x, at.y - pts[k - 1].y) / 2,
          Math.hypot(pts[k + 1].x - at.x, pts[k + 1].y - at.y) / 2,
        );
        path += `L${at.x + inn.x * r} ${at.y + inn.y * r}Q${at.x} ${at.y} ${at.x + out.x * r} ${at.y + out.y * r}`;
      }
      path += `L${pts[n - 1].x} ${pts[n - 1].y}`;
      if (round.label) {
        const size = routing({ label: line.label, size: line.size }).label!;
        placed.push({
          id: "",
          x: round.label.x - size.width / 2,
          y: round.label.y - size.height / 2,
          r: round.label.x + size.width / 2,
          b: round.label.y + size.height / 2,
        });
      }
      return {
        path,
        tip: pts[n - 1],
        heading: unit(pts[n - 2], pts[n - 1]),
        ...(round.label ? { label: round.label } : {}),
        crosses: round.crosses,
      };
    }
    const { p, c, q } = bow;
    let label: Point | undefined;
    if (line.label) {
      // Along the bow, wherever its words lie over the least.
      const size = routing({ label: line.label, size: line.size }).label!;
      let least = Infinity;
      for (const t of [0.5, 0.38, 0.62, 0.26, 0.74]) {
        const at = {
          x: (1 - t) * (1 - t) * p.x + 2 * t * (1 - t) * c.x + t * t * q.x,
          y: (1 - t) * (1 - t) * p.y + 2 * t * (1 - t) * c.y + t * t * q.y,
        };
        const box: Box = {
          id: "",
          x: at.x - size.width / 2,
          y: at.y - size.height / 2,
          r: at.x + size.width / 2,
          b: at.y + size.height / 2,
        };
        const over =
          near(box.x, box.y, box.r, box.b).reduce(
            (sum, o) => sum + overlap(box, o),
            0,
          ) +
          placed.reduce((sum, o) => sum + overlap(box, o), 0) +
          Math.abs(t - 0.5);
        if (over < least - 0.01) {
          least = over;
          label = at;
        }
      }
      placed.push({
        id: "",
        x: label!.x - size.width / 2,
        y: label!.y - size.height / 2,
        r: label!.x + size.width / 2,
        b: label!.y + size.height / 2,
      });
    }
    return {
      path: `M${p.x} ${p.y}Q${c.x} ${c.y} ${q.x} ${q.y}`,
      tip: q,
      heading: unit(c, q),
      ...(label ? { label } : {}),
      crosses: bow.crosses,
    };
  });
}

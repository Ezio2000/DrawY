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
  for (const ch of text) em += WIDE.test(ch) ? 1 : ch === " " ? 0.3 : /[A-Z0-9MWmw@%]/.test(ch) ? 0.66 : 0.52;
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
  const flow = { down: "bottom", right: "right", up: "top", left: "left" }[String(style.flow)] as
    | Side
    | undefined;
  return {
    kind,
    bend: Number(data.bend ?? 0) || 0,
    trunk: data.trunk === true,
    ...(flow ? { flow } : {}),
    ...(text
      ? {
          label: {
            width: Math.max(...lines.map((l) => textWidth(l, size))) + size * 0.7,
            height: lines.length * size * 1.3 + 2,
          },
        }
      : {}),
    labelAt: at === "source" ? 0.16 : at === "target" ? 0.84 : typeof at === "number" ? at : 0.5,
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
const holds = (o: Box, p: Point) => p.x > o.x && p.x < o.r && p.y > o.y && p.y < o.b;
const inside = (outer: Bounds, inner: Bounds) =>
  outer.x <= inner.x &&
  outer.y <= inner.y &&
  outer.x + outer.width >= inner.x + inner.width &&
  outer.y + outer.height >= inner.y + inner.height &&
  outer.width * outer.height > inner.width * inner.height;
/** Whether an upright or level segment passes through the inside of a box. */
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
const add = (p: Point, d: Point, by: number): Point => ({ x: p.x + d.x * by, y: p.y + d.y * by });
const lengthOf = (pts: Point[]) =>
  pts.reduce((n, p, i) => (i ? n + Math.abs(p.x - pts[i - 1].x) + Math.abs(p.y - pts[i - 1].y) : 0), 0);
/** A line without the points it repeats or runs straight through. */
export function simplified(pts: Point[]) {
  const kept: Point[] = [];
  for (const p of pts) {
    const last = kept.at(-1);
    if (!last || Math.abs(p.x - last.x) > 0.01 || Math.abs(p.y - last.y) > 0.01) kept.push(p);
  }
  return kept.filter((p, i) => {
    if (i === 0 || i === kept.length - 1) return true;
    const a = kept[i - 1],
      b = kept[i + 1];
    return Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > 0.01;
  });
}
/** The module that lies under the whole figure, if one does: see the runtime's layers. */
export function backdropOf(modules: { id: string; bounds: Bounds }[]): string | undefined {
  const [bottom] = modules;
  if (!bottom || modules.length < 2) return undefined;
  const all = union(modules.map((m) => m.bounds)),
    b = bottom.bounds;
  const across = Math.min(b.x + b.width, all.x + all.width) - Math.max(b.x, all.x);
  const down = Math.min(b.y + b.height, all.y + all.height) - Math.max(b.y, all.y);
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
  const linked = new Set(links.flatMap((l) => [l.from.moduleId, l.to.moduleId]));
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
  MARGIN = 14,
  STUB = 20,
  LANE = 12;

interface EndSpec {
  id: string;
  box: Bounds;
  /** A place the link names; otherwise any side. */
  fixed?: { point: Point; side: Side | null };
  sides: Side[];
}
interface Plan {
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
const mid = (b: Bounds): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** The simple ways between two ports: straight, one turn, or two around a shared channel.
 * `k` is how far along the way a cross segment sits. */
function shapes(pa: Point, sa: Side, pb: Point, sb: Side, s: number, k: number, A: Bounds, B: Bounds) {
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
  const boxT = (r: Bounds) => (level ? r : { x: r.y, y: r.x, width: r.height, height: r.width });
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
    if ((corner.x - P.x) * dA.x >= s - 0.01 && (corner.y - Q.y) * dB.y >= s - 0.01)
      push(P, corner, Q);
    else push(P, P1, { x: P1.x, y: Q1.y }, Q1, Q);
  }
  return out.map(simplified);
}
/** What a way costs: its length, its turns and, far above both, what it runs through. */
function costOf(pts: Point[], obstacles: Box[]) {
  let hits = 0;
  let cost = lengthOf(pts) + BEND * Math.max(0, pts.length - 2);
  for (const o of obstacles) {
    if (o.tight) cost += 140;
    for (let i = 1; i < pts.length; i++)
      if (through(pts[i - 1], pts[i], o)) {
        hits++;
        cost += o.soft ? HIT / 4 : HIT;
        break;
      }
  }
  return { hits, cost };
}
/** A way round what stands between two ports, searched on the lines along the edges of the
 * things in the way. It always finds one; where nothing clear exists it passes through as
 * little as it can. */
function search(pa: Point, sa: Side, pb: Point, sb: Side, s: number, obstacles: Box[], prefer: Point) {
  const a1 = add(pa, DIR[sa], s),
    b1 = add(pb, DIR[sb], s);
  const R = 140;
  const region = {
    x: Math.min(a1.x, b1.x) - R,
    y: Math.min(a1.y, b1.y) - R,
    r: Math.max(a1.x, b1.x) + R,
    b: Math.max(a1.y, b1.y) + R,
  };
  const near = obstacles.filter((o) => o.r > region.x && o.x < region.r && o.b > region.y && o.y < region.b);
  const line = (values: number[]) => [...new Set(values.map((v) => Math.round(v * 100) / 100))].sort((m, n) => m - n);
  const xs = line([a1.x, b1.x, prefer.x, region.x, region.r, ...near.flatMap((o) => [o.x, o.r])]),
    ys = line([a1.y, b1.y, prefer.y, region.y, region.b, ...near.flatMap((o) => [o.y, o.b])]);
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
  const dirOf = (d: Point) => steps.findIndex(([x, y]) => x === d.x && y === d.y);
  const startDir = dirOf(DIR[sa]),
    // The last stretch runs into the port, against the way the port faces.
    endDir = (dirOf(DIR[sb]) + 2) % 4;
  const key = (i: number, j: number, d: number) => (j * nx + i) * 4 + d;
  const best = new Float64Array(nx * ny * 4).fill(Infinity);
  const came = new Int32Array(nx * ny * 4).fill(-1);
  const heap: [number, number, number, number, number][] = [];
  const pushHeap = (item: [number, number, number, number, number]) => {
    heap.push(item);
    for (let n = heap.length - 1; n > 0; ) {
      const up = (n - 1) >> 1;
      if (heap[up][0] <= heap[n][0]) break;
      [heap[up], heap[n]] = [heap[n], heap[up]];
      n = up;
    }
  };
  const popHeap = () => {
    const top = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let n = 0; ; ) {
        const l = n * 2 + 1,
          r = l + 1;
        let m = n;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === n) break;
        [heap[m], heap[n]] = [heap[n], heap[m]];
        n = m;
      }
    }
    return top;
  };
  const h = (i: number, j: number) => Math.abs(xs[i] - b1.x) + Math.abs(ys[j] - b1.y);
  best[key(start[0], start[1], startDir)] = 0;
  pushHeap([h(start[0], start[1]), 0, start[0], start[1], startDir]);
  let found = -1;
  while (heap.length) {
    const [, g, i, j, d] = popHeap();
    const at = key(i, j, d);
    if (g > best[at]) continue;
    if (i === goal[0] && j === goal[1]) {
      found = at;
      break;
    }
    for (let nd = 0; nd < 4; nd++) {
      if ((nd + 2) % 4 === d) continue;
      const ni = i + steps[nd][0],
        nj = j + steps[nd][1];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      const p = { x: xs[i], y: ys[j] },
        q = { x: xs[ni], y: ys[nj] };
      let c = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
      for (const o of near) if (through(p, q, o)) c += o.soft ? HIT / 4 : HIT;
      if (nd !== d) c += BEND + 0.02 * (Math.abs(p.x - prefer.x) + Math.abs(p.y - prefer.y));
      // Arriving at the goal sideways costs the turn into the port.
      if (ni === goal[0] && nj === goal[1] && nd !== endDir) c += nd === (endDir + 2) % 4 ? HIT : BEND;
      const to = key(ni, nj, nd);
      if (g + c < best[to]) {
        best[to] = g + c;
        came[to] = at;
        pushHeap([g + c + h(ni, nj), g + c, ni, nj, nd]);
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
): Map<string, Routed> {
  const out = new Map<string, Routed>();
  const boxes = new Map(modules.map((m) => [m.id, m.bounds]));
  const back = backdropOf(modules);
  const plans: Plan[] = [];
  const loops = new Map<string, number>();
  for (const link of links) {
    const A = boxes.get(link.from.moduleId),
      B = boxes.get(link.to.moduleId);
    if (!A || !B) continue;
    if (link.options.kind === "smooth" && link.from.moduleId !== link.to.moduleId) {
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
          fixed: { point: { x: box.x + share.x * box.width, y: box.y + share.y * box.height }, side },
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
    for (const m of modules) {
      if (m.id === back) continue;
      if (m.id === a.id || m.id === b.id) {
        obstacles.push(boxOf(m.id, m.bounds));
        continue;
      }
      if (inside(m.bounds, A) || inside(m.bounds, B)) continue;
      // Something lying on an end (a badge on a block's corner) is not a thing to go round.
      if (inside(A, m.bounds) || inside(B, m.bounds)) continue;
      obstacles.push(boxOf(m.id, m.bounds, MARGIN));
    }
    // What a ground keeps clear stands in the way like a module, unless an end is on it.
    for (const c of keepClear)
      if (!holds(boxOf("", c.bounds), mid(A)) && !holds(boxOf("", c.bounds), mid(B)))
        obstacles.push({ ...boxOf(c.id, c.bounds, 4), soft: true, grown: 4 });
    plans.push({ link, a, b, sa: a.sides[0], sb: b.sides[0], pa: mid(A), pb: mid(B), obstacles, points: [] });
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
  const clear = (p: Plan, pa: Point, pb: Point, s: number, sa: Side, sb: Side) => {
    // A thing so close that the line cannot leave its port clear of it is met at its true
    // edge, by the margin given up there.
    const a1 = add(pa, DIR[sa], s),
      b1 = add(pb, DIR[sb], s);
    return p.obstacles.flatMap((o) => {
      if (o.id === p.a.id || o.id === p.b.id) return [o];
      if (!holds(o, a1) && !holds(o, b1) && !holds(o, pa) && !holds(o, pb)) return [o];
      const by = o.grown ?? MARGIN;
      const tight = { ...o, x: o.x + by, y: o.y + by, r: o.r - by, b: o.b - by, tight: true };
      return holds(tight, pa) || holds(tight, pb) ? [] : [tight];
    });
  };
  const pointOf = (e: EndSpec, side: Side, t = 0.5) => e.fixed?.point ?? portOn(e.box, side, t);
  // What following the figure's flow is worth to a link whose end lies ahead of its start.
  const OPPOSITE: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };
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
    return ahead >= 12 ? (sa === f ? 150 : 0) + (sb === OPPOSITE[f] ? 150 : 0) : 0;
  };
  // First, which side each end leaves by, judged with every port at the middle of its side.
  // A pointed shape has one place a side, so each further link there costs more than the
  // last, and its branches leave by different points while they can.
  const pointed = new Set(modules.filter((m) => m.pointed).map((m) => m.id));
  const taken = new Map<string, number>();
  const crowd = (id: string, side: Side) => (pointed.has(id) ? 90 * (taken.get(id + "\n" + side) ?? 0) : 0);
  for (const p of plans) {
    const s = stubOf(p),
      k = 0.5 + Math.max(-0.45, Math.min(0.45, p.link.options.bend));
    let bestCost = Infinity;
    for (const sa of p.a.sides)
      for (const sb of p.b.sides) {
        const pa = pointOf(p.a, sa),
          pb = pointOf(p.b, sb);
        const obstacles = clear(p, pa, pb, s, sa, sb);
        for (const pts of shapes(pa, sa, pb, sb, s, k, p.a.box, p.b.box)) {
          // A side that faces the other end is preferred among equals.
          const away =
            (DIR[sa].x * (pb.x - pa.x) + DIR[sa].y * (pb.y - pa.y) < 0 ? 12 : 0) +
            (DIR[sb].x * (pa.x - pb.x) + DIR[sb].y * (pa.y - pb.y) < 0 ? 12 : 0);
          const cost =
            costOf(pts, obstacles).cost + away - along(p, sa, sb) + crowd(p.a.id, sa) + crowd(p.b.id, sb);
          if (cost < bestCost - 0.01) {
            bestCost = cost;
            p.sa = sa;
            p.sb = sb;
          }
        }
      }
    for (const [id, side] of [
      [p.a.id, p.sa],
      [p.b.id, p.sb],
    ])
      taken.set(id + "\n" + side, (taken.get(id + "\n" + side) ?? 0) + 1);
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
      const group = p.link.options.trunk ? (end === "a" ? "out" : "in") : "own:" + p.link.id;
      const port = ports.get(group) ?? { plans: [], toward: 0 };
      port.plans.push({ p, end });
      port.toward += along;
      ports.set(group, port);
    }
  const share = new Map<Plan, { a: number; b: number }>();
  const upright = (side: Side) => side === "left" || side === "right";
  type Row = { side: Side; box: Bounds; ports: Port[]; at: number[]; gap: number };
  const rows: Row[] = [];
  for (const [where, ports] of sidesUsed) {
    const side = where.split("\n")[1] as Side;
    const list = [...ports.entries()]
      .sort(
        ([mk, m], [nk, n]) =>
          m.toward / m.plans.length - n.toward / n.plans.length || (mk < nk ? -1 : 1),
      )
      .map(([, port]) => port);
    const box = list[0].plans[0].p[list[0].plans[0].end].box;
    const length = upright(side) ? box.height : box.width,
      start = upright(side) ? box.y : box.x;
    const gap =
      list.length > 1 && !pointed.has(where.split("\n")[0])
        ? Math.min(24, (length * (list.length > 4 ? 0.86 : 0.7)) / (list.length - 1))
        : 0;
    rows.push({
      side,
      box,
      ports: list,
      at: list.map((_, i) => start + length / 2 + (i - (list.length - 1) / 2) * gap),
      gap,
    });
  }
  // A link between two sides that face each other runs straight when its two ports stand
  // level, so each port moves towards its partner as far as its neighbours on the side allow.
  const placeOf = new Map<Plan, { a?: [Row, number]; b?: [Row, number] }>();
  for (const row of rows)
    row.ports.forEach((port, i) => {
      for (const { p, end } of port.plans) placeOf.set(p, { ...placeOf.get(p), [end]: [row, i] });
    });
  for (let pass = 0; pass < 3; pass++)
    for (const row of rows) {
      if (pointed.has(row.ports[0].plans[0].p[row.ports[0].plans[0].end].id)) continue;
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
        return partners.length ? partners.reduce((m, n) => m + n, 0) / partners.length : row.at[i];
      });
      for (let i = 1; i < wanted.length; i++) wanted[i] = Math.max(wanted[i], wanted[i - 1] + row.gap);
      wanted[wanted.length - 1] = Math.min(wanted[wanted.length - 1], Math.max(hi, row.at[wanted.length - 1]));
      for (let i = wanted.length - 2; i >= 0; i--) wanted[i] = Math.min(wanted[i], wanted[i + 1] - row.gap);
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
    const attempt = (sa: Side, sb: Side) => {
      const pa = pointOf(p.a, sa, t.a),
        pb = pointOf(p.b, sb, t.b);
      const obstacles = clear(p, pa, pb, s, sa, sb);
      let best: { pts: Point[]; cost: number; hits: number } | undefined;
      for (const pts of shapes(pa, sa, pb, sb, s, k, p.a.box, p.b.box)) {
        const c = costOf(pts, obstacles);
        if (!best || c.cost < best.cost) best = { pts, ...c };
      }
      if (best && !best.hits) return { ...best, pa, pb };
      const a1 = add(pa, DIR[sa], s),
        b1 = add(pb, DIR[sb], s);
      const found = search(pa, sa, pb, sb, s, obstacles, {
        x: a1.x + (b1.x - a1.x) * k,
        y: a1.y + (b1.y - a1.y) * k,
      });
      if (found) {
        const c = costOf(found, obstacles);
        if (!best || c.cost < best.cost) best = { pts: found, ...c };
      }
      return { ...best!, pa, pb };
    };
    let chosen = attempt(p.sa, p.sb);
    if (chosen.hits) {
      // Another pair of sides may get through where this one cannot.
      for (const sa of p.a.sides)
        for (const sb of p.b.sides) {
          if (!chosen.hits || (sa === p.sa && sb === p.sb)) continue;
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
  }
  apart(plans);
  for (const p of plans) {
    const others = p.obstacles.filter((o) => o.id !== p.a.id && o.id !== p.b.id && !o.soft);
    const crosses = others
      .filter((o) => {
        const tight = { ...o, x: o.x + MARGIN, y: o.y + MARGIN, r: o.r - MARGIN, b: o.b - MARGIN };
        return p.points.some((q, i) => i > 0 && through(p.points[i - 1], q, tight));
      })
      .map((o) => o.id);
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
    if (!r || r.kind === "elbow" || link.from.moduleId === link.to.moduleId) continue;
    const [a, b] = r.points;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const bend = r.kind === "curve" ? link.options.bend * len : 0;
    const c = { x: (a.x + b.x) / 2 - ((b.y - a.y) / len) * bend, y: (a.y + b.y) / 2 + ((b.x - a.x) / len) * bend };
    const sample = Array.from({ length: 13 }, (_, i) => {
      const t = i / 12;
      return {
        x: (1 - t) * (1 - t) * a.x + 2 * t * (1 - t) * c.x + t * t * b.x,
        y: (1 - t) * (1 - t) * a.y + 2 * t * (1 - t) * c.y + t * t * b.y,
      };
    });
    const A = boxes.get(link.from.moduleId)!,
      B = boxes.get(link.to.moduleId)!;
    r.crosses = modules
      .filter(
        (m) =>
          m.id !== back &&
          m.id !== link.from.moduleId &&
          m.id !== link.to.moduleId &&
          !inside(m.bounds, A) &&
          !inside(m.bounds, B) &&
          !inside(A, m.bounds) &&
          !inside(B, m.bounds),
      )
      .filter((m) => {
        const o = boxOf(m.id, m.bounds, -2);
        return sample.some((q, i) => i && through(sample[i - 1], q, o));
      })
      .map((m) => m.id);
  }
  words(links, out, [...modules, ...keepClear.map((c) => ({ id: c.id + " ", bounds: c.bounds }))], back);
  return out;
}
/** A link that leaves one side and arrives at the opposite one in a single sweep, as the
 * branches of a tree or a mind map do: along the figure's flow where its end lies ahead,
 * else across whichever gap parts the two modules. */
function smooth(link: RouteLink, A: Bounds, B: Bounds): Routed {
  const OPP: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };
  const gapX = Math.max(B.x - (A.x + A.width), A.x - (B.x + B.width)),
    gapY = Math.max(B.y - (A.y + A.height), A.y - (B.y + B.height));
  const flow = link.options.flow;
  // Without a flow to follow it runs across the page wherever the two stand side by side,
  // the way words read and a mind map branches.
  const level = flow ? flow === "left" || flow === "right" : gapX > 0;
  const lone = level && gapX <= 0 ? false : !level && gapY <= 0 ? true : level;
  let sa: Side = lone ? (mid(B).x >= mid(A).x ? "right" : "left") : mid(B).y >= mid(A).y ? "bottom" : "top";
  let sb: Side = OPP[sa];
  const place = (end: LinkEnd, box: Bounds, side: Side) => {
    if (Array.isArray(end.at))
      return { p: { x: box.x + end.at[0] * box.width, y: box.y + end.at[1] * box.height }, side: sideOf({ x: end.at[0], y: end.at[1] }) };
    const on = end.at ?? side;
    return { p: portOn(box, on), side: on as Side | null };
  };
  const a = place(link.from, A, sa),
    b = place(link.to, B, sb);
  return { kind: "smooth", points: [a.p, b.p], fromSide: a.side, toSide: b.side, crosses: [] };
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
function apart(plans: Plan[]) {
  type Stretch = { p: Plan; i: number; upright: boolean; at: number; lo: number; hi: number; down: boolean; lead: number };
  const stretches: Stretch[] = [];
  for (const p of plans) {
    const pts = p.points;
    // Only a stretch between two turns can move; the first and last belong to their ports.
    for (let i = 1; i < pts.length - 2; i++) {
      const a = pts[i],
        b = pts[i + 1];
      const upright = Math.abs(a.x - b.x) < 0.01;
      stretches.push({
        p,
        i,
        upright,
        at: upright ? a.x : a.y,
        lo: Math.min(upright ? a.y : a.x, upright ? b.y : b.x),
        hi: Math.max(upright ? a.y : a.x, upright ? b.y : b.x),
        down: upright ? b.y > a.y : b.x > a.x,
        lead: upright ? a.y : a.x,
      });
    }
  }
  const same = (m: Point, n: Point) => Math.abs(m.x - n.x) < 0.5 && Math.abs(m.y - n.y) < 0.5;
  const kin = (m: Plan, n: Plan) => same(m.pa, n.pa) || same(m.pb, n.pb);
  const used = new Set<Stretch>();
  for (const s of stretches) {
    if (used.has(s)) continue;
    // Everything lying along the same line as this stretch, gathered through overlaps.
    const group = [s];
    used.add(s);
    for (let n = 0; n < group.length; n++)
      for (const o of stretches)
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
    // Branches of one trunk take one lane.
    const lanes: Stretch[][] = [];
    for (const g of group) {
      const lane = lanes.find((l) => l.some((o) => kin(o.p, g.p)));
      if (lane) lane.push(g);
      else lanes.push([g]);
    }
    if (lanes.length < 2) continue;
    // A stretch running down or right keeps to the far side of one that starts later, and
    // the other way round for those running up or left: they then need not cross.
    const order = (l: Stretch[]) => (l[0].down ? -l[0].lead : 1e6 + l[0].lead);
    lanes.sort((m, n) => order(m) - order(n));
    let step = LANE;
    const room = (by: number) =>
      lanes.every((lane, n) =>
        lane.every((g) => {
          const shift = (n - (lanes.length - 1) / 2) * by;
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
              // Into a thing's margin is allowed where the lanes need it; into the thing
              // itself never, unless the stretch already ran there.
              const by = (o.grown ?? (o.id === g.p.a.id || o.id === g.p.b.id ? 0 : MARGIN)) - 3;
              const itself = { ...o, x: o.x + by, y: o.y + by, r: o.r - by, b: o.b - by };
              return through(moved[0], moved[1], itself) && !through(a, b, itself);
            })
          );
        }),
      );
    while (step >= 2.5 && !room(step)) step *= 0.75;
    if (step < 2.5) continue;
    lanes.forEach((lane, n) => {
      const shift = (n - (lanes.length - 1) / 2) * step;
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
  modules: { id: string; bounds: Bounds }[],
  back: string | undefined,
) {
  const placed: Box[] = [];
  const solid = modules.filter((m) => m.id !== back);
  // Words stay within the figure: beyond its edge they are cut from a picture of it.
  const figure = boxOf("", union(modules.map((m) => m.bounds)));
  const overlap = (m: Box, n: Box) =>
    Math.max(0, Math.min(m.r, n.r) - Math.max(m.x, n.x)) * Math.max(0, Math.min(m.b, n.b) - Math.max(m.y, n.y));
  for (const link of links) {
    const r = routes.get(link.id),
      size = link.options.label;
    if (!r || !size || r.kind !== "elbow") continue;
    const pts = r.points,
      total = lengthOf(pts) || 1;
    const ground = new Set(
      solid
        .filter((m) => {
          const A = modules.find((x) => x.id === link.from.moduleId)?.bounds,
            B = modules.find((x) => x.id === link.to.moduleId)?.bounds;
          return (A && inside(m.bounds, A)) || (B && inside(m.bounds, B));
        })
        .map((m) => m.id),
    );
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
          let score = Math.abs(along - link.options.labelAt) * 220 + (n ? 14 : 0);
          // Words want to lie along a level stretch long enough to hold them.
          if (level && len < size.width + 8 && !n) score += 30;
          if (box.x < figure.x || box.y < figure.y || box.r > figure.r || box.b > figure.b) score += 400;
          for (const m of solid)
            if (!ground.has(m.id)) score += Math.min(4000, overlap(box, boxOf(m.id, m.bounds, 3)) * 4);
          for (const o of placed) score += Math.min(4000, overlap(box, o) * 6);
          for (const [id, other] of routes) {
            if (id === link.id) continue;
            for (let j = 1; j < other.points.length; j++)
              if (through(other.points[j - 1], other.points[j], box)) {
                score += 260;
                break;
              }
          }
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

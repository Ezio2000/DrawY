import type { Bounds, LinkEnd, Point, Side } from "../contracts/index.ts";
import { facing, sideOf, sidePoint } from "../contracts/geometry.ts";

/* Right-angled routes for the links of a scene, laid like a careful draughtsman would: each
 * keeps clear of the modules it passes, leaves and enters its modules square to a side, turns
 * as few times as it can, and keeps off the lines of the links routed before it, crossing
 * them only where it must. Links leaving one module, or entering one, may run together into
 * a shared trunk, as the branches of a tree or the arms of a merge do; any other lines that
 * would run along each other are moved apart. Pure geometry: the scene renderer gives each
 * link drawing its route, and the link decides how to draw it. */

/** A link's route, in scene units: from the point where it leaves its first module to the
 * point where it enters the second, square to the sides those are on. */
export interface Route {
  points: Point[];
  fromSide: Side;
  toSide: Side;
  /** For each segment, whether it runs along another link's line, as the trunk of a tree
   * does: a label belongs on a segment of its own. */
  shared: boolean[];
  /** Where its words go: a point on the route, and the side of the line they stand on. */
  label?: { at: Point; side: "above" | "below" };
}
export interface RouteLink {
  id: string;
  from: LinkEnd;
  to: LinkEnd;
  /** One of several labelled ways out of a module, which leaves by a side of its own. */
  branch?: boolean;
  /** How it looks: only links that look alike join into a trunk, as a red dashed line
   * merged into a black one would read as one line changing. */
  bundle?: string;
  /** Its words, to be placed where they are clear of the modules, the other lines and the
   * other words: their width and font size, the line's width, and the side the author
   * named, if any. */
  words?: { width: number; size: number; stroke: number; side?: "above" | "below" };
}

/** Room kept between a route and the modules it passes. */
const CLEAR = 20;
/** What a turn costs, as a length of line. */
const BEND = 40;
/** What crossing another link costs. */
const CROSS = 260;
/** What running along another link costs, per unit of length. */
const ALONG = 6;
/** Running into a link that leaves or enters the same module costs less than a fresh line,
 * so they join into one trunk. */
const TRUNK = 0.55;
/** What running through a module costs per unit of length, and through the room kept around
 * one: through a module only when there is no way around it. */
const THROUGH = 24;
const NEAR = 1.2;
/** What leaving a module from a side other than the one facing the other end costs: a side
 * turned across, and the side turned away. */
const ACROSS = 90;
const AWAY = 200;
/** What a side costs where links already go the other way: entering where others leave
 * reads as one line running through. Sharing one with a labelled branch reads as a fork of
 * that branch, which is worse. */
const CONTRARY = 240;
const FORK = 1000;
/** What running off the middle of a channel costs per unit of length, beyond its length:
 * among ways as short and as straight, a line takes the middle of the gap it crosses, as
 * an elbow turns halfway between its ends. A port's own line is a middle too. */
const OFFLINE = 0.15;
/** What leaving or entering a flat side away from its middle costs, and more beside a line
 * going the other way on that side. */
const SPREAD = 40;
const ONCOMING = 160;
/** How far apart lines are set where they would run along each other. */
const APART = 9;

type Dir = 0 | 1 | 2 | 3; // +x, -x, +y, -y
const DX = [1, -1, 0, 0] as const,
  DY = [0, 0, 1, -1] as const;
const outward: Record<Side, Dir> = { right: 0, left: 1, bottom: 2, top: 3 };
const back = [1, 0, 3, 2] as const;
const sides: Side[] = ["right", "left", "bottom", "top"];

interface Port {
  side: Side;
  /** Where the line meets the module, and where it has stood clear of it. */
  at: Point;
  stub: Point;
  dir: Dir;
  cost: number;
  /** Which point of its side: the middle (1), or a third of the way to either end. */
  slot: number;
}
interface Segment {
  a: Point;
  b: Point;
  link: string;
  /** The modules the link leaves and enters, as `out:id` and `in:id`. */
  ends: string[];
}

const inside = (outer: Bounds, inner: Bounds) =>
  inner.x >= outer.x - 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 &&
  inner.y + inner.height <= outer.y + outer.height + 0.5;
const overlaps = (a: Bounds, b: Bounds) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const grow = (b: Bounds, by: number): Bounds => ({
  x: b.x - by,
  y: b.y - by,
  width: b.width + 2 * by,
  height: b.height + 2 * by,
});
const centre = (b: Bounds): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const shareOf = (at: NonNullable<LinkEnd["at"]>): Point =>
  typeof at === "string" ? sidePoint[at] : { x: at[0], y: at[1] };
/** The length of [a, b] inside the open span (lo, hi). */
const within = (a: number, b: number, lo: number, hi: number) =>
  Math.max(0, Math.min(Math.max(a, b), hi) - Math.max(Math.min(a, b), lo));

/** A sorted list of numbers without near repeats. */
function distinct(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) if (!out.length || v - out[out.length - 1] > 0.75) out.push(v);
  return out;
}

class Heap {
  private keys: number[] = [];
  private costs: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, cost: number) {
    const { keys, costs } = this;
    let i = keys.length;
    keys.push(key);
    costs.push(cost);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (costs[p] <= cost) break;
      keys[i] = keys[p];
      costs[i] = costs[p];
      i = p;
    }
    keys[i] = key;
    costs[i] = cost;
  }
  pop(): [number, number] {
    const { keys, costs } = this;
    const top: [number, number] = [keys[0], costs[0]];
    const key = keys.pop()!,
      cost = costs.pop()!;
    if (keys.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i,
          mc = cost;
        if (l < keys.length && costs[l] < mc) (m = l), (mc = costs[l]);
        if (r < keys.length && costs[r] < mc) (m = r), (mc = costs[r]);
        if (m === i) break;
        keys[i] = keys[m];
        costs[i] = costs[m];
        i = m;
      }
      keys[i] = key;
      costs[i] = cost;
    }
    return top;
  }
}

/** The modules that stand in the way of routes: every one but those left open (a backdrop)
 * and those holding a module a link meets, such as a swimlane or a frame around a group. */
function obstaclesOf(boxes: Map<string, Bounds>, links: RouteLink[], open: Set<string>) {
  const ends = new Set(links.flatMap((l) => [l.from.moduleId, l.to.moduleId]));
  const out: { id: string; box: Bounds }[] = [];
  for (const [id, box] of boxes) {
    if (open.has(id) || box.width <= 0 || box.height <= 0) continue;
    const holds = [...ends].some((e) => {
      const b = boxes.get(e);
      return e !== id && !!b && inside(box, b) && box.width * box.height > b.width * b.height * 1.2;
    });
    if (!holds) out.push({ id, box });
  }
  return out;
}

/** Which way a figure mostly runs: down its rows, as a tree or a top-down flowchart does,
 * or across its columns. Read from the links between modules apart in one direction only,
 * and from the modules several links meet: neighbours side by side below or above one read
 * as a row under a parent, neighbours one over another beside it as a column. */
function flowOf(links: RouteLink[], boxes: Map<string, Bounds>): "down" | "across" {
  let down = 0,
    across = 0;
  const neighbours = new Map<string, Bounds[]>();
  for (const l of links) {
    const a = boxes.get(l.from.moduleId),
      b = boxes.get(l.to.moduleId);
    if (!a || !b) continue;
    const { x, y } = gaps(a, b);
    if (y > 0 && x <= 0) down++;
    else if (x > 0 && y <= 0) across++;
    neighbours.set(l.from.moduleId, [...(neighbours.get(l.from.moduleId) ?? []), b]);
    neighbours.set(l.to.moduleId, [...(neighbours.get(l.to.moduleId) ?? []), a]);
  }
  for (const [id, near] of neighbours) {
    const m = boxes.get(id)!,
      c = centre(m);
    for (let i = 0; i < near.length; i++)
      for (let j = i + 1; j < near.length; j++) {
        const p = near[i],
          q = near[j];
        const below = (b: Bounds) => Math.sign(centre(b).y - c.y) * (gaps(m, b).y > 0 ? 1 : 0);
        const beside = (b: Bounds) => Math.sign(centre(b).x - c.x) * (gaps(m, b).x > 0 ? 1 : 0);
        const { x, y } = gaps(p, q);
        if (below(p) && below(p) === below(q) && x > 0 && y <= 0) down += 0.5;
        if (beside(p) && beside(p) === beside(q) && y > 0 && x <= 0) across += 0.5;
      }
  }
  return down > across ? "down" : "across";
}
/** The room between two boxes across and down; negative where they overlap that way. */
const gaps = (a: Bounds, b: Bounds) => ({
  x: Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width)),
  y: Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height)),
});
/** The side of a box a route to another box is best to leave by: down or up between rows,
 * across between columns, and between boxes apart both ways the way the figure runs. */
function towards(a: Bounds, b: Bounds, flow: "down" | "across"): Side {
  const { x, y } = gaps(a, b);
  const upright = y > 0 && (x <= 0 || flow === "down");
  const ca = centre(a),
    cb = centre(b);
  if (upright) return cb.y > ca.y ? "bottom" : "top";
  if (x > 0) return cb.x > ca.x ? "right" : "left";
  return facing(a, cb);
}
/** Where a route may leave or enter a module: the side and point the link names, or any
 * side, the best one costing nothing. A flat side also offers two points a third of the way
 * from its middle, so links that cannot share the middle leave or enter side by side, as an
 * architecture draws them; a round outline (a diamond, a circle) meets its box only at the
 * middles. */
function portsOf(
  end: LinkEnd,
  box: Bounds,
  best: Side,
  obstacles: { id: string; box: Bounds }[],
  flat: boolean,
): Port[] | undefined {
  const candidates: { side: Side; share: Point; cost: number; slot: number }[] = [];
  if (end.at !== undefined) {
    const share = shareOf(end.at);
    const side = sideOf(share);
    if (!side) return undefined;
    candidates.push({ side, share, cost: 0, slot: 1 });
  } else
    for (const side of sides) {
      const cost = side === best ? 0 : outward[side] === back[outward[best]] ? AWAY : ACROSS;
      candidates.push({ side, share: sidePoint[side], cost, slot: 1 });
      const along = side === "top" || side === "bottom" ? box.width : box.height;
      if (flat && along >= 72)
        for (const [slot, t] of [
          [0, 0.3],
          [2, 0.7],
        ] as const)
          candidates.push({
            side,
            share: side === "top" || side === "bottom" ? { x: t, y: sidePoint[side].y } : { x: sidePoint[side].x, y: t },
            cost: cost + SPREAD,
            slot,
          });
    }
  return candidates.map(({ side, share, cost, slot }) =>
    port(box, side, { x: box.x + share.x * box.width, y: box.y + share.y * box.height }, cost, obstacles, slot),
  );
}
function port(box: Bounds, side: Side, at: Point, cost: number, obstacles: { box: Bounds }[], slot = 1): Port {
  const dir = outward[side];
  // The line stands clear of its module before it turns, by less where another module is
  // close in front of it, so it never turns inside that one.
  let reach = CLEAR;
  for (const o of obstacles) {
    const b = o.box;
    if (b === box) continue;
    const ahead =
      dir === 0 ? b.x - at.x : dir === 1 ? at.x - (b.x + b.width) : dir === 2 ? b.y - at.y : at.y - (b.y + b.height);
    const across = dir < 2 ? at.y > b.y && at.y < b.y + b.height : at.x > b.x && at.x < b.x + b.width;
    if (across && ahead > 0) reach = Math.min(reach, ahead / 2);
  }
  reach = Math.max(4, reach);
  return { side, at, stub: { x: at.x + DX[dir] * reach, y: at.y + DY[dir] * reach }, dir, cost, slot };
}
/** Facing middles that nearly line up are moved onto one line, so the route runs straight
 * rather than with a small step: within the middle half of a flat side, and only on flat
 * sides, as a line off a diamond's corner would stop short of it. */
function aligned(
  starts: Port[],
  goals: Port[],
  a: Bounds,
  b: Bounds,
  obstacles: { box: Bounds }[],
  flat: [boolean, boolean],
) {
  const s = starts.find((p) => p.cost === 0 && p.slot === 1),
    g = goals.find((q) => q.cost === 0 && q.slot === 1);
  if (!s || !g || g.dir !== back[s.dir] || !(flat[0] || flat[1])) return;
  const upright = s.dir >= 2;
  const span = (box: Bounds, isFlat: boolean, at: number) =>
    !isFlat
      ? [at, at]
      : upright
        ? [box.x + box.width * 0.25, box.x + box.width * 0.75]
        : [box.y + box.height * 0.25, box.y + box.height * 0.75];
  const pa = upright ? s.at.x : s.at.y,
    pb = upright ? g.at.x : g.at.y;
  const [a0, a1] = span(a, flat[0], pa),
    [b0, b1] = span(b, flat[1], pb);
  const lo = Math.max(a0, b0),
    hi = Math.min(a1, b1);
  if (Math.abs(pa - pb) < 0.5 || lo > hi || Math.abs(pa - pb) > 40) return;
  const line = Math.min(hi, Math.max(lo, (pa + pb) / 2));
  const moved = (p: Port, box: Bounds) =>
    port(box, p.side, upright ? { x: line, y: p.at.y } : { x: p.at.x, y: line }, p.cost, obstacles);
  starts[starts.indexOf(s)] = moved(s, a);
  goals[goals.indexOf(g)] = moved(g, b);
}

/** Points in order with repeats and straight-through points left out. */
function simplified(points: Point[]) {
  const kept: Point[] = [];
  for (const p of points) {
    const last = kept[kept.length - 1];
    if (!last || Math.abs(p.x - last.x) > 0.01 || Math.abs(p.y - last.y) > 0.01) kept.push({ ...p });
  }
  return kept.filter((p, i) => {
    if (i === 0 || i === kept.length - 1) return true;
    const q = kept[i - 1],
      r = kept[i + 1];
    return !((Math.abs(q.x - p.x) < 0.01 && Math.abs(p.x - r.x) < 0.01) || (Math.abs(q.y - p.y) < 0.01 && Math.abs(p.y - r.y) < 0.01));
  });
}

/** The cheapest right-angled way from one of the start ports to one of the end ports over
 * the lines of a grid, with what it would cost to run through each module or the room
 * around it, to turn, and to run along or across the links already laid. */
function search(
  starts: Port[],
  goals: Port[],
  obstacles: { box: Bounds }[],
  laid: Segment[],
  ends: string[],
  window: Bounds,
) {
  const wx0 = window.x,
    wx1 = window.x + window.width,
    wy0 = window.y,
    wy1 = window.y + window.height;
  const inWindow = (b: Bounds) => b.x < wx1 && b.x + b.width > wx0 && b.y < wy1 && b.y + b.height > wy0;
  const near = obstacles.filter((o) => inWindow(grow(o.box, CLEAR)));
  const xs: number[] = [wx0, wx1],
    ys: number[] = [wy0, wy1];
  const rawX: number[] = [],
    rawY: number[] = [];
  for (const { box } of near) {
    rawX.push(box.x, box.x + box.width);
    rawY.push(box.y, box.y + box.height);
    xs.push(box.x - CLEAR, box.x + box.width + CLEAR);
    ys.push(box.y - CLEAR, box.y + box.height + CLEAR);
  }
  // The middle of each gap between modules is the channel a line runs best in.
  const middles = { x: new Set<number>(), y: new Set<number>() };
  for (const p of [...starts, ...goals]) {
    rawX.push(p.at.x);
    rawY.push(p.at.y);
  }
  for (const [raw, into, mid] of [
    [distinct(rawX), xs, middles.x],
    [distinct(rawY), ys, middles.y],
  ] as const)
    for (let i = 1; i < raw.length; i++) {
      const m = (raw[i - 1] + raw[i]) / 2;
      into.push(m);
      mid.add(Math.round(m));
    }
  for (const p of [...starts, ...goals]) {
    xs.push(p.at.x, p.stub.x);
    ys.push(p.at.y, p.stub.y);
    middles.x.add(Math.round(p.at.x));
    middles.y.add(Math.round(p.at.y));
  }
  const X = distinct(xs.filter((x) => x >= wx0 - 0.5 && x <= wx1 + 0.5)),
    Y = distinct(ys.filter((y) => y >= wy0 - 0.5 && y <= wy1 + 0.5));
  const nx = X.length,
    ny = Y.length;
  const index = (list: number[], v: number) => {
    let lo = 0,
      hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid] < v - 0.75) lo = mid + 1;
      else hi = mid;
    }
    return Math.abs(list[lo] - v) <= 0.75 ? lo : -1;
  };
  const horizontal = new Map<number, Segment[]>(),
    vertical = new Map<number, Segment[]>();
  const sideways: Segment[] = [],
    upright: Segment[] = [];
  for (const s of laid) {
    if (Math.abs(s.a.y - s.b.y) < 0.5) {
      const k = Math.round(s.a.y);
      horizontal.set(k, [...(horizontal.get(k) ?? []), s]);
      sideways.push(s);
    } else {
      const k = Math.round(s.a.x);
      vertical.set(k, [...(vertical.get(k) ?? []), s]);
      upright.push(s);
    }
  }
  const kin = (s: Segment) => s.ends.some((e) => ends.includes(e));
  // What an edge between neighbouring grid points costs, beyond its length and turns.
  const edgeCost = (x1: number, y1: number, x2: number, y2: number) => {
    const length = Math.abs(x2 - x1) + Math.abs(y2 - y1);
    const across = y1 === y2;
    let cost = length * (1 + ((across ? middles.y.has(Math.round(y1)) : middles.x.has(Math.round(x1))) ? 0 : OFFLINE));
    for (const { box } of near) {
      if (across) {
        if (y1 > box.y && y1 < box.y + box.height) cost += THROUGH * within(x1, x2, box.x, box.x + box.width);
        if (y1 > box.y - CLEAR && y1 < box.y + box.height + CLEAR)
          cost += NEAR * within(x1, x2, box.x - CLEAR, box.x + box.width + CLEAR);
      } else {
        if (x1 > box.x && x1 < box.x + box.width) cost += THROUGH * within(y1, y2, box.y, box.y + box.height);
        if (x1 > box.x - CLEAR && x1 < box.x + box.width + CLEAR)
          cost += NEAR * within(y1, y2, box.y - CLEAR, box.y + box.height + CLEAR);
      }
    }
    if (across) {
      for (const s of horizontal.get(Math.round(y1)) ?? []) {
        const along = within(x1, x2, Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x));
        if (along > 0) cost += kin(s) ? -along * (1 - TRUNK) : along * ALONG;
      }
      const lo = Math.min(x1, x2),
        hi = Math.max(x1, x2);
      for (const s of upright)
        if (s.a.x > lo && s.a.x < hi && y1 > Math.min(s.a.y, s.b.y) + 0.5 && y1 < Math.max(s.a.y, s.b.y) - 0.5 && !kin(s))
          cost += CROSS;
    } else {
      for (const s of vertical.get(Math.round(x1)) ?? []) {
        const along = within(y1, y2, Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y));
        if (along > 0) cost += kin(s) ? -along * (1 - TRUNK) : along * ALONG;
      }
      const lo = Math.min(y1, y2),
        hi = Math.max(y1, y2);
      for (const s of sideways)
        if (s.a.y > lo && s.a.y < hi && x1 > Math.min(s.a.x, s.b.x) + 0.5 && x1 < Math.max(s.a.x, s.b.x) - 0.5 && !kin(s))
          cost += CROSS;
    }
    return cost;
  };
  const states = nx * ny * 4;
  const g = new Float64Array(states).fill(Infinity);
  const from = new Int32Array(states).fill(-1);
  const heap = new Heap();
  const goalAt = new Map<number, Port[]>();
  for (const q of goals) {
    const i = index(X, q.stub.x),
      j = index(Y, q.stub.y);
    if (i < 0 || j < 0) continue;
    const node = j * nx + i;
    goalAt.set(node, [...(goalAt.get(node) ?? []), q]);
  }
  const h = (x: number, y: number) => {
    let least = Infinity;
    for (const q of goals) least = Math.min(least, Math.abs(q.stub.x - x) + Math.abs(q.stub.y - y));
    return least * TRUNK;
  };
  const steps = new Float64Array(nx * ny * 4).fill(NaN);
  const startOf = new Map<number, Port>();
  for (const p of starts) {
    const i = index(X, p.stub.x),
      j = index(Y, p.stub.y);
    if (i < 0 || j < 0) continue;
    const key = (j * nx + i) * 4 + p.dir;
    // The stub costs what any other line does: running along another link's is no cheaper
    // for being next to a module.
    const cost = p.cost + edgeCost(p.at.x, p.at.y, p.stub.x, p.stub.y);
    if (cost < g[key]) {
      g[key] = cost;
      startOf.set(key, p);
      heap.push(key, cost + h(p.stub.x, p.stub.y));
    }
  }
  let best = Infinity,
    bestKey = -1,
    bestGoal: Port | undefined;
  while (heap.size) {
    const [key, f] = heap.pop();
    if (f >= best) break;
    const cost = g[key];
    if (f - h(X[(key >> 2) % nx], Y[Math.floor((key >> 2) / nx)]) > cost + 1e-6) continue;
    const node = key >> 2,
      dir = (key & 3) as Dir;
    const i = node % nx,
      j = Math.floor(node / nx);
    for (const q of goalAt.get(node) ?? []) {
      const arrive = back[q.dir];
      if (dir === q.dir) continue;
      const total = cost + (dir === arrive ? 0 : BEND) + q.cost + edgeCost(q.stub.x, q.stub.y, q.at.x, q.at.y);
      if (total < best) {
        best = total;
        bestKey = key;
        bestGoal = q;
      }
    }
    for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
      if (d === back[dir]) continue;
      const i2 = i + DX[d],
        j2 = j + DY[d];
      if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) continue;
      const next = ((j2 * nx + i2) << 2) | d;
      const at = (node << 2) | d;
      if (Number.isNaN(steps[at])) steps[at] = edgeCost(X[i], Y[j], X[i2], Y[j2]);
      const step = steps[at] + (d === dir ? 0 : BEND);
      const total = cost + Math.max(step, 0.01);
      if (total < g[next]) {
        g[next] = total;
        from[next] = key;
        heap.push(next, total + h(X[i2], Y[j2]));
      }
    }
  }
  if (bestKey < 0 || !bestGoal) return undefined;
  const path: Point[] = [];
  let key = bestKey,
    first = bestKey;
  while (key >= 0) {
    const node = key >> 2;
    path.push({ x: X[node % nx], y: Y[Math.floor(node / nx)] });
    first = key;
    key = from[key];
  }
  const start = startOf.get(first);
  if (!start) return undefined;
  path.reverse();
  const points = simplified([start.at, ...path, bestGoal.at]);
  // Whether it had to go through a module, which a wider search may avoid.
  let blocked = false;
  for (let k = 1; k < points.length && !blocked; k++) {
    const a = points[k - 1],
      b = points[k];
    for (const { box } of near) {
      const t = Math.abs(a.y - b.y) < 0.5
        ? a.y > box.y && a.y < box.y + box.height && within(a.x, b.x, box.x, box.x + box.width) > 1
        : a.x > box.x && a.x < box.x + box.width && within(a.y, b.y, box.y, box.y + box.height) > 1;
      if (t && !(k === 1 || k === points.length - 1)) blocked = true;
    }
  }
  return { points, from: start, to: bestGoal, blocked, cost: best };
}

/** Lines that run along each other without belonging together are set apart, each moved
 * square to itself; the turns at its ends move with it. Lines of links that leave or enter
 * the same module are a trunk and stay together. */
function apart(routes: Map<string, { points: Point[]; ends: string[] }>) {
  type Run = { id: string; k: number; lo: number; hi: number; at: number; ends: string[] };
  for (const across of [true, false]) {
    const runs: Run[] = [];
    for (const [id, r] of routes) {
      const p = r.points;
      // The first and last segments meet their modules and stay where they are.
      for (let k = 2; k < p.length - 1; k++) {
        const a = p[k - 1],
          b = p[k];
        const flat = Math.abs(a.y - b.y) < 0.5;
        if (flat !== across) continue;
        runs.push({
          id,
          k,
          lo: across ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
          hi: across ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
          at: across ? a.y : a.x,
          ends: r.ends,
        });
      }
    }
    runs.sort((a, b) => a.at - b.at || a.lo - b.lo);
    const done = new Set<Run>();
    for (const run of runs) {
      if (done.has(run)) continue;
      // Every run on the same line that overlaps this one, and those overlapping them.
      const cluster = [run];
      for (let changed = true; changed; ) {
        changed = false;
        for (const other of runs)
          if (
            !cluster.includes(other) &&
            Math.abs(other.at - run.at) < 0.5 &&
            cluster.some((c) => Math.min(c.hi, other.hi) - Math.max(c.lo, other.lo) > 1)
          ) {
            cluster.push(other);
            changed = true;
          }
      }
      cluster.forEach((c) => done.add(c));
      // Runs of links that share a module end belong to one bundle.
      const bundles: Run[][] = [];
      for (const c of cluster) {
        const bundle = bundles.find((b) => b.some((o) => o.ends.some((e) => c.ends.includes(e))));
        if (bundle) bundle.push(c);
        else bundles.push([c]);
      }
      if (bundles.length < 2) continue;
      bundles.forEach((bundle, n) => {
        const shift = (n - (bundles.length - 1) / 2) * APART;
        for (const c of bundle) {
          const p = routes.get(c.id)!.points;
          for (const at of [c.k - 1, c.k])
            if (across) p[at] = { ...p[at], y: p[at].y + shift };
            else p[at] = { ...p[at], x: p[at].x + shift };
        }
      });
    }
  }
}

/** Whether a route crosses one of the lines laid before it. */
function crosses(points: Point[], laid: Segment[]) {
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1],
      b = points[k];
    for (const s of laid) {
      const flat = Math.abs(a.y - b.y) < 0.5,
        other = Math.abs(s.a.y - s.b.y) < 0.5;
      if (flat === other) continue;
      const [h, v] = flat ? [[a, b], [s.a, s.b]] : [[s.a, s.b], [a, b]];
      const y = h[0].y,
        x = v[0].x;
      if (
        x > Math.min(h[0].x, h[1].x) + 0.5 &&
        x < Math.max(h[0].x, h[1].x) - 0.5 &&
        y > Math.min(v[0].y, v[1].y) + 0.5 &&
        y < Math.max(v[0].y, v[1].y) - 0.5
      )
        return true;
    }
  }
  return false;
}

/** Whether a segment runs along a segment of another link for most of its length. */
function sharedOf(id: string, routes: Map<string, { points: Point[] }>) {
  const p = routes.get(id)!.points;
  const others: Segment[] = [];
  for (const [other, r] of routes)
    if (other !== id)
      for (let k = 1; k < r.points.length; k++) others.push({ a: r.points[k - 1], b: r.points[k], link: other, ends: [] });
  return p.slice(1).map((b, k) => {
    const a = p[k];
    const flat = Math.abs(a.y - b.y) < 0.5;
    const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    let along = 0;
    for (const s of others) {
      if (flat && Math.abs(s.a.y - s.b.y) < 0.5 && Math.abs(s.a.y - a.y) < 0.5)
        along += within(a.x, b.x, Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x));
      if (!flat && Math.abs(s.a.x - s.b.x) < 0.5 && Math.abs(s.a.x - a.x) < 0.5)
        along += within(a.y, b.y, Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y));
    }
    return along >= length * 0.5;
  });
}

/** Routes for links, in the order given, among the modules of a scene. A link is left
 * unrouted (its drawing takes its own way) where an end is a point inside its module, an end
 * is missing, or one module holds the other. `open` names modules routes may cross, such as
 * a backdrop. A link that is a `branch` (one of several labelled ways out of a decision)
 * leaves by a side of its own instead of sharing a trunk. `round` names modules whose
 * outline meets their box only at the middles of its sides, such as a decision's diamond. */
export function routeLinks(
  links: RouteLink[],
  boxes: Map<string, Bounds>,
  open: Set<string> = new Set(),
  round: Set<string> = new Set(),
): Map<string, Route> {
  const obstacles = obstaclesOf(boxes, links, open);
  const flow = flowOf(links, boxes);
  const all = [...boxes.values()];
  const extent = all.length
    ? grow(
        {
          x: Math.min(...all.map((b) => b.x)),
          y: Math.min(...all.map((b) => b.y)),
          width: Math.max(...all.map((b) => b.x + b.width)) - Math.min(...all.map((b) => b.x)),
          height: Math.max(...all.map((b) => b.y + b.height)) - Math.min(...all.map((b) => b.y)),
        },
        CLEAR * 3,
      )
    : { x: 0, y: 0, width: 0, height: 0 };
  type Found = { points: Point[]; ends: string[]; fromSide: Side; toSide: Side; uses: [string, Use][] };
  /** `in:` or `out:` and how the link looks, or a branch. */
  type Use = string;
  const found = new Map<string, Found>();
  // How links already leave (out, or as a branch) and enter (in) each side of each module.
  const used = new Map<string, Use[]>();
  const routable = links.filter((link) => {
    const a = boxes.get(link.from.moduleId),
      b = boxes.get(link.to.moduleId);
    return a && b && link.from.moduleId !== link.to.moduleId && !overlaps(a, b);
  });
  const route = (link: RouteLink & { branch?: boolean }) => {
    const a = boxes.get(link.from.moduleId)!,
      b = boxes.get(link.to.moduleId)!;
    const flat: [boolean, boolean] = [!round.has(link.from.moduleId), !round.has(link.to.moduleId)];
    const starts = portsOf(link.from, a, towards(a, b, flow), obstacles, flat[0]),
      goals = portsOf(link.to, b, towards(b, a, flow), obstacles, flat[1]);
    if (!starts || !goals) return;
    aligned(starts, goals, a, b, obstacles, flat);
    const look = link.bundle ?? "";
    const role: Use = link.branch ? "branch" : `out:${look}`,
      entry: Use = `in:${look}`;
    // A side where links go the other way, or look different, or where a branch leaves, is
    // not shared.
    const clash = (module: string, p: Port, mine: Use) => {
      const there = used.get(`${module}:${p.side}:${p.slot}`) ?? [];
      if (!mine.startsWith("in") && there.some((u) => u === "branch" || (!u.startsWith("in") && mine === "branch"))) return FORK;
      if (there.some((u) => u !== mine)) return CONTRARY;
      // Beside a line going the other way, a side's other points read as a lane of two.
      const side = [0, 1, 2].flatMap((slot) => used.get(`${module}:${p.side}:${slot}`) ?? []);
      return p.slot !== 1 && side.some((u) => u.startsWith("in") !== mine.startsWith("in")) ? ONCOMING : 0;
    };
    for (const p of starts) p.cost += clash(link.from.moduleId, p, role);
    for (const q of goals) q.cost += clash(link.to.moduleId, q, entry);
    const ends = [link.branch ? `branch:${link.id}` : `out:${link.from.moduleId}:${look}`, `in:${link.to.moduleId}:${look}`];
    const laid: Segment[] = [];
    for (const [id, r] of found)
      if (id !== link.id)
        for (let k = 1; k < r.points.length; k++) laid.push({ a: r.points[k - 1], b: r.points[k], link: id, ends: r.ends });
    // A link usually finds its way near its two modules; it searches the whole scene only
    // when there is no way around the modules there.
    const near = grow(
      {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
        height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y),
      },
      CLEAR * 8,
    );
    let result = search(starts, goals, obstacles, laid, ends, near);
    // Around the figure may be a way that crosses no line, which the search near the two
    // modules cannot see.
    if (!result || result.blocked || crosses(result.points, laid)) {
      const x = Math.min(extent.x, near.x),
        y = Math.min(extent.y, near.y);
      const wide = {
        x,
        y,
        width: Math.max(extent.x + extent.width, near.x + near.width) - x,
        height: Math.max(extent.y + extent.height, near.y + near.height) - y,
      };
      const around = search(starts, goals, obstacles, laid, ends, wide);
      if (around && (!result || result.blocked || around.cost < result.cost)) result = around;
    }
    if (!result) return;
    const uses: [string, Use][] = [
      [`${link.from.moduleId}:${result.from.side}:${result.from.slot}`, role],
      [`${link.to.moduleId}:${result.to.side}:${result.to.slot}`, entry],
    ];
    for (const [key, use] of uses) used.set(key, [...(used.get(key) ?? []), use]);
    found.set(link.id, { points: result.points, ends, fromSide: result.from.side, toSide: result.to.side, uses });
  };
  for (const link of routable) route(link);
  // Each link is laid again among all the others, so one laid early gives way to those
  // that came after it where they need its place more.
  for (const link of routable) {
    const was = found.get(link.id);
    if (was)
      for (const [key, use] of was.uses) {
        const list = used.get(key)!;
        list.splice(list.indexOf(use), 1);
      }
    found.delete(link.id);
    route(link);
    if (!found.has(link.id) && was) {
      found.set(link.id, was);
      for (const [key, use] of was.uses) used.set(key, [...(used.get(key) ?? []), use]);
    }
  }
  apart(found);
  const routes = new Map<string, Route>();
  for (const [id, r] of found) {
    const points = simplified(r.points);
    routes.set(id, { points, fromSide: r.fromSide, toSide: r.toSide, shared: [] });
  }
  for (const [id, r] of routes) r.shared = sharedOf(id, routes);
  placeLabels(routable, routes, obstacles);
  return routes;
}

/** Where the words of each routed link go, in order, each clear of the modules, of every
 * line and of the words placed before it as far as it can be: beside one of its own
 * segments, near the middle of a long one, on the side the author named or else above or
 * to the left. The geometry is the one the library arrow draws its words with. */
function placeLabels(links: RouteLink[], routes: Map<string, Route>, obstacles: { box: Bounds }[]) {
  const lines: { a: Point; b: Point; link: string }[] = [];
  for (const [id, r] of routes) for (let k = 1; k < r.points.length; k++) lines.push({ a: r.points[k - 1], b: r.points[k], link: id });
  const placed: Bounds[] = [];
  const area = (a: Bounds, b: Bounds) =>
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const cuts = (box: Bounds, a: Point, b: Point) =>
    Math.min(a.x, b.x) < box.x + box.width &&
    Math.max(a.x, b.x) > box.x &&
    Math.min(a.y, b.y) < box.y + box.height &&
    Math.max(a.y, b.y) > box.y;
  for (const link of links) {
    const r = routes.get(link.id),
      words = link.words;
    if (!r || !words || r.points.length < 2) continue;
    const height = words.size * 1.25;
    const longest = Math.max(...r.points.slice(1).map((q, k) => Math.abs(q.x - r.points[k].x) + Math.abs(q.y - r.points[k].y)));
    let best: { cost: number; at: Point; side: "above" | "below"; box: Bounds } | undefined;
    for (let k = 1; k < r.points.length; k++) {
      const p = r.points[k - 1],
        q = r.points[k];
      const upright = Math.abs(p.x - q.x) < 0.5;
      const length = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
      const room = upright ? height + 12 : words.width + 16;
      for (const t of [0.5, 0.35, 0.65, 0.2, 0.8])
        for (const side of ["above", "below"] as const) {
          const at = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
          // Above a level line, or left of an upright one; below, or to its right.
          const box: Bounds = upright
            ? {
                x: side === "above" ? at.x - words.size * 0.5 - words.stroke - words.width : at.x + words.size * 0.5 + words.stroke,
                y: at.y - height / 2,
                width: words.width,
                height,
              }
            : {
                x: at.x - words.width / 2,
                y: side === "above" ? at.y - words.size * 0.9 - words.stroke - height / 2 : at.y + words.size * 0.9 + words.stroke - height / 2,
                width: words.width,
                height,
              };
          const whole = words.width * height || 1;
          let cost = 0;
          for (const o of obstacles) cost += (area(box, o.box) / whole) * 1200;
          for (const o of placed) cost += (area(grow(box, 4), o) / whole) * 1500;
          const pad = grow(box, 3);
          for (const s of lines) if (!(s.link === link.id && s.a === p && s.b === q) && cuts(pad, s.a, s.b)) cost += 500;
          if (r.shared[k - 1]) cost += 300;
          // Words beside a short segment, or off along it, may read as another line's.
          cost += Math.max(0, room - length * Math.min(t, 1 - t) * 2) * 4;
          cost += (1 - length / longest) * 60 + Math.abs(t - 0.5) * 40;
          if (side !== (words.side ?? "above")) cost += words.side ? 400 : 50;
          if (!best || cost < best.cost - 0.01) best = { cost, at, side, box };
        }
    }
    if (!best) continue;
    placed.push(best.box);
    r.label = { at: best.at, side: best.side };
  }
}

/** Whether boxes overlap; exported for the renderer, which leaves overlapping modules to
 * draw their links their own way. */
export { overlaps };

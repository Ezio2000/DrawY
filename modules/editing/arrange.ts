import { Graph, layout as layered } from "@dagrejs/dagre";
import {
  boxOf,
  drawingOf,
  type Arrange,
  type Bounds,
  type Each,
  type Instance,
  type Link,
  type ModuleEdit,
  type Problem,
  type Scene,
  type Work,
  type WorkEdit,
} from "../contracts/index.ts";
import { routing, textWidth } from "../contracts/routing.ts";
import { layOn } from "./apply.ts";

/* Places modules by their links instead of by coordinates. An arrangement is worked out
 * once, into each module's own bounds, by the author's write and by a person tidying a
 * figure alike: nothing of it stays in the work, so every module it placed is afterwards
 * dragged about like any other. `settled` turns a write's `each` and `arrange` into plain
 * records before the write is laid on the work. */

type Size = { width: number; height: number };
const PLACEHOLDER = [0, 0, 1, 1];
const round = (n: number) => Math.round(n);

/** The size that holds a module's words, by the shape its drawing gives them. */
function wordsSize(data: Record<string, unknown>, base: Size): Size {
  const size = Number(data.size ?? 15) || 15;
  const shape = String(data.shape ?? "box");
  if (shape === "initial" || shape === "final") return { width: 28, height: 28 };
  const words = String(data.title ?? data.text ?? data.label ?? data.name ?? "");
  const note = typeof data.note === "string" ? data.note : "";
  const weight = Number(data.weight ?? 600);
  const lines = words.split("\n");
  const widest = Math.max(0, ...lines.map((l) => textWidth(l, size, weight)));
  const noteWide = note ? Math.max(...note.split("\n").map((l) => textWidth(l, size * 0.8))) : 0;
  // One line while it stays a comfortable width, then two or three.
  const limit = Math.max(size * 11, 150);
  const rows = Math.min(3, Math.max(1, Math.ceil(widest / limit)));
  const noteRows = Math.min(3, Math.max(1, Math.ceil(noteWide / (limit * 1.15))));
  const textWide = Math.max((widest / rows) * (rows > 1 ? 1.12 : 1), noteWide / noteRows);
  const textHigh =
    lines.length * rows * size * 1.25 + (note ? noteRows * size * 0.8 * 1.3 + size * 0.2 : 0);
  const icon = typeof data.icon === "string" && data.icon ? size * 2.6 : 0;
  let width = textWide + icon + size * 2.2,
    height = Math.max(textHigh, icon * 0.8) + size * 1.5;
  if (shape === "diamond") {
    width = textWide / 0.52 + size;
    height = Math.max(textHigh / 0.5, size * 4.4);
  } else if (shape === "circle") {
    width = height = Math.max(textWide, textHigh) / 0.68 + size * 0.5;
  } else if (shape === "pill") width += size * 0.9;
  else if (shape === "cylinder") height += size * 1.5;
  else if (shape === "document") height += size * 0.7;
  else if (shape === "parallelogram" || shape === "hexagon") width += size * 1.4;
  else if (shape === "queue") width += size * 1.6;
  // A label is only its words; a block keeps a least size so short names do not look pinched.
  const bare = data.title === undefined && data.text !== undefined;
  return {
    width: round(Math.max(bare ? size * 2 : Math.min(base.width, 96), width)),
    height: round(Math.max(bare ? size * 1.5 : 40, height)),
  };
}
/** The size that holds a table's rows. */
function rowsSize(data: Record<string, unknown>): Size {
  const size = Number(data.size ?? 14) || 14;
  const rows = (Array.isArray(data.rows) ? data.rows : []).map((r) =>
    typeof r === "string" ? (/^-{2,}$/.test(r) ? { rule: true } : { name: r }) : (r ?? {}),
  ) as { name?: unknown; type?: unknown; rule?: boolean }[];
  const fields = rows.filter((r) => !r.rule);
  const keyed = data.keys === false ? 0 : size * 2;
  const widest = Math.max(
    textWidth(String(data.name ?? ""), size, 700) + size * 2,
    ...fields.map(
      (r) =>
        keyed +
        textWidth(String(r.name ?? ""), size * 0.9, 600) +
        (r.type ? textWidth(String(r.type), size * 0.82) + size * 1.2 : 0) +
        size * 1.6,
    ),
  );
  return {
    width: round(Math.min(380, Math.max(150, widest))),
    height: round(
      size * (data.stereotype ? 3.3 : 2.3) +
        fields.length * size * 1.75 +
        (rows.length - fields.length) * size * 0.6 +
        size * 0.6,
    ),
  };
}
/** The size a module takes when it is placed without one. */
export function fitted(work: Work, m: Pick<Instance, "drawingId" | "data">): Size {
  const drawing = drawingOf(work, m.drawingId);
  const data = { ...drawing?.defaults, ...m.data };
  const base = drawing?.size ?? { width: 160, height: 60 };
  if (drawing?.fit === "words") return wordsSize(data, base);
  if (drawing?.fit === "rows") return rowsSize(data);
  return base;
}
/** The room a frame keeps round its members, with its name on top or below. */
function framePad(work: Work, m: Instance) {
  const data = { ...drawingOf(work, m.drawingId)?.defaults, ...m.data };
  const size = Number(data.size ?? 15) || 15;
  const named = data.title || data.note ? size * 2.1 : 0;
  const below = data.titleAt === "bottom-left";
  return { side: 20, top: 20 + (below ? 0 : named), bottom: 20 + (below ? named : 0) };
}

interface Placed {
  bounds: Map<string, Bounds>;
  data: Map<string, Record<string, unknown>>;
  problems: Problem[];
}
type Node = { id: string; width: number; height: number; x: number; y: number };

/** The links among some modules, each once, with the room its words need. */
function linksAmong(work: Work, scene: Scene, ids: Set<string>) {
  return scene.links
    .filter((l) => ids.has(l.from.moduleId) && ids.has(l.to.moduleId) && l.from.moduleId !== l.to.moduleId)
    .map((l) => ({
      from: l.from.moduleId,
      to: l.to.moduleId,
      label: routing({ ...drawingOf(work, l.drawingId)?.defaults, ...l.data }, work.style).label,
    }));
}
/** Each module's rank by its links: sources first, every other one rank past the furthest
 * module that leads to it; a link that would close a circle is passed over. */
function ranksOf(ids: string[], links: { from: string; to: string }[]) {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const l of links) out.get(l.from)!.push(l.to);
  const rank = new Map<string, number>(),
    state = new Map<string, 1 | 2>(),
    back = new Set<string>();
  // Depth-first, to know which links run backwards.
  const visit = (id: string) => {
    state.set(id, 1);
    for (const to of out.get(id)!) {
      if (state.get(to) === 1) back.add(id + "\n" + to);
      else if (!state.has(to)) visit(to);
    }
    state.set(id, 2);
  };
  for (const id of ids) if (!state.has(id)) visit(id);
  const forward = links.filter((l) => !back.has(l.from + "\n" + l.to));
  const incoming = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const l of forward) incoming.get(l.to)!.push(l.from);
  const rankOf = (id: string): number => {
    if (rank.has(id)) return rank.get(id)!;
    rank.set(id, 0);
    const r = Math.max(-1, ...incoming.get(id)!.map(rankOf)) + 1;
    rank.set(id, r);
    return r;
  };
  ids.forEach(rankOf);
  return rank;
}
/** Orders the modules of each row to cross as few links as it can: each takes the middle of
 * its neighbours in the other rows, over a few sweeps down and up. */
function ordered(rows: string[][], links: { from: string; to: string }[]) {
  const near = new Map<string, string[]>();
  for (const l of links) {
    near.set(l.from, [...(near.get(l.from) ?? []), l.to]);
    near.set(l.to, [...(near.get(l.to) ?? []), l.from]);
  }
  const place = new Map<string, number>();
  const index = () => rows.forEach((row) => row.forEach((id, i) => place.set(id, (i + 0.5) / row.length)));
  index();
  for (let sweep = 0; sweep < 6; sweep++) {
    const list = sweep % 2 ? [...rows].reverse() : rows;
    for (const row of list) {
      const here = new Set(row);
      const want = new Map(
        row.map((id) => {
          const others = (near.get(id) ?? []).filter((n) => !here.has(n) && place.has(n));
          return [
            id,
            others.length ? others.reduce((s, n) => s + place.get(n)!, 0) / others.length : place.get(id)!,
          ];
        }),
      );
      row.sort((a, b) => want.get(a)! - want.get(b)!);
      row.forEach((id, i) => place.set(id, (i + 0.5) / row.length));
    }
  }
  return rows;
}

/** Ranks along the direction by the links, as a flowchart or a dependency graph is laid. */
function flow(
  nodes: Node[],
  links: { from: string; to: string; label?: Size }[],
  direction: "down" | "right" | "up" | "left",
  gap: [number, number],
  frames: Record<string, string[]>,
) {
  const g = new Graph({ compound: true, multigraph: true });
  g.setGraph({
    rankdir: { down: "TB", right: "LR", up: "BT", left: "RL" }[direction],
    ranksep: gap[0],
    nodesep: gap[1],
    edgesep: 16,
    marginx: 0,
    marginy: 0,
  });
  g.setDefaultEdgeLabel(() => ({}));
  const framed = new Set(Object.keys(frames));
  for (const n of nodes) g.setNode(n.id, framed.has(n.id) ? {} : { width: n.width, height: n.height });
  const known = new Set(nodes.map((n) => n.id));
  for (const [frame, members] of Object.entries(frames))
    for (const member of members) if (known.has(member) && known.has(frame)) g.setParent(member, frame);
  // A link to a frame itself stands for one to what it holds.
  const leaf = (id: string): string | undefined => {
    for (let at = id, n = 0; n < 8; n++) {
      if (!framed.has(at)) return at;
      const first = (frames[at] ?? []).find((m) => known.has(m));
      if (!first) return undefined;
      at = first;
    }
    return undefined;
  };
  links.forEach((l, i) => {
    const from = leaf(l.from),
      to = leaf(l.to);
    if (!from || !to || from === to) return;
    g.setEdge(from, to, {}, String(i));
  });
  layered(g);
  for (const n of nodes) {
    const at = g.node(n.id);
    if (!at || framed.has(n.id)) continue;
    n.x = at.x - n.width / 2;
    n.y = at.y - n.height / 2;
  }
}
/** Ranks the figure names itself, each a row (or a column) with its modules ordered by
 * their links and centred on the widest. */
function tiered(
  nodes: Node[],
  links: { from: string; to: string }[],
  tiers: string[][],
  direction: "down" | "right" | "up" | "left",
  gap: [number, number],
) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rows = ordered(
    tiers.map((t) => t.filter((id) => byId.has(id))),
    links,
  );
  const level = direction === "right" || direction === "left";
  const along = (n: Node) => (level ? n.width : n.height),
    across = (n: Node) => (level ? n.height : n.width);
  // Along the direction, each row is as deep as its largest module, and the gap after it
  // widens with the links that pass through it, each of which needs a lane of its own.
  const rank = new Map<string, number>();
  rows.forEach((row, r) => row.forEach((id) => rank.set(id, r)));
  const passing = rows.map((_, r) =>
    links.filter((l) => {
      const a = rank.get(l.from),
        b = rank.get(l.to);
      return a !== undefined && b !== undefined && Math.min(a, b) <= r && Math.max(a, b) > r;
    }).length,
  );
  let run = 0,
    last = gap[0];
  const starts = rows.map((row, r) => {
    const depth = Math.max(0, ...row.map((id) => along(byId.get(id)!)));
    const start = run;
    last = gap[0] + Math.min(160, Math.max(0, passing[r] - 4) * 7);
    run += depth + last;
    return { start, depth };
  });
  const total = run - last;
  // Across it, each module wants to stand level with the ones it is linked to in the other
  // rows, so a link between two rows runs straight where it can; its neighbours in its own
  // row hold it to its place in their order.
  const near = new Map<string, string[]>();
  const rowOf = new Map<string, number>();
  rows.forEach((row, r) => row.forEach((id) => rowOf.set(id, r)));
  for (const l of links) {
    if (!rowOf.has(l.from) || !rowOf.has(l.to) || rowOf.get(l.from) === rowOf.get(l.to)) continue;
    near.set(l.from, [...(near.get(l.from) ?? []), l.to]);
    near.set(l.to, [...(near.get(l.to) ?? []), l.from]);
  }
  const centre = new Map<string, number>();
  const extent = rows.map(
    (row) => row.reduce((s, id) => s + across(byId.get(id)!), 0) + gap[1] * Math.max(0, row.length - 1),
  );
  const widest = Math.max(0, ...extent);
  rows.forEach((row, r) => {
    let at = (widest - extent[r]) / 2;
    for (const id of row) {
      centre.set(id, at + across(byId.get(id)!) / 2);
      at += across(byId.get(id)!) + gap[1];
    }
  });
  for (let pass = 0; pass < 8; pass++)
    for (const row of pass % 2 ? [...rows].reverse() : rows) {
      if (!row.length) continue;
      const want = row.map((id) => {
        const others = near.get(id) ?? [];
        return others.length ? others.reduce((s, n) => s + centre.get(n)!, 0) / others.length : centre.get(id)!;
      });
      const apart = (i: number) => (across(byId.get(row[i - 1])!) + across(byId.get(row[i])!)) / 2 + gap[1];
      // Packed from the left and from the right; halfway between the two keeps every module
      // clear of its neighbours and as near as both allow to where it wants to be.
      const left = [...want],
        right = [...want];
      for (let i = 1; i < row.length; i++) left[i] = Math.max(left[i], left[i - 1] + apart(i));
      for (let i = row.length - 2; i >= 0; i--) right[i] = Math.min(right[i], right[i + 1] - apart(i + 1));
      row.forEach((id, i) => centre.set(id, (left[i] + right[i]) / 2));
    }
  rows.forEach((row, r) => {
    const { start, depth } = starts[r];
    for (const id of row) {
      const n = byId.get(id)!;
      const a = start + (depth - along(n)) / 2,
        b = centre.get(id)! - across(n) / 2;
      const flipped = direction === "up" || direction === "left" ? total - a - along(n) : a;
      if (level) {
        n.x = flipped;
        n.y = b;
      } else {
        n.x = b;
        n.y = flipped;
      }
    }
  });
}
/** Each module under the one that links to it, a parent centred over its children; with
 * `both`, the root's children go to either side of it, as a mind map's branches do. */
function tree(
  nodes: Node[],
  links: { from: string; to: string }[],
  direction: "down" | "right" | "up" | "left" | "both",
  gap: [number, number],
) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parent = new Map<string, string>(),
    children = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const reaches = (from: string, to: string) => {
    for (let at: string | undefined = from; at; at = parent.get(at)) if (at === to) return true;
    return false;
  };
  for (const l of links)
    if (!parent.has(l.to) && !reaches(l.from, l.to)) {
      parent.set(l.to, l.from);
      children.get(l.from)!.push(l.to);
    }
  const roots = nodes.filter((n) => !parent.has(n.id)).map((n) => n.id);
  type Way = "down" | "right" | "up" | "left";
  /** Lays one subtree growing one way from (0, 0) and returns its breadth. */
  const grow = (root: string, kids: string[], way: Way, depthAt: number, breadthAt: number) => {
    const level = way === "right" || way === "left";
    const along = (n: Node) => (level ? n.width : n.height),
      across = (n: Node) => (level ? n.height : n.width);
    const span = new Map<string, number>();
    const measure = (id: string, own = children.get(id)!): number => {
      const kidsSpan = own.reduce((s, c) => s + measure(c), 0) + gap[1] * Math.max(0, own.length - 1);
      const v = Math.max(across(byId.get(id)!), kidsSpan);
      span.set(id, v);
      return v;
    };
    // Levels are as deep as their largest module, so siblings' children line up.
    const depths: number[] = [];
    const deepen = (id: string, d: number, own = children.get(id)!) => {
      depths[d] = Math.max(depths[d] ?? 0, along(byId.get(id)!));
      for (const c of own) deepen(c, d + 1);
    };
    measure(root, kids);
    deepen(root, 0, kids);
    const starts: number[] = [];
    depths.reduce((at, d, i) => ((starts[i] = at), at + d + gap[0]), 0);
    const put = (id: string, d: number, from: number, own = children.get(id)!) => {
      const n = byId.get(id)!;
      const a = depthAt + (way === "up" || way === "left" ? -starts[d] - along(n) : starts[d]),
        b = breadthAt + from + (span.get(id)! - across(n)) / 2;
      if (level) {
        n.x = a;
        n.y = b;
      } else {
        n.x = b;
        n.y = a;
      }
      const kidsSpan = own.reduce((s, c) => s + span.get(c)!, 0) + gap[1] * Math.max(0, own.length - 1);
      let at = from + (span.get(id)! - kidsSpan) / 2;
      for (const c of own) {
        put(c, d + 1, at);
        at += span.get(c)! + gap[1];
      }
    };
    put(root, 0, 0, kids);
    return span.get(root)!;
  };
  let offset = 0;
  for (const root of roots) {
    const kids = children.get(root)!;
    if (direction === "both") {
      // The first half of the branches to the right, the rest to the left, the root between.
      const half = Math.ceil(kids.length / 2);
      const r = byId.get(root)!;
      const right = grow(root, kids.slice(0, half), "right", 0, offset);
      const rightPlace = { x: r.x, y: r.y };
      const left = grow(root, kids.slice(half), "left", 0, offset);
      // Both sides are laid from the root's near edge; centre the root on the taller side.
      const tall = Math.max(right, left);
      const shift = (ids: string[], by: number) => {
        const move = (id: string) => {
          byId.get(id)!.y += by;
          children.get(id)!.forEach(move);
        };
        ids.forEach(move);
      };
      shift(kids.slice(0, half), (tall - right) / 2);
      shift(kids.slice(half), (tall - left) / 2);
      // The left side was grown from x = 0 leftwards with the root's width before it.
      const leftKids = kids.slice(half);
      const moveX = (id: string, by: number) => {
        byId.get(id)!.x += by;
        children.get(id)!.forEach((c) => moveX(c, by));
      };
      leftKids.forEach((id) => moveX(id, r.width));
      r.x = rightPlace.x;
      r.y = offset + (tall - r.height) / 2;
      offset += tall + gap[1] * 2;
    } else {
      offset += grow(root, kids, direction, 0, offset) + gap[1] * 2;
    }
  }
}
/** Lanes: each module in the lane it is listed in, and along the lanes in the order of the
 * links. Lanes are equally broad, as the lanes drawing draws them. */
function lanes(
  nodes: Node[],
  links: { from: string; to: string }[],
  listed: string[][],
  across: boolean,
  gap: [number, number],
) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const lane = new Map<string, number>();
  listed.forEach((ids, i) => ids.forEach((id) => byId.has(id) && lane.set(id, i)));
  const ids = [...lane.keys()];
  const rank = ranksOf(ids, links.filter((l) => lane.has(l.from) && lane.has(l.to)));
  // Lanes across the page run left to right: a rank is a column, a lane a row.
  const along = (n: Node) => (across ? n.width : n.height),
    breadth = (n: Node) => (across ? n.height : n.width);
  const ranks = Math.max(0, ...ids.map((id) => rank.get(id)!)) + 1;
  const cells = new Map<string, string[]>();
  for (const id of ids) {
    const key = lane.get(id) + ":" + rank.get(id);
    cells.set(key, [...(cells.get(key) ?? []), id]);
  }
  const depth = Array.from({ length: ranks }, (_, r) =>
    Math.max(0, ...ids.filter((id) => rank.get(id) === r).map((id) => along(byId.get(id)!))),
  );
  const pad = Math.max(24, gap[1] * 0.6);
  const need = Math.max(
    60,
    ...[...cells.values()].map(
      (cell) => cell.reduce((s, id) => s + breadth(byId.get(id)!), 0) + gap[1] * 0.6 * (cell.length - 1),
    ),
  );
  const band = need + pad * 2;
  const starts: number[] = [];
  depth.reduce((at, d, i) => ((starts[i] = at), at + d + gap[0]), gap[0] / 2);
  for (const [key, cell] of cells) {
    const [l, r] = key.split(":").map(Number);
    const total = cell.reduce((s, id) => s + breadth(byId.get(id)!), 0) + gap[1] * 0.6 * (cell.length - 1);
    let at = l * band + (band - total) / 2;
    for (const id of cell) {
      const n = byId.get(id)!;
      const a = starts[r] + (depth[r] - along(n)) / 2;
      if (across) {
        n.x = a;
        n.y = at;
      } else {
        n.x = at;
        n.y = a;
      }
      at += breadth(n) + gap[1] * 0.6;
    }
  }
  const length = (starts.at(-1) ?? 0) + (depth.at(-1) ?? 0) + gap[0] / 2;
  return { band, length, count: listed.length };
}

/** Works one arrangement out on a work as it stands: where each module it names goes, and
 * the data a ground under them takes. `unsized` are modules that have no size of their own
 * yet. */
export function arrangement(
  work: Work,
  sceneId: string,
  op: Arrange,
  unsized: Set<string> = new Set(),
  /** Modules another arrangement of the same write names, which this one leaves to it. */
  claimed: Set<string> = new Set(),
): Placed {
  const placed: Placed = { bounds: new Map(), data: new Map(), problems: [] };
  const scene = work.scenes[sceneId];
  const at = "arrange";
  if (!scene) {
    placed.problems.push({ at: `${at}.scene`, problem: `场景 ${sceneId} 不存在` });
    return placed;
  }
  const have = new Map(scene.modules.map((m) => [m.id, m]));
  const frames = op.frames ?? {};
  const kind = op.layout ?? (op.lanes ? "lanes" : "flow");
  const named =
    op.modules === "all"
      ? scene.modules.map((m) => m.id)
      : (op.modules ?? [
          ...new Set([
            ...scene.modules.filter((m) => unsized.has(m.id) && !claimed.has(m.id)).map((m) => m.id),
            ...(op.tiers ?? []).flat(),
            ...(op.lanes ?? []).flat(),
            ...Object.keys(frames),
            ...Object.values(frames).flat(),
          ]),
        ]);
  const missing = [...new Set([...named, ...(op.ground ? [op.ground] : [])])].filter((id) => !have.has(id));
  if (missing.length)
    placed.problems.push({
      at,
      problem: `arrange 里的模块 ${missing.join("、")} 不在场景 ${sceneId} 里`,
    });
  const ids = named.filter((id) => have.has(id) && id !== op.ground);
  if (!ids.length) {
    if (!missing.length)
      placed.problems.push({
        at,
        problem: "arrange 没有可摆放的模块：给新模块省去 bounds，或用 modules 列出要重新摆放的（\"all\" 是整个场景）",
      });
    return placed;
  }
  const framed = new Set(Object.keys(frames).filter((id) => have.has(id)));
  const direction = op.direction ?? (["down", "right", "up", "left"].includes(work.style.flow) ? work.style.flow : "down");
  // Sizes: a module's own, unless it has none yet or all are to be fitted again; modules of
  // one kind and shape then share the largest, as blocks of one kind should.
  const sizes = new Map<string, Size>();
  const kinds = new Map<string, string[]>();
  for (const id of ids) {
    const m = have.get(id)!;
    if (framed.has(id)) continue;
    if (!unsized.has(id) && !op.fit) {
      sizes.set(id, { width: m.bounds.width, height: m.bounds.height });
      continue;
    }
    if (op.size) {
      sizes.set(id, { width: op.size[0], height: op.size[1] });
      continue;
    }
    const drawing = drawingOf(work, m.drawingId);
    sizes.set(id, fitted(work, m));
    if (drawing?.fit === "words" && (m.data.title !== undefined || drawing.defaults.title !== undefined)) {
      const look = { ...drawing.defaults, ...m.data };
      const key = [m.drawingId, look.shape ?? "", look.size ?? ""].join("\n");
      kinds.set(key, [...(kinds.get(key) ?? []), id]);
    }
  }
  for (const group of kinds.values()) {
    const width = Math.max(...group.map((id) => sizes.get(id)!.width)),
      height = Math.max(...group.map((id) => sizes.get(id)!.height));
    for (const id of group) sizes.set(id, { width, height });
  }
  const nodes: Node[] = ids.map((id) => ({ id, x: 0, y: 0, ...(sizes.get(id) ?? { width: 0, height: 0 }) }));
  const leaves = nodes.filter((n) => !framed.has(n.id));
  const links = linksAmong(work, scene, new Set(ids));
  const labelled = links.some((l) => l.label);
  const level = direction === "right" || direction === "left";
  const widestLabel = Math.max(0, ...links.map((l) => (l.label ? (level ? l.label.width : l.label.height) : 0)));
  const hasFrames = framed.size > 0;
  let ground: { band: number; length: number; count: number } | undefined;
  if (kind === "grid") {
    const columns = op.columns ?? Math.ceil(Math.sqrt(leaves.length));
    const gap = (op.gap as [number, number] | undefined) ?? [48, 48];
    const cellW = Math.max(...leaves.map((n) => n.width)),
      cellH = Math.max(...leaves.map((n) => n.height));
    leaves.forEach((n, i) => {
      n.x = (i % columns) * (cellW + gap[1]) + (cellW - n.width) / 2;
      n.y = Math.floor(i / columns) * (cellH + gap[0]) + (cellH - n.height) / 2;
    });
  } else if (kind === "tree") {
    const gap = (op.gap as [number, number] | undefined) ?? [Math.max(56, widestLabel + 36), 24];
    tree(leaves, links, direction as "down" | "right" | "up" | "left" | "both", gap);
  } else if (kind === "lanes") {
    const groundModule = op.ground ? have.get(op.ground) : undefined;
    const groundData = groundModule
      ? { ...drawingOf(work, groundModule.drawingId)?.defaults, ...groundModule.data }
      : {};
    const across = groundData.direction !== "vertical";
    const gap = (op.gap as [number, number] | undefined) ?? [Math.max(64, (across ? widestLabel : 0) + 48), 40];
    if (!op.lanes?.length)
      placed.problems.push({ at: `${at}.lanes`, problem: "lanes 布局要给 lanes：每条泳道里的模块 ID，按泳道顺序" });
    ground = lanes(leaves, links, op.lanes ?? [], across, gap);
    if (groundModule) {
      // The header is set to hold the lanes' names, so the steps start clear of it.
      const size = Number(groundData.size ?? 14) || 14;
      const names = (Array.isArray(groundData.lanes) ? groundData.lanes : []).map((l) =>
        String((l as { label?: unknown })?.label ?? l ?? ""),
      );
      const header = across
        ? round(Math.max(size * 4, ...names.map((n) => textWidth(n, size, 700))) + size * 2)
        : round(size * 3);
      const count = Math.max(ground.count, names.length, 1);
      placed.data.set(groundModule.id, { header });
      placed.bounds.set(
        groundModule.id,
        across
          ? { x: -header, y: 0, width: header + ground.length, height: ground.band * count }
          : { x: 0, y: -header, width: ground.band * count, height: header + ground.length },
      );
    }
  } else {
    const way = direction === "both" ? "down" : (direction as "down" | "right" | "up" | "left");
    const gap = (op.gap as [number, number] | undefined) ?? [
      (hasFrames ? (op.tiers ? 140 : 100) : 64) + (level ? Math.min(160, widestLabel) : labelled ? 20 : 0),
      hasFrames ? 44 : labelled ? 44 : 36,
    ];
    if (op.tiers?.length) {
      const listed = new Set(op.tiers.flat());
      const unlisted = leaves.filter((n) => !listed.has(n.id)).map((n) => n.id);
      if (unlisted.length)
        placed.problems.push({
          at: `${at}.tiers`,
          problem: `tiers 没有列出 ${unlisted.join("、")}：给了 tiers 就要把这条 arrange 摆放的每个模块都列进某一层`,
        });
      tiered(leaves, links, op.tiers, way, gap);
    } else {
      // A dense graph needs wider gaps between its ranks, a lane for each link in them.
      if (!op.gap) {
        const rank = ranksOf(
          leaves.map((n) => n.id),
          links,
        );
        const ranks = Math.max(1, ...rank.values());
        gap[0] += Math.min(140, Math.max(0, Math.round(links.length / ranks) - 4) * 6);
      }
      flow(nodes, links, way, gap, frames);
    }
  }
  // Frames close round what they hold, innermost first.
  const box = new Map<string, Bounds>(leaves.map((n) => [n.id, { x: n.x, y: n.y, width: n.width, height: n.height }]));
  const closing = [...framed];
  for (let pass = 0; pass < 8 && closing.length; pass++)
    for (const id of [...closing]) {
      const members = (frames[id] ?? []).filter((m) => ids.includes(m));
      if (members.some((m) => !box.has(m) && framed.has(m))) continue;
      const held = members.flatMap((m) => (box.has(m) ? [box.get(m)!] : []));
      closing.splice(closing.indexOf(id), 1);
      if (!held.length) {
        placed.problems.push({ at: `${at}.frames.${id}`, problem: `分组框 ${id} 里没有这条 arrange 摆放的模块` });
        continue;
      }
      const pad = framePad(work, have.get(id)!);
      const x = Math.min(...held.map((b) => b.x)) - pad.side,
        y = Math.min(...held.map((b) => b.y)) - pad.top;
      box.set(id, {
        x,
        y,
        width: Math.max(...held.map((b) => b.x + b.width)) + pad.side - x,
        height: Math.max(...held.map((b) => b.y + b.height)) + pad.bottom - y,
      });
    }
  for (const [id, b] of box) placed.bounds.set(id, b);
  // Moved to where it belongs: beside a module already placed, at the point given, or else
  // where its modules already stood.
  const all = [...placed.bounds.values()];
  if (!all.length) return placed;
  const minX = Math.min(...all.map((b) => b.x)),
    minY = Math.min(...all.map((b) => b.y)),
    maxX = Math.max(...all.map((b) => b.x + b.width)),
    maxY = Math.max(...all.map((b) => b.y + b.height));
  let origin = { x: 0, y: 0 };
  if (op.beside) {
    const [anchorId, side] = op.beside;
    const anchor = have.get(anchorId)?.bounds;
    if (!anchor)
      placed.problems.push({ at: `${at}.beside`, problem: `beside 的模块 ${anchorId} 不在场景 ${sceneId} 里` });
    else {
      const space = 64;
      origin =
        side === "right"
          ? { x: anchor.x + anchor.width + space, y: anchor.y }
          : side === "left"
            ? { x: anchor.x - space - (maxX - minX), y: anchor.y }
            : side === "below"
              ? { x: anchor.x, y: anchor.y + anchor.height + space }
              : { x: anchor.x, y: anchor.y - space - (maxY - minY) };
    }
  } else if (op.at) origin = { x: op.at[0], y: op.at[1] };
  else {
    const stood = [...placed.bounds.keys()].filter((id) => !unsized.has(id)).map((id) => have.get(id)!.bounds);
    if (stood.length === placed.bounds.size)
      origin = { x: Math.min(...stood.map((b) => b.x)), y: Math.min(...stood.map((b) => b.y)) };
  }
  for (const [id, b] of placed.bounds)
    placed.bounds.set(id, {
      x: round(b.x - minX + origin.x),
      y: round(b.y - minY + origin.y),
      width: round(b.width),
      height: round(b.height),
    });
  return placed;
}

/** The modules an arrangement names itself. */
const namedBy = (op: Arrange) => [
  ...(Array.isArray(op.modules) ? op.modules : []),
  ...(op.tiers ?? []).flat(),
  ...(op.lanes ?? []).flat(),
  ...Object.keys(op.frames ?? {}),
  ...Object.values(op.frames ?? {}).flat(),
  ...(op.ground ? [op.ground] : []),
];
/** The parts of a scene a change to each of them means. */
function matching(work: Work, each: Each, current: string) {
  const scene = work.scenes[each.scene ?? current];
  if (!scene) return [];
  const parts: (Instance | Link)[] = each.links ? scene.links : scene.modules;
  return parts.filter((p) => {
    if (each.drawingId && p.drawingId !== each.drawingId) return false;
    if (each.group !== undefined && (p as Instance).group !== each.group) return false;
    if (each.where) {
      const data = { ...drawingOf(work, p.drawingId)?.defaults, ...p.data };
      for (const [key, value] of Object.entries(each.where))
        if (JSON.stringify(data[key]) !== JSON.stringify(value)) return false;
    }
    return true;
  });
}
/** A write without its `each` and `arrange`, and with a stand-in box for every new module
 * that gives none, so it can be laid on the work to measure what it adds. */
export function placeheld(work: Work, edit: WorkEdit) {
  const { each: _each, arrange: _arrange, ...plain } = edit;
  const known = new Set(Object.values(work.scenes).flatMap((s) => s.modules.map((m) => m.id)));
  const removed = new Set(edit.remove?.modules ?? []);
  const unplaced = new Set<string>();
  const modules = plain.modules?.map((m) => {
    if (m.bounds || (known.has(m.id) && !removed.has(m.id)) || unplaced.has(m.id)) return m;
    unplaced.add(m.id);
    return { ...m, bounds: PLACEHOLDER };
  });
  return { edit: { ...plain, ...(modules ? { modules } : {}) } as WorkEdit, unplaced };
}
/** A write as plain records: every `each` spelt out for the parts it means, and every
 * `arrange` worked out into bounds. `draft` is the work with the write's own records laid
 * (see `placeheld`) and the materials they name taken, so sizes can be fitted. */
export function settled(
  draft: Work,
  edit: WorkEdit,
  unplaced: Set<string>,
  current: string,
): { edit: WorkEdit; problems: Problem[] } {
  const { each, arrange, ...plain } = edit;
  const problems: Problem[] = [];
  const modules: ModuleEdit[] = [...(plain.modules ?? [])];
  const links = [...(plain.links ?? [])];
  let work = draft;
  if (each?.length) {
    const more: WorkEdit = { modules: [], links: [] };
    each.forEach((e, i) => {
      const parts = matching(work, e, current);
      if (!parts.length)
        problems.push({ at: `each.${i}`, problem: "each 没有匹配到任何部件：检查 drawingId、group、where 和 scene" });
      for (const p of parts) {
        const change = {
          id: p.id,
          ...(e.data ? { data: e.data } : {}),
          ...(e.use ? { drawingId: e.use } : {}),
        };
        if (e.links) more.links!.push(change);
        else {
          const b = (p as Instance).bounds;
          more.modules!.push({
            ...change,
            ...(e.size && !unplaced.has(p.id)
              ? {
                  bounds: [
                    round(b.x + (b.width - e.size[0]) / 2),
                    round(b.y + (b.height - e.size[1]) / 2),
                    e.size[0],
                    e.size[1],
                  ],
                }
              : {}),
          });
        }
      }
    });
    modules.push(...more.modules!);
    links.push(...more.links!);
    // Their sizes and words count in the arrangements that follow.
    work = layOn(work, more, current).work;
  }
  // Where each arrangement puts its modules. A new module takes its place in its own
  // record, as it has to be laid with one; a module that stood somewhere moves afterwards.
  const fresh = new Set(unplaced);
  const places = new Map<string, ModuleEdit>();
  (arrange ?? []).forEach((op, i) => {
    const sceneId = op.scene ?? current;
    const others = new Set((arrange ?? []).flatMap((o) => (o === op ? [] : namedBy(o))));
    const result = arrangement(work, sceneId, op, unplaced, others);
    problems.push(...result.problems.map((p) => ({ ...p, at: p.at.replace(/^arrange/, `arrange.${i}`) })));
    const moves: ModuleEdit[] = [...result.bounds].map(([id, b]) => ({
      id,
      bounds: boxOf(b),
      ...(result.data.has(id) ? { data: result.data.get(id) } : {}),
    }));
    for (const m of moves) places.set(m.id, { ...places.get(m.id), ...m });
    // A later arrangement may stand beside this one.
    work = layOn(work, { modules: moves }, current).work;
    for (const m of moves) unplaced.delete(m.id);
  });
  const seen = new Set<string>();
  const cleaned: ModuleEdit[] = modules.map((m) => {
    const place = places.get(m.id);
    if (m.bounds || !fresh.has(m.id) || seen.has(m.id) || !place) return m;
    seen.add(m.id);
    return { ...m, bounds: place.bounds, ...(place.data ? { data: { ...m.data, ...place.data } } : {}) };
  });
  for (const [id, place] of places) if (!seen.has(id)) cleaned.push(place);
  return {
    edit: {
      ...plain,
      ...(cleaned.length ? { modules: cleaned } : {}),
      ...(links.length ? { links } : {}),
    },
    problems,
  };
}
/** A write as plain records, when the work already holds every material it names: for a
 * hand edit, and for showing a layout while its write is still arriving. */
export function plainEdit(work: Work, edit: WorkEdit, current: string) {
  if (!edit.each?.length && !edit.arrange?.length) return { edit, problems: [] as Problem[] };
  const held = placeheld(work, edit);
  return settled(layOn(work, held.edit, current).work, edit, held.unplaced, current);
}

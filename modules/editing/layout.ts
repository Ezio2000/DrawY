import type { Bounds, Work, WorkEdit } from "../contracts/index.ts";
import { union } from "../contracts/geometry.ts";
import { moveParts } from "./parts.ts";
import { sceneOf } from "./shared.ts";

/* Where modules sit: lining them up, spacing them evenly, resizing a selection as one,
 * and the guides a dragged box snaps to. All of it ends in new bounds, the one thing about
 * a module's place the author writes too. */

export type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";
/** Lines modules up on one edge or centre of the box around them all; a single module is
 * lined up with the scene's other modules instead, which is what there is to line up to. */
export function align(
  work: Work,
  sceneId: string,
  ids: string[],
  to: Alignment,
): WorkEdit {
  const scene = sceneOf(work, sceneId);
  const chosen = scene.modules.filter((m) => ids.includes(m.id));
  const frame = union(
    (chosen.length > 1 ? chosen : scene.modules).map((m) => m.bounds),
  );
  return moveParts(
    work,
    sceneId,
    chosen.map((m) => {
      const b = { ...m.bounds };
      if (to === "left") b.x = frame.x;
      if (to === "center") b.x = frame.x + (frame.width - b.width) / 2;
      if (to === "right") b.x = frame.x + frame.width - b.width;
      if (to === "top") b.y = frame.y;
      if (to === "middle") b.y = frame.y + (frame.height - b.height) / 2;
      if (to === "bottom") b.y = frame.y + frame.height - b.height;
      return { id: m.id, bounds: b };
    }),
  );
}
/** Spaces three or more modules evenly across or down, keeping the first and last where
 * they are: the gaps between them become equal. */
export function distribute(
  work: Work,
  sceneId: string,
  ids: string[],
  axis: "x" | "y",
): WorkEdit | null {
  const scene = sceneOf(work, sceneId);
  const size = axis === "x" ? "width" : "height";
  const chosen = scene.modules
    .filter((m) => ids.includes(m.id))
    .sort((a, b) => a.bounds[axis] - b.bounds[axis]);
  if (chosen.length < 3) return null;
  const first = chosen[0].bounds,
    last = chosen.at(-1)!.bounds;
  const span = last[axis] + last[size] - first[axis];
  const filled = chosen.reduce((n, m) => n + m.bounds[size], 0);
  const gap = (span - filled) / (chosen.length - 1);
  let at = first[axis];
  return moveParts(
    work,
    sceneId,
    chosen.map((m) => {
      const b = { ...m.bounds, [axis]: at };
      at += m.bounds[size] + gap;
      return { id: m.id, bounds: b };
    }),
  );
}

/** Gives modules the width, the height or both of the first one named, each keeping its
 * top left corner where it is. */
export function matchSize(
  work: Work,
  sceneId: string,
  ids: string[],
  what: "width" | "height" | "both",
): WorkEdit | null {
  const scene = sceneOf(work, sceneId);
  const like = scene.modules.find((m) => m.id === ids[0]);
  const rest = scene.modules.filter((m) => ids.includes(m.id) && m.id !== ids[0]);
  if (!like || !rest.length) return null;
  return moveParts(
    work,
    sceneId,
    rest.map((m) => ({
      id: m.id,
      bounds: {
        ...m.bounds,
        ...(what !== "height" ? { width: like.bounds.width } : {}),
        ...(what !== "width" ? { height: like.bounds.height } : {}),
      },
    })),
  );
}

/** A handle on a box: a corner or the middle of an edge, by compass point. */
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const handles: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
/** A box resized by dragging one of its handles. Shift keeps its proportions; Alt resizes
 * it about its centre; it never shrinks below `min`. */
export function resized(
  box: Bounds,
  handle: Handle,
  dx: number,
  dy: number,
  { keep = false, centred = false, min = 8 } = {},
): Bounds {
  const sx = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0,
    sy = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
  const k = centred ? 2 : 1;
  let width = box.width + sx * dx * k,
    height = box.height + sy * dy * k;
  if (keep) {
    const ratio = box.width / box.height;
    // An edge handle drives the other side; a corner follows the larger change.
    if (!sx) width = height * ratio;
    else if (!sy) height = width / ratio;
    else if (Math.abs(width / box.width) > Math.abs(height / box.height))
      height = width / ratio;
    else width = height * ratio;
  }
  if (keep) {
    // Kept proportions shrink no further than the shorter side's minimum.
    const f = Math.max(width / box.width, min / Math.min(box.width, box.height));
    width = box.width * f;
    height = box.height * f;
  } else {
    width = Math.max(min, width);
    height = Math.max(min, height);
  }
  const x = centred
    ? box.x + (box.width - width) / 2
    : sx < 0
      ? box.x + box.width - width
      : sx > 0
        ? box.x
        : box.x + (box.width - width) / 2;
  const y = centred
    ? box.y + (box.height - height) / 2
    : sy < 0
      ? box.y + box.height - height
      : sy > 0
        ? box.y
        : box.y + (box.height - height) / 2;
  return { x, y, width, height };
}
/** Where a box inside one frame lands when the frame becomes another: a selection of
 * several modules is resized as one, each keeping its place and share within it. */
export function scaled(b: Bounds, from: Bounds, to: Bounds): Bounds {
  const sx = to.width / from.width,
    sy = to.height / from.height;
  return {
    x: to.x + (b.x - from.x) * sx,
    y: to.y + (b.y - from.y) * sy,
    width: Math.max(1, b.width * sx),
    height: Math.max(1, b.height * sy),
  };
}

/** A guide a dragged box snapped to: a vertical line at x, or a horizontal one at y,
 * running between `from` and `to` along it. */
export interface Guide {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}
/** A gap a dragged box now keeps with its neighbours, equal to another beside it: it runs
 * along `axis` from `from` to `to`, drawn at `at` on the other axis. */
export interface Gap {
  axis: "x" | "y";
  from: number;
  to: number;
  at: number;
}
/** How far to shift a dragged box so its edges or centre line up with those of the boxes
 * around it, within `threshold`, and the guides that show what it lined up with. `xs` and
 * `ys` say which of its lines may snap, as fractions of its size: 0, 0.5 and 1 when it
 * moves, only the dragged edge when it is resized. With `spaced`, a moved box also settles
 * where its gaps to the neighbours in its row or column are equal: midway between two of
 * them, or as far from the nearest as that one is from the next. The nearer of the two kinds
 * of snap wins on each axis, lining up first when they are as near. */
export function snap(
  box: Bounds,
  others: Bounds[],
  threshold: number,
  xs: number[] = [0, 0.5, 1],
  ys: number[] = [0, 0.5, 1],
  spaced = false,
): { dx: number; dy: number; guides: Guide[]; gaps: Gap[] } {
  const best = (axis: "x" | "y", fractions: number[]) => {
    const size = axis === "x" ? "width" : "height";
    let found: { d: number; at: number } | undefined;
    for (const f of fractions) {
      const line = box[axis] + box[size] * f;
      for (const o of others)
        for (const g of [0, 0.5, 1]) {
          const at = o[axis] + o[size] * g,
            d = at - line;
          if (Math.abs(d) <= threshold && (!found || Math.abs(d) < Math.abs(found.d)))
            found = { d, at };
        }
    }
    return found;
  };
  let x = best("x", xs),
    y = best("y", ys);
  const even = (axis: "x" | "y", lined?: { d: number }) => {
    if (!spaced) return undefined;
    const e = evenly(box, others, axis, threshold);
    return e && (!lined || Math.abs(e.d) < Math.abs(lined.d)) ? e : undefined;
  };
  const ex = even("x", x),
    ey = even("y", y);
  if (ex) x = undefined;
  if (ey) y = undefined;
  const dx = ex?.d ?? x?.d ?? 0,
    dy = ey?.d ?? y?.d ?? 0;
  const moved = { ...box, x: box.x + dx, y: box.y + dy };
  const guides: Guide[] = [];
  // Each guide runs across every box that touches the line, the dragged one included.
  const lineOf = (axis: "x" | "y", at: number) => {
    const size = axis === "x" ? "width" : "height",
      cross = axis === "x" ? "y" : "x",
      crossSize = axis === "x" ? "height" : "width";
    const on = [moved, ...others].filter((o) =>
      [0, 0.5, 1].some((g) => Math.abs(o[axis] + o[size] * g - at) < 0.5),
    );
    guides.push({
      axis,
      at,
      from: Math.min(...on.map((o) => o[cross])),
      to: Math.max(...on.map((o) => o[cross] + o[crossSize])),
    });
  };
  if (x) lineOf("x", x.at);
  if (y) lineOf("y", y.at);
  // The gaps are drawn through the middle of what the moved box shares with its row.
  const gaps = [ex, ey].flatMap((e, i) => {
    if (!e) return [];
    const axis = i ? "y" : "x",
      cross = i ? "x" : "y",
      size = i ? "height" : "width",
      crossSize = i ? "width" : "height";
    const lo = Math.max(moved[cross], ...e.beside.map((o) => o[cross])),
      hi = Math.min(
        moved[cross] + moved[crossSize],
        ...e.beside.map((o) => o[cross] + o[crossSize]),
      );
    const at = lo <= hi ? (lo + hi) / 2 : moved[cross] + moved[crossSize] / 2;
    return e
      .spans(moved[axis], moved[axis] + moved[size])
      .map(([from, to]): Gap => ({ axis, from, to, at }));
  });
  return { dx, dy, guides, gaps };
}
/** Where a moved box keeps equal gaps along an axis with the boxes it shares a row (or a
 * column) with: how far to shift it, the gaps that are then equal, given where the box
 * then starts and ends, and the neighbours they lie between. */
function evenly(box: Bounds, others: Bounds[], axis: "x" | "y", threshold: number) {
  const size = axis === "x" ? "width" : "height",
    cross = axis === "x" ? "y" : "x",
    crossSize = axis === "x" ? "height" : "width";
  const start = (o: Bounds) => o[axis],
    end = (o: Bounds) => o[axis] + o[size];
  const row = others.filter(
    (o) => o[cross] < box[cross] + box[crossSize] && box[cross] < o[cross] + o[crossSize],
  );
  const mid = start(box) + box[size] / 2;
  // Nearest first on each side, and the next one clear of it.
  const before = row
    .filter((o) => start(o) + o[size] / 2 < mid)
    .sort((a, b) => end(b) - end(a));
  const after = row
    .filter((o) => start(o) + o[size] / 2 >= mid)
    .sort((a, b) => start(a) - start(b));
  const l1 = before[0],
    l2 = l1 && before.find((o) => end(o) <= start(l1)),
    r1 = after[0],
    r2 = r1 && after.find((o) => start(o) >= end(r1));
  type Spans = (from: number, to: number) => [number, number][];
  const found: { d: number; spans: Spans; beside: Bounds[] }[] = [];
  const offer = (target: number, spans: Spans, beside: Bounds[]) => {
    const d = target - start(box);
    if (Math.abs(d) <= threshold) found.push({ d, spans, beside });
  };
  if (l1 && r1 && start(r1) - end(l1) >= box[size])
    offer(
      (end(l1) + start(r1) - box[size]) / 2,
      (from, to) => [
        [end(l1), from],
        [to, start(r1)],
      ],
      [l1, r1],
    );
  if (l1 && l2 && start(l1) > end(l2))
    offer(
      end(l1) + (start(l1) - end(l2)),
      (from) => [
        [end(l2), start(l1)],
        [end(l1), from],
      ],
      [l1, l2],
    );
  if (r1 && r2 && start(r2) > end(r1))
    offer(
      start(r1) - (start(r2) - end(r1)) - box[size],
      (_, to) => [
        [to, start(r1)],
        [end(r1), start(r2)],
      ],
      [r1, r2],
    );
  return found.sort((a, b) => Math.abs(a.d) - Math.abs(b.d))[0];
}

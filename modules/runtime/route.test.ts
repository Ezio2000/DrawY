import { describe, expect, it } from "vitest";
import type { Bounds, Point } from "../contracts/index.ts";
import { routeLinks, type Route, type RouteLink } from "./route.ts";

const box = (x: number, y: number, width = 160, height = 80): Bounds => ({ x, y, width, height });
const link = (id: string, from: string, to: string, extra: Partial<RouteLink> = {}): RouteLink => ({
  id,
  from: { moduleId: from },
  to: { moduleId: to },
  ...extra,
});
const segments = (r: Route) => r.points.slice(1).map((b, k) => [r.points[k], b] as const);
/** The length of a route's line inside a box, its edges excluded. */
function through(r: Route, b: Bounds) {
  let length = 0;
  for (const [p, q] of segments(r)) {
    if (Math.abs(p.y - q.y) < 0.5) {
      if (p.y > b.y && p.y < b.y + b.height)
        length += Math.max(0, Math.min(Math.max(p.x, q.x), b.x + b.width) - Math.max(Math.min(p.x, q.x), b.x));
    } else if (p.x > b.x && p.x < b.x + b.width)
      length += Math.max(0, Math.min(Math.max(p.y, q.y), b.y + b.height) - Math.max(Math.min(p.y, q.y), b.y));
  }
  return length;
}
const square = (r: Route) => segments(r).every(([p, q]) => Math.abs(p.x - q.x) < 0.01 || Math.abs(p.y - q.y) < 0.01);
/** How long two routes run along the same line. */
function along(a: Route, b: Route) {
  let length = 0;
  for (const [p, q] of segments(a))
    for (const [s, t] of segments(b)) {
      if (Math.abs(p.y - q.y) < 0.5 && Math.abs(s.y - t.y) < 0.5 && Math.abs(p.y - s.y) < 0.5)
        length += Math.max(0, Math.min(Math.max(p.x, q.x), Math.max(s.x, t.x)) - Math.max(Math.min(p.x, q.x), Math.min(s.x, t.x)));
      if (Math.abs(p.x - q.x) < 0.5 && Math.abs(s.x - t.x) < 0.5 && Math.abs(p.x - s.x) < 0.5)
        length += Math.max(0, Math.min(Math.max(p.y, q.y), Math.max(s.y, t.y)) - Math.max(Math.min(p.y, q.y), Math.min(s.y, t.y)));
    }
  return length;
}
const onSide = (p: Point, b: Bounds) =>
  Math.abs(p.x - b.x) < 0.01 || Math.abs(p.x - b.x - b.width) < 0.01 || Math.abs(p.y - b.y) < 0.01 || Math.abs(p.y - b.y - b.height) < 0.01;

describe("routeLinks", () => {
  it("joins modules in a row straight, side to side", () => {
    const boxes = new Map([
      ["a", box(0, 0)],
      ["b", box(260, 0)],
      ["c", box(520, 0)],
    ]);
    const routes = routeLinks([link("ab", "a", "b"), link("bc", "b", "c")], boxes);
    expect(routes.get("ab")!.points).toEqual([
      { x: 160, y: 40 },
      { x: 260, y: 40 },
    ]);
    expect(routes.get("bc")).toMatchObject({ fromSide: "right", toSide: "left" });
  });

  it("goes around a module in its way instead of under it", () => {
    const boxes = new Map([
      ["a", box(0, 0)],
      ["middle", box(260, 0)],
      ["c", box(520, 0)],
    ]);
    const r = routeLinks([link("ac", "a", "c")], boxes).get("ac")!;
    expect(square(r)).toBe(true);
    expect(through(r, boxes.get("middle")!)).toBe(0);
    expect(onSide(r.points[0], boxes.get("a")!) && onSide(r.points.at(-1)!, boxes.get("c")!)).toBe(true);
  });

  it("branches a tree from one trunk under its parent", () => {
    const boxes = new Map([
      ["root", box(320, 0)],
      ["left", box(0, 200)],
      ["mid", box(320, 200)],
      ["right", box(640, 200)],
    ]);
    const routes = routeLinks(
      [link("l", "root", "left"), link("m", "root", "mid"), link("r", "root", "right")],
      boxes,
    );
    for (const r of routes.values()) expect(r).toMatchObject({ fromSide: "bottom", toSide: "top" });
    // The children share the line down from the parent and the bar across.
    expect(along(routes.get("l")!, routes.get("r")!)).toBeGreaterThan(20);
    expect(routes.get("m")!.points).toHaveLength(2);
  });

  it("takes a loop back around the row, not through it, and by sides other links leave free", () => {
    const boxes = new Map([
      ["a", box(0, 0)],
      ["b", box(260, 0)],
      ["c", box(520, 0)],
    ]);
    const routes = routeLinks([link("ab", "a", "b"), link("bc", "b", "c"), link("back", "c", "a")], boxes);
    const back = routes.get("back")!;
    for (const b of boxes.values()) expect(through(back, b)).toBe(0);
    expect(["top", "bottom"]).toContain(back.fromSide);
    expect(["top", "bottom"]).toContain(back.toSide);
    expect(along(back, routes.get("ab")!) + along(back, routes.get("bc")!)).toBe(0);
  });

  it("gives labelled branches out of a decision corners of their own, and out of a box points of their own", () => {
    const boxes = new Map([
      ["decide", box(0, 120)],
      ["yes", box(300, 0)],
      ["no", box(300, 240)],
    ]);
    const branches = [link("y", "decide", "yes", { branch: true }), link("n", "decide", "no", { branch: true })];
    // A diamond meets its box only at the middles of its sides.
    const diamond = routeLinks(branches, boxes, new Set(), new Set(["decide"]));
    expect(diamond.get("y")!.fromSide).not.toBe(diamond.get("n")!.fromSide);
    expect(along(diamond.get("y")!, diamond.get("n")!)).toBe(0);
    // A box's side has room for both, side by side.
    const flat = routeLinks(branches, boxes);
    expect(flat.get("y")!.points[0]).not.toEqual(flat.get("n")!.points[0]);
    expect(along(flat.get("y")!, flat.get("n")!)).toBe(0);
  });

  it("joins into a trunk only links that look alike", () => {
    const boxes = new Map([
      ["notify", box(320, 0)],
      ["a", box(0, 200)],
      ["b", box(320, 200)],
      ["c", box(640, 200)],
    ]);
    const routes = routeLinks(
      [
        link("a", "a", "notify", { bundle: "red dashed" }),
        link("c", "c", "notify", { bundle: "red dashed" }),
        link("b", "b", "notify", { bundle: "black" }),
      ],
      boxes,
    );
    // The two red lines merge; the black one keeps a line and a point of its own.
    expect(along(routes.get("a")!, routes.get("c")!)).toBeGreaterThan(20);
    expect(along(routes.get("b")!, routes.get("a")!) + along(routes.get("b")!, routes.get("c")!)).toBe(0);
    expect(routes.get("b")!.points.at(-1)).not.toEqual(routes.get("a")!.points.at(-1));
  });

  it("keeps the side and point a link names", () => {
    const boxes = new Map([
      ["a", box(0, 0)],
      ["b", box(300, 200)],
    ]);
    const r = routeLinks(
      [{ id: "ab", from: { moduleId: "a", at: "bottom" }, to: { moduleId: "b", at: [0, 0.25] } }],
      boxes,
    ).get("ab")!;
    expect(r.points[0]).toEqual({ x: 80, y: 80 });
    expect(r.points.at(-1)).toEqual({ x: 300, y: 220 });
    expect(r).toMatchObject({ fromSide: "bottom", toSide: "left" });
  });

  it("runs straight where facing sides nearly line up", () => {
    const boxes = new Map([
      ["a", box(0, 0)],
      ["b", box(12, 200)],
    ]);
    const r = routeLinks([link("ab", "a", "b")], boxes).get("ab")!;
    expect(r.points).toHaveLength(2);
    expect(r.points[0].x).toBe(r.points[1].x);
  });

  it("sets apart lines that would run along each other without belonging together", () => {
    // Two links that cross the same gap between the rows at the same height.
    const boxes = new Map([
      ["a1", box(0, 0)],
      ["a2", box(400, 0)],
      ["b1", box(200, 240)],
      ["b2", box(600, 240)],
    ]);
    const routes = routeLinks([link("one", "a1", "b2"), link("two", "a2", "b1")], boxes);
    expect(along(routes.get("one")!, routes.get("two")!)).toBe(0);
  });

  it("leaves to its drawing a link whose modules overlap or that ends inside one", () => {
    const boxes = new Map([
      ["frame", box(0, 0, 600, 400)],
      ["inner", box(100, 100)],
      ["other", box(700, 100)],
    ]);
    const routes = routeLinks(
      [
        link("held", "frame", "inner"),
        { id: "point", from: { moduleId: "other", at: [0.5, 0.5] }, to: { moduleId: "inner" } },
        link("out", "inner", "other"),
      ],
      boxes,
    );
    expect(routes.has("held")).toBe(false);
    expect(routes.has("point")).toBe(false);
    // A frame around linked modules does not stand in their links' way.
    expect(routes.get("out")!.points).toHaveLength(2);
  });

  it("marks the segments that run along another link", () => {
    const boxes = new Map([
      ["root", box(320, 0)],
      ["left", box(0, 200)],
      ["right", box(640, 200)],
    ]);
    const routes = routeLinks([link("l", "root", "left"), link("r", "root", "right")], boxes);
    const l = routes.get("l")!;
    expect(l.shared[0]).toBe(true);
    expect(l.shared.at(-1)).toBe(false);
  });

  it("routes a large flowchart quickly", () => {
    const boxes = new Map<string, Bounds>();
    const links: RouteLink[] = [];
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 6; col++) boxes.set(`n${row}-${col}`, box(col * 260, row * 180));
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 6; col++) {
        if (col < 5) links.push(link(`h${row}-${col}`, `n${row}-${col}`, `n${row}-${col + 1}`));
        if (row < 4 && col % 2 === 0) links.push(link(`v${row}-${col}`, `n${row}-${col}`, `n${row + 1}-${col + 1}`));
      }
    links.push(link("loop", "n4-5", "n0-0"));
    const started = performance.now();
    const routes = routeLinks(links, boxes);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(routes.size).toBe(links.length);
    for (const r of routes.values()) {
      expect(square(r)).toBe(true);
      for (const [id, b] of boxes) if (!onSide(r.points[0], b) || id) expect(through(r, b)).toBeLessThan(1);
    }
  });
});

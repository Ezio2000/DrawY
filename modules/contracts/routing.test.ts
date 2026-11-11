import { expect, it } from "vitest";
import type { Bounds, Point } from "./index.ts";
import {
  connect,
  groundOf,
  routeLinks,
  routing,
  textWidth,
  type RouteLink,
  type RouteMemo,
} from "./routing.ts";

const box = (id: string, x: number, y: number, width = 140, height = 56) => ({
  id,
  bounds: { x, y, width, height },
});
const link = (
  id: string,
  from: string | RouteLink["from"],
  to: string | RouteLink["to"],
  data: Record<string, unknown> = {},
  style: Record<string, string> = {},
): RouteLink => ({
  id,
  from: typeof from === "string" ? { moduleId: from } : from,
  to: typeof to === "string" ? { moduleId: to } : to,
  options: routing({ route: "elbow", ...data }, style),
});
/** Whether a line of upright and level stretches passes through the inside of a box. */
const through = (points: Point[], b: Bounds, inset = 1) =>
  points.some((p, i) => {
    if (!i) return false;
    const q = points[i - 1];
    return (
      Math.max(p.x, q.x) > b.x + inset &&
      Math.min(p.x, q.x) < b.x + b.width - inset &&
      Math.max(p.y, q.y) > b.y + inset &&
      Math.min(p.y, q.y) < b.y + b.height - inset
    );
  });
const square = (points: Point[]) =>
  points.every(
    (p, i) =>
      !i ||
      Math.abs(p.x - points[i - 1].x) < 0.01 ||
      Math.abs(p.y - points[i - 1].y) < 0.01,
  );

it("reads how a link runs from its data and the work's style, by the keys every link drawing shares", () => {
  expect(routing({}).kind).toBe("curve");
  expect(routing({}, { route: "elbow", flow: "down" })).toMatchObject({
    kind: "elbow",
    flow: "bottom",
  });
  expect(routing({ route: "curve" }, { route: "elbow" }).kind).toBe("curve");
  // A work saved before routes were worked out by the scene asked for one turn.
  expect(routing({ route: "corner" }).kind).toBe("elbow");
  const labelled = routing({ label: "不通过", size: 16, labelAt: "target" });
  expect(labelled.label!.width).toBeGreaterThan(48);
  expect(labelled.labelAt).toBeGreaterThan(0.8);
  expect(textWidth("订单服务", 15)).toBeCloseTo(60);
  expect(textWidth("API", 15)).toBeLessThan(30);
});

it("runs straight between facing sides and at right angles round whatever stands between", () => {
  const modules = [
    box("a", 0, 0),
    box("b", 0, 240),
    box("wall", -40, 120, 220, 60),
    box("c", 300, 0),
  ];
  const routes = routeLinks(
    [link("ab", "a", "b"), link("ac", "a", "c")],
    modules,
  );
  const ac = routes.get("ac")!;
  expect(ac.points).toEqual([
    { x: 140, y: 28 },
    { x: 300, y: 28 },
  ]);
  expect([ac.fromSide, ac.toSide]).toEqual(["right", "left"]);
  const ab = routes.get("ab")!;
  expect(square(ab.points)).toBe(true);
  expect(ab.points.length).toBeGreaterThan(3);
  expect(through(ab.points, modules[2].bounds)).toBe(false);
  expect(ab.crosses).toEqual([]);
  // It neither cuts back through the module it leaves nor into the one it reaches.
  expect(through(ab.points, modules[0].bounds)).toBe(false);
  expect(through(ab.points, modules[1].bounds)).toBe(false);
});

it("follows a module wherever it is moved, with nothing kept from where it stood", () => {
  const at = (x: number, y: number) =>
    routeLinks([link("ab", "a", "b")], [box("a", 0, 0), box("b", x, y)]).get(
      "ab",
    )!;
  expect(at(300, 0).toSide).toBe("left");
  const below = at(20, 300);
  expect(below.fromSide).toBe("bottom");
  expect(below.toSide).toBe("top");
  expect(below.points.at(-1)!.y).toBe(300);
  expect(at(-400, 10).toSide).toBe("right");
});

it("gives each link its own port on a side, in an order that keeps them from crossing", () => {
  const modules = [
    box("a", 0, 100),
    box("b", 300, 0),
    box("c", 300, 100),
    box("d", 300, 200),
  ];
  const routes = routeLinks(
    [link("ad", "a", "d"), link("ab", "a", "b"), link("ac", "a", "c")],
    modules,
  );
  const ports = ["ab", "ac", "ad"].map((id) => routes.get(id)!.points[0]);
  expect(ports.every((p) => p.x === 140)).toBe(true);
  // Three ports down the side, the one for the highest target on top.
  expect(ports[0].y).toBeLessThan(ports[1].y);
  expect(ports[1].y).toBeLessThan(ports[2].y);
  // The middle one runs straight across.
  expect(routes.get("ac")!.points).toHaveLength(2);
  // As a trunk they leave from one port, as the branches of a tree do.
  const trunk = routeLinks(
    ["b", "c", "d"].map((to) => link("a" + to, "a", to, { trunk: true })),
    modules,
  );
  expect(
    new Set(
      ["ab", "ac", "ad"].map((id) => JSON.stringify(trunk.get(id)!.points[0])),
    ).size,
  ).toBe(1);
});

it("gives links that share a channel a lane each, so no two lie on one another", () => {
  const modules = [
    box("a1", 0, 0),
    box("a2", 0, 100),
    box("b1", 300, 0),
    box("b2", 300, 100),
  ];
  const routes = routeLinks(
    [link("x", "a1", "b2"), link("y", "a2", "b1")],
    modules,
  );
  const cross = (id: string) => routes.get(id)!.points[1].x;
  expect(routes.get("x")!.points).toHaveLength(4);
  expect(Math.abs(cross("x") - cross("y"))).toBeGreaterThanOrEqual(5);
});

it("follows the figure's flow where a link's end lies ahead of its start", () => {
  const modules = [box("a", 0, 0), box("b", 260, 200)];
  const plain = routeLinks([link("ab", "a", "b")], modules).get("ab")!;
  const flowing = routeLinks(
    [link("ab", "a", "b", {}, { flow: "down" })],
    modules,
  ).get("ab")!;
  expect([plain.fromSide, plain.toSide]).not.toEqual(["bottom", "top"]);
  expect([flowing.fromSide, flowing.toSide]).toEqual(["bottom", "top"]);
});

it("treats a frame as ground: lines run over the one their ends stand in and round the others", () => {
  const modules = [
    box("frame", -20, -40, 360, 160),
    box("a", 0, 0),
    box("b", 180, 0),
    box("other", 420, -40, 200, 160),
    box("inside", 450, 0),
    box("c", 700, 0),
  ];
  const links = [
    link("ab", "a", "b"),
    link("bc", "b", "c"),
    link("in", "inside", "c"),
  ];
  expect([...groundOf(modules, links)].sort()).toEqual(["frame", "other"]);
  const routes = routeLinks(links, modules);
  expect(routes.get("ab")!.points).toHaveLength(2);
  const bc = routes.get("bc")!;
  expect(through(bc.points, modules[3].bounds)).toBe(false);
  expect(bc.crosses).toEqual([]);
});

it("runs over a band of another group between the modules it holds, where going round is far", () => {
  // Three tiers, each a frame across the whole figure; a link from the first to the third
  // has the second in its way wherever it goes.
  const modules = [
    box("top", -40, -40, 900, 140),
    box("middle", -40, 200, 900, 140),
    box("bottom", -40, 440, 900, 140),
    box("a", 340, 0),
    ...[0, 1, 2, 3].map((i) => box("m" + i, i * 220, 240)),
    box("z", 340, 480),
    box("y", 0, 480),
  ];
  const links = [link("az", "a", "z"), link("m0y", "m0", "y")];
  const az = routeLinks(links, modules).get("az")!;
  expect(square(az.points)).toBe(true);
  // Through none of the middle tier's modules, and the tier itself is ground, not a crossing.
  for (const m of modules.filter((m) => /^m\d/.test(m.id)))
    expect(through(az.points, m.bounds)).toBe(false);
  expect(az.crosses).toEqual([]);
  expect(Math.min(...az.points.map((p) => p.x))).toBeGreaterThan(-40);
  expect(Math.max(...az.points.map((p) => p.x))).toBeLessThan(860);
});

it("keeps off the drawn edges of frames, down the middle of a gap too narrow for a margin", () => {
  // Tiers close together, as an architecture's layers are drawn; links have to pass between
  // and round them, and a stretch lying on a frame's edge would read as part of the frame.
  const modules = [
    box("top", 0, 0, 900, 120),
    box("middle", 0, 140, 900, 120),
    box("bottom", 0, 280, 900, 120),
    box("a", 20, 40),
    ...[0, 1, 2, 3, 4].map((i) => box("m" + i, 20 + i * 176, 180)),
    box("z", 740, 320),
    box("y", 20, 320),
    box("b", 740, 40),
  ];
  const links = [
    link("az", "a", "z"),
    link("m0y", "m0", "y"),
    link("m4b", "m4", "b"),
    link("yb", "y", "b"),
  ];
  const routes = routeLinks(links, modules);
  const frames = modules.slice(0, 3).map((m) => m.bounds);
  for (const [id, r] of routes)
    for (let i = 1; i < r.points.length; i++) {
      const p = r.points[i - 1],
        q = r.points[i];
      for (const f of frames) {
        const level = Math.abs(p.y - q.y) < 0.01,
          run = level
            ? Math.min(Math.max(p.x, q.x), f.x + f.width) -
              Math.max(Math.min(p.x, q.x), f.x)
            : Math.min(Math.max(p.y, q.y), f.y + f.height) -
              Math.max(Math.min(p.y, q.y), f.y);
        const edges = level ? [f.y, f.y + f.height] : [f.x, f.x + f.width];
        const at = level ? p.y : p.x;
        expect(
          run > 24 && edges.some((e) => Math.abs(at - e) < 6),
          `${id} along a frame edge at ${at}`,
        ).toBe(false);
      }
    }
});

it("loops a link from a module back to itself, and names a point where its end is given one", () => {
  const modules = [box("a", 0, 0), box("b", 300, 200)];
  const routes = routeLinks(
    [
      link("aa", "a", "a"),
      link(
        "ab",
        { moduleId: "a", at: "bottom" },
        { moduleId: "b", at: [0, 0.25] },
      ),
    ],
    modules,
  );
  const loop = routes.get("aa")!;
  expect(loop.points).toHaveLength(5);
  expect(square(loop.points)).toBe(true);
  const ab = routes.get("ab")!;
  expect(ab.fromSide).toBe("bottom");
  expect(ab.points.at(-1)).toEqual({ x: 300, y: 214 });
});

it("finds a link's words room on its line, clear of the modules and of other links' words", () => {
  const modules = [box("a", 0, 0), box("b", 0, 200), box("c", 300, 200)];
  const routes = routeLinks(
    [
      link("ab", "a", "b", { label: "通过" }),
      link("ac", "a", "c", { label: "不通过" }),
    ],
    modules,
  );
  const size = routing({ label: "通过" }).label!;
  for (const id of ["ab", "ac"]) {
    const at = routes.get(id)!.label!;
    const label = {
      x: at.x - size.width / 2,
      y: at.y - size.height / 2,
      ...size,
    };
    for (const m of modules)
      expect(
        label.x < m.bounds.x + m.bounds.width &&
          label.x + label.width > m.bounds.x &&
          label.y < m.bounds.y + m.bounds.height &&
          label.y + label.height > m.bounds.y,
        `${id} over ${m.id}`,
      ).toBe(false);
  }
  expect(routes.get("ab")!.label).not.toEqual(routes.get("ac")!.label);
});

it("says what a line passes through when nothing can take it round", () => {
  const modules = [
    box("a", 0, 0),
    box("b", 400, 0),
    box("mid", 200, -10, 100, 80),
  ];
  const routes = routeLinks(
    [link("curved", "a", "b", { route: "curve" }), link("routed", "a", "b")],
    modules,
  );
  expect(routes.get("curved")!.crosses).toEqual(["mid"]);
  expect(routes.get("routed")!.crosses).toEqual([]);
});

it("routes a dense graph of a hundred modules quickly", () => {
  const modules = Array.from({ length: 100 }, (_, i) =>
    box("n" + i, (i % 10) * 200, Math.floor(i / 10) * 140),
  );
  const links: RouteLink[] = [];
  for (let i = 0; i < 90; i++) {
    links.push(link(`d${i}`, "n" + i, "n" + (i + 10)));
    links.push(link(`s${i}`, "n" + i, "n" + (10 + ((i * 7) % 90))));
  }
  const started = performance.now();
  const routes = routeLinks(links, modules);
  expect(performance.now() - started).toBeLessThan(1500);
  expect(routes.size).toBe(links.length);
  for (const r of routes.values()) expect(square(r.points)).toBe(true);
});

it("says what a smooth sweep passes through, as it does for a curve", () => {
  const modules = [
    box("a", 0, 0),
    box("mid", 300, 100, 140, 80),
    box("b", 700, 200),
  ];
  const swept = routeLinks(
    [link("s", "a", "b", { route: "smooth" })],
    modules,
  ).get("s")!;
  expect(swept.kind).toBe("smooth");
  expect(swept.crosses).toEqual(["mid"]);
  expect(
    routeLinks(
      [link("s", "a", "b", { route: "smooth" })],
      [modules[0], box("mid", 300, 400), modules[2]],
    ).get("s")!.crosses,
  ).toEqual([]);
});

it("routes the same with what it worked out before as without, and faster while one module is dragged", () => {
  const modules = Array.from({ length: 200 }, (_, i) =>
    box("n" + i, (i % 20) * 200 + (i % 3) * 8, Math.floor(i / 20) * 150),
  );
  const links: RouteLink[] = [];
  for (let i = 0; i < 180; i++) {
    links.push(
      link(`d${i}`, "n" + i, "n" + (i + 20), i % 5 ? {} : { label: "下一步" }),
    );
    if (i % 4 === 0)
      links.push(link(`s${i}`, "n" + i, "n" + (20 + ((i * 7) % 180))));
  }
  const memo: RouteMemo = new Map();
  routeLinks(links, modules, [], {}, memo);
  let kept = 0,
    plain = 0;
  for (let step = 1; step <= 12; step++) {
    const moved = modules.map((m) =>
      m.id === "n87"
        ? {
            ...m,
            bounds: {
              ...m.bounds,
              x: m.bounds.x + step * 14,
              y: m.bounds.y + step * 5,
            },
          }
        : m,
    );
    let started = performance.now();
    const again = routeLinks(links, moved, [], {}, memo);
    kept += performance.now() - started;
    started = performance.now();
    const afresh = routeLinks(links, moved);
    plain += performance.now() - started;
    expect([...again]).toEqual([...afresh]);
  }
  // Most links stand nowhere near the dragged module, and keep the way they had.
  expect(kept).toBeLessThan(plain * 0.75);
  expect(kept / 12).toBeLessThan(120);
});

it("runs a drawing's own lines between its parts clear of the others: a bow where one is clear, else round", () => {
  const parts = [
    box("a", 0, 0, 80, 30),
    box("b", 300, 0, 80, 30),
    box("c", 0, 200, 80, 30),
  ];
  // Nothing between: a gentle bow from edge to edge.
  const [clear] = connect(parts, [
    { from: "a", to: "b", label: "关系", size: 12 },
  ]);
  expect(clear!.path).toMatch(/^M[\d. -]+Q/);
  expect(clear!.crosses).toEqual([]);
  expect(clear!.heading.x).toBeGreaterThan(0.9);
  expect(clear!.label!.x).toBeGreaterThan(80);
  expect(clear!.label!.x).toBeLessThan(300);
  // A column of parts between the two: no bow passes them, so the line goes round at right
  // angles, and through none of them.
  const column = [
    box("top", 100, 0, 80, 24),
    ...[1, 2, 3, 4, 5].map((i) => box("k" + i, 60, i * 34, 160, 24)),
    box("bottom", 100, 6 * 34, 80, 24),
  ];
  const [round] = connect(column, [{ from: "top", to: "bottom" }], {
    margin: 8,
    stub: 12,
    lane: 8,
  });
  expect(round!.crosses).toEqual([]);
  expect(round!.path).not.toMatch(/^M[\d. -]+Q[\d. -]+$/);
  const turns = [...round!.path.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(
    (m) => ({ x: Number(m[1]), y: Number(m[2]) }),
  );
  for (const k of column.slice(1, 6))
    expect(through(turns, k.bounds, 2)).toBe(false);
  // Unknown ends and a line from a part to itself are left out, in place.
  expect(
    connect(parts, [
      { from: "a", to: "nowhere" },
      { from: "a", to: "a" },
      { from: "a", to: "c" },
    ]).map((c) => !!c),
  ).toEqual([false, false, true]);
});

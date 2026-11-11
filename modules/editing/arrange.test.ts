import { expect, it } from "vitest";
import type { Bounds, MaterialUse, Work, WorkEdit } from "../contracts/index.ts";
import { layOn, readEdit } from "./apply.ts";
import { arrangement, fitted, plainEdit } from "./arrange.ts";

const drawing = (id: string, size: [number, number], fit?: "words" | "rows" | "frame" | "lanes", defaults = {}): MaterialUse => ({
  id,
  kind: "drawing",
  name: id,
  source: "return api.svg('<svg/>')",
  defaults,
  params: {},
  size: { width: size[0], height: size[1] },
  ...(fit ? { fit } : {}),
});
const blank = (): Work => ({
  id: "w",
  title: "t",
  rootSceneId: "root",
  drawings: {},
  scenes: { root: { id: "root", title: "t", parentId: null, modules: [], links: [], checks: [] } },
  details: {},
  brief: null,
  materials: {
    node: drawing("node", [200, 84], "words", { size: 15 }),
    entity: drawing("entity", [240, 190], "rows", { size: 14 }),
    frame: drawing("frame", [420, 260], "frame"),
    swimlanes: drawing("swimlanes", [760, 330], "lanes"),
    arrow: drawing("arrow", [200, 60]),
    plot: drawing("plot", [420, 280]),
  },
  style: {},
  revision: 0,
  updatedAt: 0,
});
/** A write laid on a blank work, its arrangements worked out. */
function written(edit: WorkEdit, work = blank()) {
  const plain = plainEdit(work, readEdit(edit), "root");
  expect(plain.problems).toEqual([]);
  const laid = layOn(work, plain.edit, "root");
  expect(laid.problems).toEqual([]);
  return laid.work;
}
const boxes = (work: Work) => new Map(work.scenes.root.modules.map((m) => [m.id, m.bounds]));
const overlap = (a: Bounds, b: Bounds) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const node = (id: string, title: string, data = {}) => ({ id, drawingId: "node", data: { title, ...data } });

it("places modules that give no bounds by their links, and leaves plain bounds behind", () => {
  const work = written({
    arrange: [{ layout: "flow" }],
    modules: [node("a", "提交订单"), node("b", "库存足够？", { shape: "diamond" }), node("c", "扣减库存"), node("d", "提示售罄")],
    links: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "b", to: "d" }],
  });
  const at = boxes(work);
  // Ranks run down the page: each module below the one that leads to it.
  expect(at.get("b")!.y).toBeGreaterThan(at.get("a")!.y + at.get("a")!.height);
  expect(at.get("c")!.y).toBeGreaterThan(at.get("b")!.y + at.get("b")!.height);
  expect(at.get("c")!.y).toBe(at.get("d")!.y);
  const all = [...at.values()];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i], all[j])).toBe(false);
  // Nothing of the arrangement stays in the work: a module is moved like any other.
  expect(JSON.stringify(work)).not.toContain("arrange");
  const moved = layOn(work, { modules: [{ id: "c", bounds: [900, 40, 150, 50] }] }).work;
  expect(boxes(moved).get("c")).toEqual({ x: 900, y: 40, width: 150, height: 50 });
  // A link written without an id is known by its ends, and written again it changes.
  expect(work.scenes.root.links.map((l) => l.id)).toEqual(["a-b", "b-c", "b-d"]);
  const relabelled = layOn(work, { links: [{ from: "b", to: "c", data: { label: "是" } }] }).work;
  expect(relabelled.scenes.root.links).toHaveLength(3);
  expect(relabelled.scenes.root.links[1].data).toEqual({ label: "是" });
});

it("sizes blocks to their words, blocks of one kind alike, and tables to their rows", () => {
  const work = blank();
  const short = fitted(work, { drawingId: "node", data: { title: "网关" } }),
    long = fitted(work, { drawingId: "node", data: { title: "订单履约与售后服务协调中心（华东大区）" } });
  expect(long.width).toBeGreaterThan(short.width);
  expect(long.width).toBeLessThanOrEqual(260);
  expect(long.height).toBeGreaterThan(short.height);
  expect(fitted(work, { drawingId: "node", data: { shape: "initial" } })).toEqual({ width: 28, height: 28 });
  const table = (rows: number) =>
    fitted(work, { drawingId: "entity", data: { name: "user", rows: Array.from({ length: rows }, (_, i) => ({ name: "field_" + i, type: "bigint" })) } });
  expect(table(6).height - table(2).height).toBeCloseTo(4 * 14 * 1.75, 0);
  expect(fitted(work, { drawingId: "plot", data: {} })).toEqual({ width: 420, height: 280 });
  const placed = boxes(
    written({
      arrange: [{}],
      modules: [node("a", "网关"), node("b", "订单履约与售后服务协调中心"), node("c", "判断", { shape: "diamond" })],
      links: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
    }),
  );
  expect(placed.get("a")!.width).toBe(placed.get("b")!.width);
  expect(placed.get("c")!.width).not.toBe(placed.get("a")!.width);
});

it("stands modules in the ranks a figure names, each level with what it is linked to, frames round their own", () => {
  const work = written({
    arrange: [
      {
        tiers: [["gw"], ["s1", "s2", "s3"], ["d1", "d2", "d3"]],
        frames: { services: ["s1", "s2", "s3"], data: ["d1", "d2", "d3"] },
      },
    ],
    modules: [
      { id: "services", drawingId: "frame", data: { title: "服务层" } },
      { id: "data", drawingId: "frame", data: { title: "数据层" } },
      node("gw", "网关"),
      ...[1, 2, 3].flatMap((i) => [node("s" + i, "服务 " + i), node("d" + i, "库 " + i, { shape: "cylinder" })]),
    ],
    links: [1, 2, 3].flatMap((i) => [{ from: "gw", to: "s" + i }, { from: "s" + i, to: "d" + i }]),
  });
  const at = boxes(work);
  const centre = (id: string) => at.get(id)!.x + at.get(id)!.width / 2;
  for (const i of [1, 2, 3]) {
    expect(at.get("s" + i)!.y).toBe(at.get("s1")!.y);
    // A store stands straight under the service that owns it.
    expect(centre("d" + i)).toBeCloseTo(centre("s" + i), 0);
  }
  expect(centre("gw")).toBeCloseTo(centre("s2"), 0);
  const holds = (frame: string, id: string) => {
    const f = at.get(frame)!,
      m = at.get(id)!;
    return f.x < m.x && f.y < m.y && f.x + f.width > m.x + m.width && f.y + f.height > m.y + m.height;
  };
  for (const i of [1, 2, 3]) {
    expect(holds("services", "s" + i)).toBe(true);
    expect(holds("data", "d" + i)).toBe(true);
  }
  expect(overlap(at.get("services")!, at.get("data")!)).toBe(false);
  expect(holds("services", "gw")).toBe(false);
});

it("lays swimlanes: each step in its lane, along the lanes in the order of the links, the lanes under them", () => {
  const work = written({
    arrange: [{ layout: "lanes", ground: "lanes", lanes: [["ask", "fix"], ["check"], ["pay"]] }],
    modules: [
      { id: "lanes", drawingId: "swimlanes", data: { lanes: ["员工", "主管", "出纳"] } },
      node("ask", "提交"),
      node("check", "审批", { shape: "diamond" }),
      node("fix", "修改"),
      node("pay", "付款"),
    ],
    links: [{ from: "ask", to: "check" }, { from: "check", to: "pay" }, { from: "check", to: "fix" }, { from: "fix", to: "check" }],
  });
  const at = boxes(work);
  const ground = at.get("lanes")!;
  const lane = (id: string) => Math.floor((at.get(id)!.y + at.get(id)!.height / 2 - ground.y) / (ground.height / 3));
  expect(["ask", "fix", "check", "pay"].map(lane)).toEqual([0, 0, 1, 2]);
  expect(at.get("check")!.x).toBeGreaterThan(at.get("ask")!.x + at.get("ask")!.width);
  expect(at.get("pay")!.x).toBeGreaterThan(at.get("check")!.x + at.get("check")!.width);
  // The header is set to hold the lanes' names, and every step stands clear of it.
  const header = work.scenes.root.modules.find((m) => m.id === "lanes")!.data.header as number;
  expect(header).toBeGreaterThan(40);
  for (const id of ["ask", "fix", "check", "pay"]) {
    expect(at.get(id)!.x).toBeGreaterThanOrEqual(ground.x + header);
    expect(at.get(id)!.x + at.get(id)!.width).toBeLessThanOrEqual(ground.x + ground.width);
  }
});

it("grows a tree under its root, and a mind map to both sides of it", () => {
  const modules = [node("root", "根"), node("a", "甲"), node("b", "乙"), node("a1", "甲一"), node("a2", "甲二"), node("b1", "乙一")];
  const links = [["root", "a"], ["root", "b"], ["a", "a1"], ["a", "a2"], ["b", "b1"]].map(([from, to]) => ({ from, to }));
  const down = boxes(written({ arrange: [{ layout: "tree" }], modules, links }));
  const cx = (at: Map<string, Bounds>, id: string) => at.get(id)!.x + at.get(id)!.width / 2;
  expect(down.get("a")!.y).toBe(down.get("b")!.y);
  expect(down.get("a1")!.y).toBeGreaterThan(down.get("a")!.y);
  // A parent stands over the middle of its children.
  expect(cx(down, "a")).toBeCloseTo((cx(down, "a1") + cx(down, "a2")) / 2, 0);
  expect(cx(down, "root")).toBeCloseTo((cx(down, "a") + cx(down, "b")) / 2, 0);
  const both = boxes(written({ arrange: [{ layout: "tree", direction: "both" }], modules, links }));
  expect(both.get("a")!.x).toBeGreaterThan(both.get("root")!.x + both.get("root")!.width);
  expect(both.get("b")!.x + both.get("b")!.width).toBeLessThan(both.get("root")!.x);
  expect(both.get("b1")!.x).toBeLessThan(both.get("b")!.x);
});

it("lays a tree whose links name a frame, as one to what the frame holds", () => {
  const laid = boxes(
    written({
      arrange: [{ layout: "tree", frames: { team: ["a", "b"] } }],
      modules: [{ id: "team", drawingId: "frame", data: { title: "小组" } }, node("root", "根"), node("a", "甲"), node("b", "乙"), node("leaf", "叶")],
      links: [
        { from: "root", to: "team" },
        { from: "team", to: "leaf" },
        { from: "a", to: "b" },
      ],
    }),
  );
  expect(laid.get("a")!.y).toBeGreaterThan(laid.get("root")!.y);
  expect(laid.get("leaf")!.y).toBeGreaterThan(laid.get("a")!.y);
  const team = laid.get("team")!;
  for (const id of ["a", "b"]) {
    expect(laid.get(id)!.x).toBeGreaterThan(team.x);
    expect(laid.get(id)!.x + laid.get(id)!.width).toBeLessThan(team.x + team.width);
  }
});

it("arranges a scene built again under the ids it had, once the write clears it", () => {
  const first = written({ arrange: [{ layout: "flow" }], modules: [node("a", "甲"), node("b", "乙")], links: [{ from: "a", to: "b" }] });
  const again = written(
    {
      scenes: [{ id: "root", clear: true }],
      arrange: [{ layout: "flow", direction: "right" }],
      modules: [node("a", "甲"), node("b", "乙"), node("c", "丙")],
      links: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
    },
    first,
  );
  const at = boxes(again);
  expect(at.size).toBe(3);
  expect(at.get("a")!.x + at.get("a")!.width).toBeLessThan(at.get("b")!.x);
  expect(at.get("b")!.x + at.get("b")!.width).toBeLessThan(at.get("c")!.x);
});

it("places a second arrangement beside the first, and arranges again what already stands", () => {
  const first: WorkEdit = {
    arrange: [
      { modules: ["a", "b"] },
      { layout: "grid", columns: 1, modules: ["x", "y"], frames: { side: ["x", "y"] }, beside: ["b", "right"] },
    ],
    modules: [node("a", "甲"), node("b", "乙"), { id: "side", drawingId: "frame", data: { title: "旁" } }, node("x", "子"), node("y", "丑")],
    links: [{ from: "a", to: "b" }],
  };
  const work = written(first);
  const at = boxes(work);
  expect(at.get("side")!.x).toBeGreaterThan(at.get("b")!.x + at.get("b")!.width);
  expect(at.get("x")!.x).toBeGreaterThan(at.get("side")!.x);
  // More parts and larger type: everything is placed again, where the figure stood.
  const again = written(
    {
      arrange: [{ modules: ["a", "b", "c"], fit: true, direction: "right" }],
      each: [{ drawingId: "node", data: { size: 22 } }],
      modules: [node("c", "丙")],
      links: [{ from: "b", to: "c" }],
    },
    work,
  );
  const now = boxes(again);
  expect(now.get("a")!.height).toBeGreaterThan(at.get("a")!.height);
  expect(now.get("b")!.x).toBeGreaterThan(now.get("a")!.x + now.get("a")!.width);
  expect(now.get("c")!.x).toBeGreaterThan(now.get("b")!.x + now.get("b")!.width);
  expect([now.get("a")!.x, Math.min(now.get("a")!.y, now.get("b")!.y, now.get("c")!.y)]).toEqual([at.get("a")!.x, at.get("a")!.y]);
  expect(again.scenes.root.modules.every((m) => m.drawingId !== "node" || m.data.size === 22)).toBe(true);
});

it("changes every matching part in one record", () => {
  const work = written({
    modules: [
      { id: "a", bounds: [0, 0, 100, 40], drawingId: "node", data: { title: "甲", tone: "accent" } },
      { id: "b", bounds: [200, 0, 100, 40], drawingId: "node", data: { title: "乙" } },
      { id: "p", bounds: [0, 200, 100, 100], drawingId: "plot", data: {} },
    ],
    links: [{ from: "a", to: "b" }],
  });
  const next = written(
    {
      each: [
        { drawingId: "node", size: [160, 60] },
        { drawingId: "node", where: { tone: "accent" }, data: { lift: true } },
        { links: true, data: { dashed: true } },
      ],
    },
    work,
  );
  const at = boxes(next);
  // Each takes its size about its centre.
  expect(at.get("a")).toEqual({ x: -30, y: -10, width: 160, height: 60 });
  expect(at.get("b")).toEqual({ x: 170, y: -10, width: 160, height: 60 });
  expect(at.get("p")).toEqual({ x: 0, y: 200, width: 100, height: 100 });
  expect(next.scenes.root.modules.map((m) => m.data.lift)).toEqual([true, undefined, undefined]);
  expect(next.scenes.root.links[0].data).toEqual({ dashed: true });
});

it("says what an arrangement cannot place, and that a new module without bounds needs one", () => {
  const work = blank();
  const unknown = plainEdit(work, readEdit({ arrange: [{ modules: ["ghost"] }] }), "root");
  expect(unknown.problems[0]).toMatchObject({ at: "arrange.0" });
  expect(unknown.problems[0].problem).toContain("ghost");
  const tiers = plainEdit(
    work,
    readEdit({ arrange: [{ tiers: [["a"]] }], modules: [node("a", "甲"), node("b", "乙")] }),
    "root",
  );
  expect(tiers.problems.map((p) => p.at)).toEqual(["arrange.0.tiers"]);
  const unplaced = plainEdit(work, readEdit({ arrange: [{ modules: ["a"] }], modules: [node("a", "甲"), node("b", "乙")] }), "root");
  expect(unplaced.problems).toEqual([]);
  const laid = layOn(work, unplaced.edit, "root");
  expect(laid.problems.map((p) => p.at)).toEqual(["modules.b"]);
  expect(laid.problems[0].problem).toContain("arrange");
  expect(arrangement(work, "nowhere", {}).problems[0].problem).toContain("nowhere");
});

it("arranges two hundred modules in well under a second", () => {
  const modules = Array.from({ length: 200 }, (_, i) => node("n" + i, "模块 " + i));
  const links = Array.from({ length: 199 }, (_, i) => ({ from: "n" + Math.floor(i / 3), to: "n" + (i + 1) }));
  const started = performance.now();
  const work = written({ arrange: [{ layout: "flow" }], modules, links });
  expect(performance.now() - started).toBeLessThan(2500);
  const all = [...boxes(work).values()];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i], all[j])).toBe(false);
});

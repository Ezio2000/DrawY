import { describe, expect, it } from "vitest";
import { fixture } from "../runtime/fixture.ts";
import { applied } from "../editing/apply.ts";
import { authorWriteSchema, type AuthorWrite, type Work } from "../contracts/index.ts";
import { WRITE_EXAMPLE, EDIT_EXAMPLE } from "../agent/prompts.ts";
import { fromAuthor } from "./author.ts";
import { validateWork } from "./index.ts";

/** A work with two modules apart from each other and no links, to connect. */
function work(): Work {
  const w = fixture();
  w.scenes.root.modules = [
    { ...w.scenes.root.modules[0], id: "left", bounds: { x: 0, y: 0, width: 100, height: 100 }, anchors: {} },
    { ...w.scenes.root.modules[0], id: "right", bounds: { x: 500, y: 0, width: 100, height: 100 }, anchors: {} },
  ];
  w.scenes.root.links = [];
  w.scenes.root.checks = [];
  // The library's arrow, as the workspace takes it in when a write names it.
  w.materials.arrow = { id: "arrow", kind: "drawing", name: "箭头", source: "", defaults: {}, params: {} };
  return w;
}
const written = (w: Work, input: Omit<AuthorWrite, "baseRevision">) => {
  const next = applied(w, fromAuthor(w, authorWriteSchema.parse({ baseRevision: w.revision, ...input }), "root"));
  validateWork(next);
  return next;
};
const drawing = () => fixture().scenes.root.modules[0].drawingId;

describe("the author's flat write", () => {
  it("gives a new module what it left out, and changes a known one only where it says", () => {
    const w = work();
    const next = written(w, {
      modules: [
        { id: "fresh", bounds: [1, 2, 3, 4], drawingId: drawing(), data: { text: "你好" } },
        { id: "right", bounds: [600, 0, 100, 100] },
      ],
    });
    expect(next.scenes.root.modules.at(-1)).toEqual({
      id: "fresh",
      label: "你好",
      bounds: { x: 1, y: 2, width: 3, height: 4 },
      drawingId: drawing(),
      group: null,
      target: null,
      anchors: {},
      data: { text: "你好" },
    });
    const moved = next.scenes.root.modules.find((m) => m.id === "right")!;
    expect(moved.bounds.x).toBe(600);
    expect(moved.label).toBe(w.scenes.root.modules[1].label);
    expect(next.scenes.root.modules.find((m) => m.id === "left")).toEqual(w.scenes.root.modules[0]);
  });
  it("names what a new part is missing", () => {
    const w = work();
    expect(() => written(w, { modules: [{ id: "typo", data: {} }] })).toThrow(/模块 typo 是新增的/);
    expect(() => written(w, { links: [{ id: "l", from: "left" }] })).toThrow(/连线 l 是新增的/);
    expect(() => written(w, { links: [{ id: "l", from: "left", to: "gone" }] })).toThrow(/gone/);
  });
  it("joins the sides facing each other for a link given two modules, as an arrow by default", () => {
    const next = written(work(), { links: [{ id: "l", from: "left", to: "right", data: { label: "去" } }] });
    expect(next.scenes.root.links[0]).toEqual({
      id: "l",
      drawingId: "arrow",
      from: { moduleId: "left", anchor: "right" },
      to: { moduleId: "right", anchor: "left" },
      data: { label: "去" },
    });
    const [left, right] = next.scenes.root.modules;
    expect(left.anchors.right).toEqual({ x: 1, y: 0.5 });
    expect(right.anchors.left).toEqual({ x: 0, y: 0.5 });
  });
  it("works sides out from where this write puts the modules", () => {
    const next = written(work(), {
      modules: [{ id: "right", bounds: [0, 500, 100, 100] }],
      links: [{ id: "l", from: "left", to: "right" }],
    });
    expect(next.scenes.root.links[0].from.anchor).toBe("bottom");
    expect(next.scenes.root.links[0].to.anchor).toBe("top");
  });
  it("takes a side or the module's own anchor by name, and reports one it does not have", () => {
    const w = work();
    w.scenes.root.modules[0].anchors = { flame: { x: 0.3, y: 0.2 } };
    const next = written(w, {
      links: [
        {
          id: "l",
          from: { moduleId: "left", anchor: "flame" },
          to: { moduleId: "right", anchor: "top" },
        },
      ],
    });
    expect(next.scenes.root.links[0].from.anchor).toBe("flame");
    expect(next.scenes.root.modules[1].anchors.top).toEqual({ x: 0.5, y: 0 });
    expect(() =>
      written(w, {
        links: [{ id: "l", from: { moduleId: "left", anchor: "nose" }, to: "right" }],
      }),
    ).toThrow("连接锚点不存在");
  });
  it("re-joins one end of a known link, facing its other end", () => {
    const w = work();
    w.scenes.root.modules.push({
      ...w.scenes.root.modules[0],
      id: "below",
      bounds: { x: 500, y: 500, width: 100, height: 100 },
    });
    const once = written(w, { links: [{ id: "l", from: "left", to: "right" }] });
    const next = written(once, { links: [{ id: "l", to: "below" }] });
    expect(next.scenes.root.links[0].from).toEqual(once.scenes.root.links[0].from);
    expect(next.scenes.root.links[0].to.moduleId).toBe("below");
  });
  it("keeps the checks a clearing write gives, on the modules it rebuilds", () => {
    const w = work();
    w.scenes.root.checks = [{ moduleId: "right", selector: "button.old" }];
    const check = { moduleId: "left", selector: "button.new" };
    const next = written(w, {
      scenes: [{ id: "root", clear: true, checks: [check] }],
      modules: [{ id: "left", bounds: [0, 0, 100, 100], drawingId: drawing() }],
    });
    expect(next.scenes.root.modules.map((m) => m.id)).toEqual(["left"]);
    expect(next.scenes.root.checks).toEqual([check]);
    // Without new ones, the old checks go with what they were on.
    const bare = written(w, {
      scenes: [{ id: "root", clear: true }],
      modules: [{ id: "right", bounds: [0, 0, 100, 100], drawingId: drawing() }],
    });
    expect(bare.scenes.root.checks).toEqual([]);
  });
  it("makes scenes, puts parts in the one it names, and recomposes with clear", () => {
    const w = work();
    const next = written(w, {
      scenes: [{ id: "more", title: "更多" }],
      modules: [{ id: "here", scene: "more", bounds: [0, 0, 10, 10], drawingId: drawing() }],
    });
    expect(next.scenes.more.parentId).toBe("root");
    expect(next.scenes.more.modules.map((m) => m.id)).toEqual(["here"]);
    expect(() => written(w, { scenes: [{ id: "nameless" }] })).toThrow(/场景 nameless 是新的/);
    const again = written(w, {
      scenes: [{ id: "root", clear: true, title: "重画" }],
      modules: [{ id: "left", bounds: [9, 9, 9, 9], drawingId: drawing() }],
    });
    expect(again.scenes.root.title).toBe("重画");
    expect(again.scenes.root.modules.map((m) => m.id)).toEqual(["left"]);
    expect(again.scenes.root.modules[0].bounds.x).toBe(9);
  });
  it("restacks and removes, finding a part in whichever scene holds it", () => {
    const w = work();
    w.scenes.child.modules = [{ ...w.scenes.root.modules[0], id: "deep" }];
    const next = written(w, {
      scenes: [{ id: "root", order: ["right", "left"] }],
      remove: { modules: ["deep"] },
    });
    expect(next.scenes.root.modules.map((m) => m.id)).toEqual(["right", "left"]);
    expect(next.scenes.child.modules).toEqual([]);
  });
  it("refuses a field it does not know rather than dropping it silently", () => {
    expect(authorWriteSchema.safeParse({ baseRevision: 1, sceneEdits: [] }).success).toBe(false);
    expect(
      authorWriteSchema.safeParse({ baseRevision: 1, modules: [{ id: "a", bound: [0, 0, 1, 1] }] }).success,
    ).toBe(false);
    expect(
      authorWriteSchema.safeParse({ baseRevision: 1, modules: [{ id: "a", bounds: [0, 0, 0, 1] }] }).success,
    ).toBe(false);
  });
  it("holds the examples the author is shown", () => {
    expect(authorWriteSchema.safeParse(WRITE_EXAMPLE).success).toBe(true);
    expect(authorWriteSchema.safeParse(EDIT_EXAMPLE).success).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { fixture } from "../runtime/fixture.ts";
import { EditRejected, labelOf, shownName, type Problem, type Work, type WorkEdit } from "../contracts/index.ts";
import { linkEnds } from "../contracts/geometry.ts";
import { WRITE_EXAMPLE, EDIT_EXAMPLE } from "../agent/prompts.ts";
import { writeSchema } from "../agent/tools.ts";
import { validateWork } from "../workspace/index.ts";
import { applied, composed, layOn, readEdit } from "./apply.ts";

/** A work with two modules apart from each other and no links, to connect. */
function work(): Work {
  const w = fixture();
  const m = w.scenes.root.modules[0];
  w.scenes.root.modules = [
    { ...m, id: "left", bounds: { x: 0, y: 0, width: 100, height: 100 }, data: { rows: [{ v: 1 }, { v: 2 }, { v: 3 }], names: { "St. Louis": "x" }, text: "左" } },
    { ...m, id: "right", bounds: { x: 500, y: 0, width: 100, height: 100 }, data: {} },
  ];
  w.scenes.root.links = [];
  w.scenes.root.checks = [];
  // The library's arrow, as the workspace takes it in when a write names it.
  w.materials.arrow = { id: "arrow", kind: "drawing", name: "箭头", source: "return api.svg('<svg/>')", defaults: { size: 3 }, params: {} };
  return w;
}
const written = (w: Work, input: unknown) => {
  const next = applied(w, readEdit(input), "root");
  validateWork(next);
  return next;
};
const problems = (fn: () => unknown): Problem[] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof EditRejected) return e.problems;
    throw e;
  }
  throw Error("was not refused");
};
const tier = "tier";

describe("what a write says", () => {
  it("gives a new module what it left out, and keeps everything a known one leaves out", () => {
    const w = work();
    const next = written(w, {
      modules: [
        { id: "fresh", bounds: [1, 2, 3, 4], drawingId: tier, data: { text: "你好" } },
        { id: "right", bounds: [600, 0, 100, 100] },
      ],
    });
    expect(next.scenes.root.modules.at(-1)).toEqual({
      id: "fresh",
      bounds: { x: 1, y: 2, width: 3, height: 4 },
      drawingId: tier,
      data: { text: "你好" },
    });
    expect(labelOf(next.scenes.root.modules.at(-1)!)).toBe("你好");
    const moved = next.scenes.root.modules.find((m) => m.id === "right")!;
    expect(moved.bounds.x).toBe(600);
    expect(moved.group).toBe(w.scenes.root.modules[1].group);
    expect(next.scenes.root.modules[0]).toEqual(w.scenes.root.modules[0]);
  });
  it("names what a new part is missing, and what it may be meant to be", () => {
    const w = work();
    expect(problems(() => written(w, { modules: [{ id: "typo", data: {} }] }))[0].problem).toMatch(/模块 typo 是新增的.*bounds.*drawingId/);
    expect(problems(() => written(w, { links: [{ id: "l", from: "left" }] }))[0].problem).toMatch(/连线 l 是新增的.*to/);
    expect(problems(() => written(w, { links: [{ id: "l", from: "left", to: "gone" }] }))[0]).toEqual({
      at: "links.l.to",
      problem: expect.stringMatching(/gone 不在场景 root 里；这个场景有 left、right/),
    });
  });
  it("finds a known part in whichever scene holds it, and keeps ids unique across scenes", () => {
    const w = work();
    w.scenes.child.modules = [{ ...w.scenes.root.modules[0], id: "deep" }];
    const next = written(w, { modules: [{ id: "deep", bounds: [9, 9, 9, 9] }] });
    expect(next.scenes.child.modules[0].bounds.x).toBe(9);
    expect(next.scenes.root.modules.map((m) => m.id)).toEqual(["left", "right"]);
    expect(problems(() => written(w, { modules: [{ id: "deep", scene: "root", bounds: [1, 1, 1, 1], drawingId: tier }] }))[0].at).toBe("modules.deep.scene");
    expect(written(w, { remove: { modules: ["deep"] } }).scenes.child.modules).toEqual([]);
  });
  it("refuses a field it does not know rather than dropping it silently, saying which record", () => {
    expect(problems(() => readEdit({ modules: [{ id: "a", bound: [0, 0, 1, 1] }] }))[0]).toEqual({
      at: "modules.a",
      problem: "不认识的字段 bound",
    });
    expect(problems(() => readEdit({ modules: [{ id: "a", bounds: [0, 0, 0, 1] }] }))[0].at).toBe("modules.a.bounds");
    expect(problems(() => readEdit({ sceneEdits: [] }))[0].problem).toMatch(/sceneEdits/);
  });
  it("holds the examples the author is shown", () => {
    expect(writeSchema.safeParse(WRITE_EXAMPLE).success).toBe(true);
    expect(writeSchema.safeParse(EDIT_EXAMPLE).success).toBe(true);
  });
});

describe("data, defaults and style merge the same way", () => {
  it("changes only the keys given; null deletes one", () => {
    const next = written(work(), { modules: [{ id: "left", data: { text: "新", names: null } }] });
    expect(next.scenes.root.modules[0].data).toEqual({ rows: [{ v: 1 }, { v: 2 }, { v: 3 }], text: "新" });
    const deep = written(work(), { modules: [{ id: "left", data: { names: { "St. Louis": "圣路易斯", Paris: "巴黎" } } }] });
    expect(deep.scenes.root.modules[0].data.names).toEqual({ "St. Louis": "圣路易斯", Paris: "巴黎" });
  });
  it("replaces a list given whole, and changes items of one given by position", () => {
    const whole = written(work(), { modules: [{ id: "left", data: { rows: [{ v: 9 }] } }] });
    expect(whole.scenes.root.modules[0].data.rows).toEqual([{ v: 9 }]);
    const items = written(work(), {
      modules: [{ id: "left", data: { rows: { "0": null, "1": { v: 20 }, "3": { v: 4 } } } }],
    });
    // Positions mean the list as it stood, whatever is deleted beside them.
    expect(items.scenes.root.modules[0].data.rows).toEqual([{ v: 20 }, { v: 3 }, { v: 4 }]);
    expect(problems(() => written(work(), { modules: [{ id: "left", data: { rows: { "9": { v: 1 } } } }] }))[0]).toEqual({
      at: "modules.left.data.rows.9",
      problem: expect.stringMatching(/只有 3 项，没有位置 9/),
    });
  });
  it("merges style tokens instead of replacing the set", () => {
    const w = work();
    const next = written(w, { style: { accent: "#000", font: null } });
    expect(next.style).toEqual({ ink: w.style.ink, muted: w.style.muted, accent: "#000" });
  });
});

describe("links own where they meet a module", () => {
  const ends = (w: Work, id: string) =>
    linkEnds(w.scenes.root.links.find((l) => l.id === id)!, (m) => w.scenes.root.modules.find((x) => x.id === m)!.bounds);
  it("joins the sides facing each other for two module ids, as an arrow by default", () => {
    const next = written(work(), { links: [{ id: "l", from: "left", to: "right", data: { label: "去" } }] });
    expect(next.scenes.root.links[0]).toEqual({
      id: "l",
      drawingId: "arrow",
      from: { moduleId: "left" },
      to: { moduleId: "right" },
      data: { label: "去" },
    });
    expect(ends(next, "l")).toEqual({
      from: { x: 100, y: 50, side: "right" },
      to: { x: 500, y: 50, side: "left" },
    });
  });
  it("follows as modules move, and fixed ends move with their module", () => {
    const w = written(work(), {
      links: [
        { id: "auto", from: "left", to: "right" },
        { id: "fixed", from: { moduleId: "left", at: "top" }, to: { moduleId: "right", at: [0.25, 0.75] } },
      ],
    });
    const moved = written(w, { modules: [{ id: "right", bounds: [0, 500, 200, 100] }] });
    expect(ends(moved, "auto")).toEqual({
      from: { x: 50, y: 100, side: "bottom" },
      to: { x: 100, y: 500, side: "top" },
    });
    expect(ends(moved, "fixed")).toEqual({
      from: { x: 50, y: 0, side: "top" },
      to: { x: 50, y: 575, side: null },
    });
  });
  it("changes one end of a link and touches nothing else", () => {
    const w = written(work(), {
      links: [
        { id: "a", from: { moduleId: "left", at: [0.2, 1] }, to: "right" },
        { id: "b", from: { moduleId: "left", at: [0.8, 1] }, to: "right" },
      ],
    });
    const next = written(w, { links: [{ id: "a", from: { moduleId: "left", at: [0.7, 0] } }] });
    expect(next.scenes.root.links[0].from.at).toEqual([0.7, 0]);
    expect(next.scenes.root.links[1]).toEqual(w.scenes.root.links[1]);
    expect(next.scenes.root.modules).toEqual(w.scenes.root.modules);
  });
  it("refuses a place it cannot read, saying what it can", () => {
    const [p] = problems(() => readEdit({ links: [{ id: "l", from: { moduleId: "a", at: "middle" }, to: "b" }] }));
    expect(p.at).toBe("links.l.from");
  });
});

describe("what remove takes along", () => {
  it("removes a module with its links and checks", () => {
    const w = written(work(), { links: [{ id: "l", from: "left", to: "right" }] });
    w.scenes.root.checks = [{ moduleId: "left", selector: "button" }];
    const next = written(w, { remove: { modules: ["left"] } });
    expect(next.scenes.root.links).toEqual([]);
    expect(next.scenes.root.checks).toEqual([]);
  });
  it("removes a scene with those under it, and what led there leads nowhere", () => {
    const w = work();
    w.scenes.root.modules[0].target = { kind: "scene", id: "child" };
    const deeper = written(w, { scenes: [{ id: "deeper", title: "更深", parentId: "child" }] });
    const next = written(deeper, { remove: { scenes: ["child"] } });
    expect(Object.keys(next.scenes)).toEqual(["root"]);
    expect(next.scenes.root.modules[0].target).toBeUndefined();
    expect(problems(() => written(w, { remove: { scenes: ["root"] } }))[0].problem).toBe("根场景不能删除");
  });
  it("removes a detail, and what opened it opens nothing", () => {
    const w = work();
    w.scenes.root.modules[0].target = { kind: "detail", id: "explanation" };
    const next = written(w, { remove: { details: ["explanation"] } });
    expect(next.scenes.root.modules[0].target).toBeUndefined();
  });
  it("says what it could not remove without refusing the rest", () => {
    const { work: next, absent, problems: found } = layOn(work(), readEdit({ title: "新", remove: { modules: ["ghost"], links: ["ghost-link"] } }));
    expect(found).toEqual([]);
    expect(absent).toEqual(["ghost", "ghost-link"]);
    expect(next.title).toBe("新");
  });
  it("lets a write recreate a part under an id it removes", () => {
    const next = written(work(), {
      remove: { modules: ["left"] },
      modules: [{ id: "left", bounds: [7, 7, 7, 7], drawingId: tier }],
    });
    expect(next.scenes.root.modules.at(-1)).toMatchObject({ id: "left", data: {} });
  });
});

describe("scenes", () => {
  it("makes scenes, puts parts in the one named, and recomposes with clear", () => {
    const w = work();
    const next = written(w, {
      scenes: [{ id: "more", title: "更多" }],
      modules: [{ id: "here", scene: "more", bounds: [0, 0, 10, 10], drawingId: tier }],
    });
    expect(next.scenes.more.parentId).toBe("root");
    expect(next.scenes.more.modules.map((m) => m.id)).toEqual(["here"]);
    expect(problems(() => written(w, { scenes: [{ id: "nameless" }] }))[0].problem).toMatch(/场景 nameless 是新的/);
    const again = written(w, {
      scenes: [{ id: "root", clear: true, title: "重画" }],
      modules: [{ id: "left", bounds: [9, 9, 9, 9], drawingId: tier }],
    });
    expect(again.scenes.root.title).toBe("重画");
    expect(again.scenes.root.modules.map((m) => m.id)).toEqual(["left"]);
    expect(again.scenes.root.modules[0].data).toEqual({});
  });
  it("keeps the checks a clearing write gives, on the modules it rebuilds", () => {
    const w = work();
    w.scenes.root.checks = [{ moduleId: "right", selector: "button.old" }];
    const check = { moduleId: "left", selector: "button.new" };
    const next = written(w, {
      scenes: [{ id: "root", clear: true, checks: [check] }],
      modules: [{ id: "left", bounds: [0, 0, 100, 100], drawingId: tier }],
    });
    expect(next.scenes.root.checks).toEqual([check]);
    const bare = written(w, {
      scenes: [{ id: "root", clear: true }],
      modules: [{ id: "right", bounds: [0, 0, 100, 100], drawingId: tier }],
    });
    expect(bare.scenes.root.checks).toEqual([]);
  });
  it("restacks only the modules it lists, among the places they hold", () => {
    const w = fixture();
    const [first, second, third, ...rest] = w.scenes.root.modules.map((m) => m.id);
    const next = written(w, { scenes: [{ id: "root", order: [third, first] }] });
    expect(next.scenes.root.modules.map((m) => m.id)).toEqual([third, second, first, ...rest]);
    expect(problems(() => written(w, { scenes: [{ id: "root", order: ["nope"] }] }))[0].problem).toMatch(/order 里的模块 nope/);
  });
  it("keeps a script with its scene, changed whole or in part", () => {
    const w = work();
    const scripted = written(w, { scenes: [{ id: "child", interaction: "api.on('a','b',()=>{ let x = 1; })" }] });
    const edited = written(scripted, { scenes: [{ id: "child", interactionEdits: [{ find: "let x = 1", replace: "let x = 2" }] }] });
    expect(edited.scenes.child.interaction).toContain("let x = 2");
    expect(written(edited, { scenes: [{ id: "child", interaction: null }] }).scenes.child.interaction).toBeUndefined();
    expect(problems(() => written(w, { scenes: [{ id: "child", interactionEdits: [{ find: "a", replace: "b" }] }] }))[0].at).toBe("scenes.child.interactionEdits");
  });
});

describe("drawings and text", () => {
  const source = `const s = api.data.size; return api.svg('<svg font-size="16" data-a="16"></svg>');`;
  const withDrawing = (extra = {}) => written(work(), { drawings: [{ id: "cup", source, ...extra }] });
  it("takes a name by default and keeps what a change leaves out", () => {
    const w = withDrawing({ defaults: { size: 18 }, params: { size: { label: "字号", type: "number" } } });
    expect(w.drawings.cup).toMatchObject({ name: "cup", defaults: { size: 18 } });
    const next = written(w, { drawings: [{ id: "cup", defaults: { size: 20 } }] });
    expect(next.drawings.cup).toEqual({ ...w.drawings.cup, defaults: { size: 20 } });
    const unset = written(next, { drawings: [{ id: "cup", params: { size: null } }] });
    expect(unset.drawings.cup.params).toEqual({});
    expect(problems(() => written(work(), { drawings: [{ id: "new" }] }))[0].problem).toMatch(/画法 new 是新增的/);
  });
  it("edits its code in place, finding exactly what it names", () => {
    const w = withDrawing();
    const next = written(w, { drawings: [{ id: "cup", edits: [{ find: 'font-size="16"', replace: 'font-size="${s}"' }] }] });
    expect(next.drawings.cup.source).toContain('font-size="${s}" data-a="16"');
    const many = problems(() => written(w, { drawings: [{ id: "cup", edits: [{ find: "16", replace: "18" }] }] }))[0];
    expect(many).toEqual({ at: "drawings.cup.edits.0", problem: expect.stringMatching(/出现了 2 次/) });
    const all = written(w, { drawings: [{ id: "cup", edits: [{ find: "16", replace: "18", all: true }] }] });
    expect(all.drawings.cup.source).toContain('font-size="18" data-a="18"');
    const none = problems(() => written(w, { drawings: [{ id: "cup", edits: [{ find: 'font-size="15"', replace: "x" }] }] }))[0];
    expect(none.problem).toMatch(/找不到/);
    expect(none.problem).toContain("font-size");
  });
  it("copies a drawing for one module, from the work or the library", () => {
    const w = written(withDrawing({ defaults: { size: 18 } }), {
      modules: [
        { id: "left", drawingId: "cup" },
        { id: "right", drawingId: "cup" },
      ],
    });
    const next = written(w, {
      drawings: [{ id: "cup-big", from: "cup", edits: [{ find: 'font-size="16"', replace: 'font-size="30"' }] }],
      modules: [{ id: "right", drawingId: "cup-big" }],
    });
    expect(next.drawings.cup).toEqual(w.drawings.cup);
    expect(next.drawings["cup-big"].defaults).toEqual({ size: 18 });
    expect(next.drawings["cup-big"].source).toContain('font-size="30"');
    expect(next.scenes.root.modules.map((m) => m.drawingId)).toEqual(["cup", "cup-big"]);
    const fromLibrary = written(work(), { drawings: [{ id: "my-arrow", from: "arrow" }] });
    expect(fromLibrary.drawings["my-arrow"]).toMatchObject({ name: "箭头", defaults: { size: 3 }, source: "return api.svg('<svg/>')" });
    expect(problems(() => written(work(), { drawings: [{ id: "x", from: "no-such" }] }))[0].at).toBe("drawings.x.from");
  });
  it("changes a detail in part", () => {
    const next = written(work(), { details: [{ id: "explanation", edits: [{ find: "这些层次", replace: "这五层" }] }] });
    expect(next.details.explanation.html).toContain("这五层");
    expect(next.details.explanation.title).toBe("理解需求层次");
    expect(problems(() => written(work(), { details: [{ id: "new" }] }))[0].problem).toMatch(/详情 new 是新增的/);
  });
});

describe("two edits as one", () => {
  it("lays a correction over the write it corrects, as one record per id", () => {
    const held = {
      modules: [
        { id: "a", bounds: [0, 0, 10, 10], drawingId: tier, data: { text: "甲", size: 12 } },
        { id: "b", bounds: [20, 0, 10, 10], drawingId: "no-such" },
      ],
      links: [{ id: "l", from: "a", to: "ghost", data: { label: "到" } }],
      drawings: [{ id: "cup", source: "x", edits: [{ find: "x", replace: "y" }] }],
      style: { ink: "#111" },
      materials: ["one"],
    };
    const fix = {
      modules: [{ id: "b", drawingId: tier }, { id: "a", data: { size: 16 } }],
      links: [{ id: "l", to: "b" }],
      drawings: [{ id: "cup", edits: [{ find: "y", replace: "return api.svg('<svg/>')" }] }],
      style: { accent: "#222" },
      materials: ["two"],
    };
    expect(composed(held, fix)).toEqual({
      modules: [
        { id: "a", bounds: [0, 0, 10, 10], drawingId: tier, data: { text: "甲", size: 16 } },
        { id: "b", bounds: [20, 0, 10, 10], drawingId: tier },
      ],
      links: [{ id: "l", from: "a", to: "b", data: { label: "到" } }],
      drawings: [{ id: "cup", source: "x", edits: [{ find: "x", replace: "y" }, { find: "y", replace: "return api.svg('<svg/>')" }] }],
      style: { ink: "#111", accent: "#222" },
      materials: ["one", "two"],
    });
    const next = written(work(), composed(held, fix));
    expect(next.scenes.root.links[0].to).toEqual({ moduleId: "b" });
  });
  it("drops what the correction removes from what it holds, and leaves unrelated writes alone", () => {
    const held = { links: [{ id: "bad", from: "a", to: "ghost" }, { id: "good", from: "a", to: "b" }] };
    expect(composed(held, { remove: { links: ["bad"] } })).toEqual({
      links: [{ id: "good", from: "a", to: "b" }],
      remove: { links: ["bad"] },
    });
    const edit: WorkEdit = { title: "x" };
    expect(composed({}, edit)).toEqual(edit);
  });
});

describe("what a module is called", () => {
  it("goes by its title before its other words, and by its drawing rather than its id", () => {
    const w = work();
    const [left, right] = w.scenes.root.modules;
    const titled = { ...left, data: { title: "烘焙", text: "200°C 左右 12 分钟" } };
    expect(labelOf(titled)).toBe("烘焙");
    // The author knows a module without words by its id; a person sees its drawing's name.
    expect(labelOf(right)).toBe("right");
    expect(shownName(w, right)).toBe("斜边层级");
    expect(shownName(w, { ...right, label: "右边" })).toBe("右边");
  });
});

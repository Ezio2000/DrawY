import { describe, expect, it } from "vitest";
import { fixture } from "../runtime/fixture.ts";
import { validateWork } from "../workspace/index.ts";
import type { MaterialUse, Work, WorkEdit } from "../contracts/index.ts";
import {
  add,
  addScene,
  align,
  arrange,
  changesBetween,
  connect,
  copy,
  distribute,
  duplicate,
  fieldsOf,
  fork,
  group,
  linkLook,
  moveParts,
  paste,
  reattach,
  removeDetail,
  removeParts,
  removeScene,
  rename,
  renameScene,
  replace,
  resized,
  restack,
  restOf,
  reverse,
  scaled,
  setData,
  setDetail,
  setDrawing,
  setInteraction,
  setModule,
  setStyles,
  setTarget,
  shadowed,
  snap,
  ungroup,
  useDrawing,
} from "./index.ts";

/** The work an edit leaves, checked as the workspace checks every commit. */
function apply(work: Work, edit: WorkEdit | null): Work {
  expect(edit).not.toBeNull();
  expect(edit!.baseRevision).toBe(work.revision);
  const next = structuredClone(work);
  for (const s of edit!.scenes ?? []) next.scenes[s.id] = s;
  for (const d of edit!.drawings ?? []) next.drawings[d.id] = d;
  for (const i of edit!.interactions ?? []) next.interactions[i.id] = i;
  for (const d of edit!.details ?? []) next.details[d.id] = d;
  for (const k of edit!.remove?.scenes ?? []) delete next.scenes[k];
  for (const k of edit!.remove?.interactions ?? []) delete next.interactions[k];
  for (const k of edit!.remove?.details ?? []) delete next.details[k];
  if (edit!.style) next.style = edit!.style;
  next.revision++;
  validateWork(next);
  return next;
}
const scene = (w: Work) => w.scenes.root;
const module = (w: Work, id: string) =>
  scene(w).modules.find((m) => m.id === id)!;
const label: MaterialUse = {
  id: "label",
  kind: "drawing",
  name: "标签",
  source: "return api.svg('<svg><text>'+api.data.text+'</text></svg>')",
  defaults: { size: 16, align: "center" },
  params: {
    text: { type: "text" },
    size: { type: "number", min: 8, max: 72, step: 1 },
    align: { type: "choice", options: ["start", "center", "end"] },
    color: { type: "color" },
  },
};

describe("hand edits", () => {
  it("offers the values a drawing declares, then the plain values in the data, words first", () => {
    const work = fixture();
    work.drawings.tier.params = {
      tip: { label: "说明", type: "text" },
      color: { label: "底色", type: "color" },
    };
    expect(fieldsOf(work, module(work, "level-0"))).toEqual([
      {
        key: "tip",
        label: "说明",
        type: "text",
        value: "发挥潜能",
        set: true,
        optional: false,
      },
      {
        key: "label",
        type: "text",
        value: "自我实现",
        set: true,
        optional: false,
      },
      {
        key: "color",
        label: "底色",
        type: "color",
        value: "#d68c6c",
        set: true,
        optional: false,
      },
    ]);
    // A library drawing names its values in the app; unset ones show its defaults.
    work.materials.label = label;
    const words = {
      ...module(work, "heading"),
      drawingId: "label",
      data: { text: "标题" },
    };
    // Only a value with a default, or a colour, which falls back to the work's style, can
    // be given back.
    expect(
      fieldsOf(work, words).map((f) => [
        f.key,
        f.type,
        f.value,
        f.set,
        f.optional,
      ]),
    ).toEqual([
      ["text", "text", "标题", true, false],
      ["align", "choice", "center", false, true],
      ["color", "color", undefined, false, true],
      ["size", "number", 16, false, true],
    ]);
    // States the code tests for, structure and declared values of another shape stay out.
    const odd = {
      ...module(work, "heading"),
      drawingId: "label",
      data: { text: 3, phase: "new", from: { x: 0, y: 0 }, on: true },
    };
    expect(fieldsOf(work, odd).map((f) => f.key)).toEqual([
      "align",
      "color",
      "size",
      "on",
    ]);
  });

  it("retypes words held in the module's data, there and in its label", () => {
    const work = fixture();
    const next = apply(
      work,
      replace(work, "root", "level-1", "text", "尊重需求", "被尊重"),
    );
    expect(module(next, "level-1")).toMatchObject({
      label: "被尊重",
      data: { label: "被尊重", tip: "自尊与认可" },
    });
    expect(next.drawings).toEqual(work.drawings);
    // One line of several is replaced on its own.
    work.scenes.root.modules[0].data.tip = "发挥\n潜能";
    expect(
      module(
        apply(work, replace(work, "root", "level-0", "text", "潜能", "天赋")),
        "level-0",
      ).data.tip,
    ).toBe("发挥\n天赋");
  });

  it("renames a place and every reference to it by that name, and only then", () => {
    const work = fixture();
    work.scenes.root.modules[0].data = {
      places: [
        { name: "陈家祠", lon: 113.24, lat: 23.13 },
        { name: "沙面", lon: 113.24, lat: 23.11 },
      ],
      routes: [{ points: ["陈家祠", "沙面"], label: "陈家祠" }],
      highlights: [{ river: "珠江", from: "陈家祠", to: "沙面" }],
    };
    const next = apply(
      work,
      replace(work, "root", "level-0", "text", "陈家祠", "陈氏书院"),
    );
    expect(module(next, "level-0").data).toEqual({
      places: [
        { name: "陈氏书院", lon: 113.24, lat: 23.13 },
        { name: "沙面", lon: 113.24, lat: 23.11 },
      ],
      routes: [{ points: ["陈氏书院", "沙面"], label: "陈氏书院" }],
      highlights: [{ river: "珠江", from: "陈氏书院", to: "沙面" }],
    });
    // Words that are no entry's name change where they were pointed at, and only there.
    work.scenes.root.modules[0].data = { title: "基础", note: "基础" };
    expect(
      module(
        apply(work, replace(work, "root", "level-0", "text", "基础", "根基")),
        "level-0",
      ).data,
    ).toEqual({ title: "根基", note: "基础" });
  });

  it("retypes words written once in a drawing's code, escaped for where they stand", () => {
    const work = fixture();
    const next = apply(
      work,
      replace(work, "root", "heading", "text", "马斯洛需求理论", 'A & "B"'),
    );
    expect(next.drawings.title.source).toContain(
      '>A &amp; \\"B\\"</text><text',
    );
    expect(module(next, "heading").drawingId).toBe("title");
    // Markup typed into HTML is written as text, not as markup.
    const buttons = apply(
      work,
      replace(work, "root", "control", "text", "强调基础", "Tom's <b>"),
    );
    expect(buttons.drawings.control.source).toContain(
      ">Tom\\'s &lt;b&gt;</button>",
    );
  });

  it("copies a shared drawing for the one module whose words change, and declines what it cannot find", () => {
    const work = fixture();
    work.drawings.tier.source += "\n// 生理需求 are the base";
    // Words the data holds win over the same words in code.
    expect(
      replace(work, "root", "level-4", "text", "生理需求", "生存")!.drawings,
    ).toBeUndefined();
    work.drawings.tier.source = work.drawings.tier.source
      .replace(
        'fill="#24312e" font-weight',
        'fill="#24312e" data-x="层" font-weight',
      )
      .replace("'+d.tip+'", "层级说明");
    const next = apply(
      work,
      replace(work, "root", "level-2", "text", "层级说明", "说明"),
    );
    expect(module(next, "level-2").drawingId).toBe("tier-2");
    expect(next.drawings["tier-2"].source).toContain(">说明<");
    expect(next.drawings.tier).toEqual(work.drawings.tier);
    expect(module(next, "level-3").drawingId).toBe("tier");
    // Words that occur twice, or nowhere, are left for the author.
    expect(replace(work, "root", "level-2", "text", "层", "楼")).toBeNull();
    expect(
      replace(work, "root", "level-2", "text", "没有的字", "x"),
    ).toBeNull();
    expect(replace(work, "root", "level-2", "text", "说明", "说明")).toBeNull();
  });

  it("swaps a picture named in the data or quoted once in the code, taking the new one in", () => {
    const work = fixture();
    work.scenes.root.modules[0].data.material = "apple";
    const inData = replace(
      work,
      "root",
      "level-0",
      "picture",
      "apple",
      "pear",
    )!;
    expect(inData.materials).toEqual(["pear"]);
    expect(module(apply(work, inData), "level-0").data.material).toBe("pear");
    work.drawings.title.source = `return api.material('sun')`;
    const inCode = replace(work, "root", "heading", "picture", "sun", "moon")!;
    expect(inCode.drawings![0].source).toBe(`return api.material('moon')`);
  });

  it("takes modules out with the links and checks that need them", () => {
    const work = fixture();
    work.scenes.root.links.push({
      id: "line",
      drawingId: "connector",
      from: { moduleId: "level-0", anchor: "right" },
      to: { moduleId: "level-4", anchor: "right" },
      data: {},
    });
    const next = apply(work, removeParts(work, "root", ["level-4", "control"]));
    expect(scene(next).modules.map((m) => m.id)).toEqual([
      "level-0",
      "level-1",
      "level-2",
      "level-3",
      "heading",
    ]);
    expect(scene(next).links).toEqual([]);
    expect(scene(next).checks).toEqual([]);
  });

  it("duplicates modules on top, in a group of their own, with the links between them", () => {
    const work = fixture();
    work.scenes.root.links.push({
      id: "line",
      drawingId: "connector",
      from: { moduleId: "level-0", anchor: "right" },
      to: { moduleId: "level-1", anchor: "right" },
      data: {},
    });
    const { edit, ids } = duplicate(work, "root", ["level-1", "level-0"], 20);
    const next = apply(work, edit);
    expect(ids).toEqual(["level-5", "level-6"]);
    const [a, b] = ids.map((id) => module(next, id));
    expect(a).toMatchObject({
      label: "自我实现",
      group: "pyramid-2",
      bounds: { x: 320, y: 130 },
      target: { kind: "detail", id: "explanation" },
    });
    expect(b.group).toBe("pyramid-2");
    expect(scene(next).modules.slice(-2)).toEqual([a, b]);
    expect(scene(next).links.at(-1)).toMatchObject({
      id: "line-2",
      from: { moduleId: a.id },
      to: { moduleId: b.id },
    });
    expect(module(next, "level-0")).toEqual(module(work, "level-0"));
  });

  it("restacks, moves, changes values and adds words and pictures", () => {
    const work = fixture();
    expect(
      scene(apply(work, arrange(work, "root", ["control", "level-0"], "back")))
        .modules.slice(0, 2)
        .map((m) => m.id),
    ).toEqual(["level-0", "control"]);
    expect(
      scene(
        apply(work, arrange(work, "root", ["level-0"], "front")),
      ).modules.at(-1)!.id,
    ).toBe("level-0");
    const moved = apply(
      work,
      moveParts(work, "root", [
        { id: "heading", bounds: { x: 1, y: 2, width: 3, height: 4 } },
      ]),
    );
    expect(module(moved, "heading").bounds).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    const recoloured = apply(
      work,
      setData(work, "root", "level-0", { color: "#000000", tip: undefined }),
    );
    expect(module(recoloured, "level-0").data).toEqual({
      label: "自我实现",
      color: "#000000",
    });
    work.materials.label = label;
    const words = add(
      work,
      "root",
      { x: 100, y: 100 },
      { kind: "text", text: "你好", size: 20 },
    );
    const withWords = apply(work, words.edit);
    expect(module(withWords, words.id)).toEqual({
      id: "text",
      label: "你好",
      drawingId: "label",
      data: { text: "你好", size: 20 },
      bounds: { x: 28, y: 78, width: 144, height: 44 },
      anchors: {},
      group: null,
      target: null,
    });
    const picture = add(
      work,
      "root",
      { x: 0, y: 0 },
      {
        kind: "picture",
        material: "apple",
        name: "苹果",
        aspect: 0.5,
        width: 200,
      },
    );
    expect(picture.edit.materials).toEqual(["apple"]);
    // A work whose own drawing is called "picture" takes the library's under another id.
    work.drawings.picture = { ...work.drawings.title, id: "picture" };
    expect(shadowed(work, "picture")).toBe(true);
    const copy = {
      name: "图片",
      source: "return api.material(api.data.material)",
    };
    const own = add(
      work,
      "root",
      { x: 0, y: 0 },
      {
        kind: "picture",
        material: "apple",
        name: "苹果",
        aspect: 1,
        width: 10,
      },
      copy,
    ).edit;
    expect(own.drawings).toEqual([{ id: "picture-2", ...copy }]);
    expect(own.scenes![0].modules.at(-1)).toMatchObject({
      id: "picture",
      drawingId: "picture-2",
    });
    expect(picture.edit.scenes![0].modules.at(-1)).toMatchObject({
      drawingId: "picture",
      data: { material: "apple" },
      bounds: { x: -100, y: -50, width: 200, height: 100 },
    });
  });

  it("says what changed between two revisions", () => {
    const before = fixture();
    before.materials.label = label;
    let after = apply(
      before,
      replace(before, "root", "level-0", "text", "自我实现", "成长"),
    );
    after = apply(
      after,
      moveParts(after, "root", [
        { id: "heading", bounds: { x: 0, y: 0, width: 640, height: 70 } },
      ]),
    );
    after = apply(after, removeParts(after, "root", ["control"]));
    after = apply(
      after,
      add(after, "root", { x: 0, y: 0 }, { kind: "text", text: "新", size: 16 })
        .edit,
    );
    after.style = { ...after.style, accent: "#000000" };
    expect(changesBetween(before, after)).toEqual({
      scenes: [
        {
          id: "root",
          added: ["text"],
          removed: ["control"],
          changed: ["level-0"],
          moved: ["heading"],
          restacked: false,
          retitled: false,
        },
      ],
      addedScenes: [],
      removedScenes: [],
      drawings: { added: [], changed: [], removed: [] },
      interactions: { added: [], changed: [], removed: [] },
      details: { added: [], changed: [], removed: [] },
      style: true,
    });
    const none = { added: [], changed: [], removed: [] };
    expect(changesBetween(before, before)).toEqual({
      scenes: [],
      addedScenes: [],
      removedScenes: [],
      drawings: none,
      interactions: none,
      details: none,
      style: false,
    });
    // Scenes, drawings, details and interactions changed by hand are reported too.
    let more = apply(before, addScene(before, "root", "more").edit);
    more = apply(more, removeScene(more, "child"));
    more = apply(more, renameScene(more, "root", "新标题"));
    more = apply(more, setDetail(more, { id: "explanation", title: "解释", html: "<p>新</p>" }).edit);
    more = apply(more, setInteraction(more, "root", "api.on('control','explore',()=>{});"));
    more = apply(more, setDrawing(more, { ...more.drawings.title, source: "return api.svg('<svg/>')" }));
    const report = changesBetween(before, more);
    expect(report.addedScenes).toEqual(["more"]);
    expect(report.removedScenes).toEqual(["child"]);
    expect(report.scenes).toEqual([
      expect.objectContaining({ id: "root", retitled: true, changed: ["heading"] }),
    ]);
    expect(report.details.changed).toEqual(["explanation"]);
    expect(report.interactions.changed).toEqual(["explore"]);
    expect(report.drawings.changed).toEqual(["title"]);
  });
});

describe("hand edits reach what the author writes", () => {
  it("names, groups and ungroups modules, and selects a group whole when grouped again", () => {
    const work = fixture();
    const named = apply(work, rename(work, "root", "heading", "大标题"));
    expect(module(named, "heading").label).toBe("大标题");
    const g = group(work, "root", ["heading", "level-0"]);
    const grouped = apply(work, g.edit);
    // The whole pyramid joins, so no member of it is left behind on its own.
    expect(
      scene(grouped).modules.filter((m) => m.group === g.group).map((m) => m.id),
    ).toEqual(["level-0", "level-1", "level-2", "level-3", "level-4", "heading"]);
    const apart = apply(grouped, ungroup(grouped, "root", ["level-3"]));
    expect(scene(apart).modules.every((m) => m.group === null)).toBe(true);
  });

  it("steps modules forward and back past what they overlap, and restacks them by the layers list", () => {
    const work = fixture();
    const ids = (w: Work) => scene(w).modules.map((m) => m.id);
    // level-0 overlaps level-1 below it in the picture; a step forward passes it.
    expect(ids(apply(work, arrange(work, "root", ["level-0"], "forward"))).slice(0, 2)).toEqual([
      "level-1",
      "level-0",
    ]);
    expect(ids(apply(work, arrange(work, "root", ["level-1"], "backward"))).slice(0, 2)).toEqual([
      "level-1",
      "level-0",
    ]);
    // The topmost cannot go further forward.
    expect(ids(apply(work, arrange(work, "root", ["control"], "forward")))).toEqual(ids(work));
    expect(ids(apply(work, restack(work, "root", ["control"], "level-0"))).slice(0, 2)).toEqual([
      "control",
      "level-0",
    ]);
    expect(ids(apply(work, restack(work, "root", ["level-0"], null))).at(-1)).toBe("level-0");
  });

  it("aligns, spreads, resizes and snaps", () => {
    const work = fixture();
    const left = apply(work, align(work, "root", ["level-0", "level-4"], "left"));
    expect(module(left, "level-0").bounds.x).toBe(100);
    const middle = apply(work, align(work, "root", ["level-0", "level-1"], "center"));
    expect(module(middle, "level-0").bounds.x + 120).toBe(
      module(middle, "level-1").bounds.x + 170,
    );
    const spread = apply(work, distribute(work, "root", ["level-0", "level-1", "heading"], "y"));
    const [a, b, c] = ["heading", "level-0", "level-1"].map((id) => module(spread, id).bounds);
    expect(b.y - (a.y + a.height)).toBeCloseTo(c.y - (b.y + b.height));
    const box = { x: 0, y: 0, width: 100, height: 50 };
    expect(resized(box, "se", 20, 10)).toEqual({ x: 0, y: 0, width: 120, height: 60 });
    expect(resized(box, "nw", 20, 10)).toEqual({ x: 20, y: 10, width: 80, height: 40 });
    expect(resized(box, "e", 100, 0, { keep: true })).toEqual({ x: 0, y: -25, width: 200, height: 100 });
    expect(resized(box, "e", 20, 0, { centred: true })).toEqual({ x: -20, y: 0, width: 140, height: 50 });
    expect(resized(box, "w", 500, 0)).toMatchObject({ width: 8, x: 92 });
    // Kept proportions stay kept at the smallest size: the shorter side stops at the minimum.
    expect(resized(box, "se", -500, -500, { keep: true, min: 10 })).toEqual({
      x: 0,
      y: 0,
      width: 20,
      height: 10,
    });
    expect(scaled({ x: 50, y: 25, width: 50, height: 25 }, box, { x: 0, y: 0, width: 200, height: 100 })).toEqual({
      x: 100,
      y: 50,
      width: 100,
      height: 50,
    });
    const s = snap({ x: 103, y: 300, width: 40, height: 40 }, [{ x: 0, y: 0, width: 100, height: 100 }], 5);
    expect(s.dx).toBe(-3);
    expect(s.dy).toBe(0);
    expect(s.guides).toEqual([{ axis: "x", at: 100, from: 0, to: 340 }]);
  });

  it("links one module's side to another's through anchors, drawn like the scene's links", () => {
    const work = fixture();
    expect(linkLook(work, "root")).toBeNull();
    const first = connect(
      work,
      "root",
      { moduleId: "heading", side: "bottom" },
      { moduleId: "level-0", side: "top" },
      { drawingId: "connector", data: { label: "看", color: "#000" } },
    );
    const linked = apply(work, first.edit);
    const link = scene(linked).links[0];
    expect(link).toMatchObject({
      id: "heading-to-level-0",
      drawingId: "connector",
      from: { moduleId: "heading", anchor: "bottom" },
      to: { moduleId: "level-0", anchor: "top" },
    });
    expect(module(linked, "heading").anchors.bottom).toEqual({ x: 0.5, y: 1 });
    // An anchor already at that point is used rather than doubled.
    const again = connect(linked, "root", { moduleId: "level-1", side: "left" }, { moduleId: "level-2", side: "right" }, linkLook(linked, "root")!);
    const twice = apply(linked, again.edit);
    expect(scene(twice).links[1]).toMatchObject({
      from: { anchor: "left" },
      to: { anchor: "right" },
      data: { color: "#000" },
    });
    expect(Object.keys(module(twice, "level-1").anchors)).toEqual(["left", "right"]);
    const moved = apply(twice, reattach(twice, "root", link.id, "to", "left"));
    expect(scene(moved).links[0].to.anchor).toBe("left");
    const turned = apply(moved, reverse(moved, "root", link.id));
    expect(scene(turned).links[0].from.moduleId).toBe("level-0");
    expect(() =>
      connect(work, "root", { moduleId: "heading", side: "top" }, { moduleId: "heading", side: "left" }, { drawingId: "connector", data: {} }),
    ).toThrow();
    // A library drawing the work does not have yet is taken in.
    expect(
      connect(work, "root", { moduleId: "heading", side: "top" }, { moduleId: "level-0", side: "top" }, { drawingId: "arrow", data: {} }).edit.materials,
    ).toEqual(["arrow"]);
  });

  it("points modules into new scenes and details, and takes scenes and details out with what leads to them", () => {
    const work = fixture();
    const s = addScene(work, "root", "Detail View");
    expect(s.id).toBe("detail-view");
    let next = apply(work, s.edit);
    next = apply(next, setTarget(next, "root", ["heading"], { kind: "scene", id: s.id }));
    expect(module(next, "heading").target).toEqual({ kind: "scene", id: "detail-view" });
    const nested = addScene(next, s.id, "deeper");
    next = apply(next, nested.edit);
    next = apply(next, removeScene(next, s.id));
    expect(Object.keys(next.scenes).sort()).toEqual(["child", "root"]);
    expect(module(next, "heading").target).toBeNull();
    expect(() => removeScene(work, "root")).toThrow();
    const d = setDetail(next, { title: "More", html: "<p>x</p>" });
    next = apply(next, d.edit);
    expect(next.details.more.html).toBe("<p>x</p>");
    next = apply(next, removeDetail(next, "explanation"));
    expect(next.details.explanation).toBeUndefined();
    expect(module(next, "level-0").target).toBeNull();
  });

  it("writes interactions and drawing code only when they parse", () => {
    const work = fixture();
    expect(() => setInteraction(work, "child", "api.on(")).toThrow();
    const scripted = apply(work, setInteraction(work, "child", "api.on('mermaid','x',()=>{})"));
    expect(scripted.scenes.child.interactionId).toBe("child-script");
    const cleared = apply(scripted, setInteraction(scripted, "child", "  "));
    expect(cleared.scenes.child.interactionId).toBeNull();
    expect(setInteraction(scripted, "child", "").remove).toEqual({ interactions: ["child-script"] });
    expect(() => setDrawing(work, { ...work.drawings.title, source: "return (" })).toThrow();
    expect(() => setDrawing(work, { ...work.drawings.title, source: "" })).toThrow();
    const recoded = apply(work, setDrawing(work, { ...work.drawings.title, source: "return api.svg('<svg/>')" }));
    expect(recoded.drawings.title.source).toBe("return api.svg('<svg/>')");
  });

  it("copies a shared drawing for one module, swaps drawings and rewrites a module in full", () => {
    const work = fixture();
    const f = fork(work, "root", ["level-2"], work.drawings.tier, "tier");
    const forked = apply(work, f.edit);
    expect(f.id).toBe("tier-2");
    expect(module(forked, "level-2").drawingId).toBe("tier-2");
    expect(module(forked, "level-1").drawingId).toBe("tier");
    const swapped = useDrawing(work, "root", ["heading"], "label");
    expect(swapped.materials).toEqual(["label"]);
    expect(swapped.scenes![0].modules.find((m) => m.id === "heading")!.drawingId).toBe("label");
    const rewritten = apply(
      work,
      setModule(work, "root", "heading", {
        ...module(work, "heading"),
        id: "ignored",
        label: "新的",
        data: { x: [1, 2] },
      }),
    );
    expect(module(rewritten, "heading")).toMatchObject({ label: "新的", data: { x: [1, 2] } });
    expect(() => setModule(work, "root", "heading", { label: 3 })).toThrow();
  });

  it("leaves lists and records to the data editor", () => {
    const work = fixture();
    const part = { ...module(work, "level-0"), data: { ...module(work, "level-0").data, items: [{ a: 1 }], side: "left" } };
    expect(restOf(work, part)).toEqual(["items", "side"]);
  });

  it("adds a library drawing with the data that shows it", () => {
    const work = fixture();
    const r = add(
      work,
      "root",
      { x: 0, y: 0 },
      { kind: "drawing", material: "bars", name: "柱状图", size: { width: 200, height: 100 }, data: { items: [1] } },
    );
    expect(r.id).toBe("bars");
    expect(r.edit.materials).toEqual(["bars"]);
    expect(r.edit.scenes![0].modules.at(-1)).toMatchObject({
      drawingId: "bars",
      bounds: { x: -100, y: -50, width: 200, height: 100 },
      data: { items: [1] },
    });
  });

  it("copies parts with their links, drawings and materials, and pastes them here or into another work", () => {
    const work = fixture();
    work.scenes.root.links.push({
      id: "l1",
      drawingId: "connector",
      from: { moduleId: "level-0", anchor: "right" },
      to: { moduleId: "level-1", anchor: "right" },
      data: {},
    });
    work.materials.apple = {
      id: "apple",
      kind: "picture",
      name: "苹果",
      role: "object",
      style: null,
      url: "/x.png",
      width: 1,
      height: 1,
      content: { x: 0, y: 0, width: 1, height: 1 },
      anchors: {},
      recolor: false,
      opaque: false,
      status: "ready",
    };
    work.scenes.root.modules[0].data.picture = "apple";
    const clip = copy(work, "root", ["level-0", "level-1"])!;
    expect(clip.links.map((l) => l.id)).toEqual(["l1"]);
    expect(clip.drawings.map((d) => d.id).sort()).toEqual(["connector", "tier"]);
    expect(clip.materials).toEqual(["apple"]);
    expect(copy(work, "root", ["nothing"])).toBeNull();
    // Here: a step off, new ids, a group of their own, the link between the copies.
    const here = paste(work, "root", clip, { offset: 24 });
    const pasted = apply(work, here.edit);
    expect(here.ids).toEqual(["level-5", "level-6"]);
    expect(module(pasted, "level-5").bounds.x).toBe(module(work, "level-0").bounds.x + 24);
    expect(module(pasted, "level-5").group).toBe("pyramid-2");
    expect(scene(pasted).links.at(-1)).toMatchObject({
      from: { moduleId: "level-5" },
      to: { moduleId: "level-6" },
    });
    expect(here.edit.drawings).toBeUndefined();
    // Elsewhere: a drawing under the same id with other code comes in renamed; targets
    // the other work lacks lead nowhere.
    const other = fixture();
    other.id = "other";
    other.drawings.tier = { ...other.drawings.tier, source: "return api.svg('<svg/>')" };
    delete other.details.explanation;
    for (const m of other.scenes.root.modules) m.target = null;
    const there = paste(other, "child", clip, { centre: { x: 0, y: 0 } });
    // The connector is the same code in both works, so it is used as it is.
    expect(there.edit.drawings!.map((d) => d.id)).toEqual(["tier-2"]);
    const into = there.edit.scenes![0].modules.slice(-2);
    expect(into.map((m) => m.drawingId)).toEqual(["tier-2", "tier-2"]);
    expect(into.map((m) => m.target)).toEqual([null, null]);
    expect(there.edit.materials).toEqual(["apple"]);
  });

  it("pastes a library drawing into a work whose own drawing has its id as a drawing of the work's own", () => {
    const work = fixture();
    work.materials.label = label;
    work.scenes.root.modules.push({
      ...module(work, "heading"),
      id: "words",
      drawingId: "label",
      data: { text: "你好", size: 20 },
    });
    const clip = copy(work, "root", ["words"])!;
    expect(clip.libraries!.map((d) => d.id)).toEqual(["label"]);
    expect(clip.materials).toEqual(["label"]);
    // A work whose own drawing is called "label" draws something else under that id.
    const other = fixture();
    other.id = "other";
    other.drawings.label = { ...other.drawings.title, id: "label" };
    const r = paste(other, "root", clip, { labels: { text: "文字" } });
    const pasted = apply(other, r.edit);
    const words = module(pasted, r.ids[0]);
    expect(words.drawingId).toBe("label-2");
    expect(pasted.drawings["label-2"]).toEqual({
      id: "label-2",
      name: "标签",
      params: {
        text: { type: "text", label: "文字" },
        size: { type: "number", min: 8, max: 72, step: 1, label: "size" },
        align: { type: "choice", options: ["start", "center", "end"], label: "align" },
        color: { type: "color", label: "color" },
      },
      source: label.source,
    });
    // The library filled in its defaults; the work's own copy has them in the data.
    expect(words.data).toEqual({ size: 20, align: "center", text: "你好" });
    expect(r.edit.materials).toBeUndefined();
    expect(pasted.drawings.label).toEqual(other.drawings.label);
    // A work without such a drawing uses the library drawing as it is.
    const plain = paste(fixture(), "root", clip, {});
    expect(plain.edit.drawings).toBeUndefined();
    expect(plain.edit.scenes![0].modules.at(-1)).toMatchObject({
      drawingId: "label",
      data: { text: "你好", size: 20 },
    });
    expect(plain.edit.materials).toEqual(["label"]);
  });

  it("takes a style's colours, keeping tokens the style does not have", () => {
    const work = fixture();
    work.style = { ink: "#111", stroke: "2" };
    expect(setStyles(work, { ink: "#222", accent: "#f00" }).style).toEqual({
      ink: "#222",
      stroke: "2",
      accent: "#f00",
    });
  });
});

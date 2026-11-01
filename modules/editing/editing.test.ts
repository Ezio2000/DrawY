import { describe, expect, it } from "vitest";
import { fixture } from "../runtime/fixture.ts";
import { validateWork } from "../workspace/index.ts";
import type { MaterialUse, Work, WorkEdit } from "../contracts/index.ts";
import {
  add,
  arrange,
  changesBetween,
  duplicate,
  fieldsOf,
  moveParts,
  removeParts,
  replace,
  setData,
  shadowed,
} from "./index.ts";

/** The work an edit leaves, checked as the workspace checks every commit. */
function apply(work: Work, edit: WorkEdit | null): Work {
  expect(edit).not.toBeNull();
  expect(edit!.baseRevision).toBe(work.revision);
  const next = structuredClone(work);
  for (const s of edit!.scenes ?? []) next.scenes[s.id] = s;
  for (const d of edit!.drawings ?? []) next.drawings[d.id] = d;
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
        },
      ],
      style: true,
    });
    expect(changesBetween(before, before)).toEqual({
      scenes: [],
      style: false,
    });
  });
});

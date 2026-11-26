import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Material } from "@drawy/materials/schema";
import { linkEnds, scenePlacing } from "../contracts/geometry.ts";
import type { Bounds, Instance, Work } from "../contracts/index.ts";
import { useOf } from "../materials/index.ts";
import { fixture } from "../runtime/fixture.ts";
import { composed } from "./apply.ts";
import {
  applied,
  connect,
  danglingIn,
  dataPatch,
  duplicateItem,
  insertItem,
  itemOf,
  moveItem,
  moveParts,
  removeItem,
  replace,
  retarget,
  setAt,
  trailOf,
} from "./index.ts";

/* The problems found running the editor by hand, each held to what fixing it must do. */

/** A curated drawing as a work holds it, its code read from the seed. */
const curated = (id: string) => {
  const seed = JSON.parse(readFileSync(new URL("../../content/seed/drawings.json", import.meta.url), "utf8")) as Material[];
  const m = seed.find((x) => x.id === id)!;
  return {
    material: useOf({ ...m, source: readFileSync(new URL(`../../content/seed/drawings/${id}.js`, import.meta.url), "utf8") } as Material)!,
    example: (m as { example: Record<string, unknown> }).example,
  };
};
const blank = (): Work => ({ ...fixture(), drawings: {}, scenes: { root: { ...fixture().scenes.root, modules: [], links: [], checks: [] } } });
const box = (id: string, bounds: Bounds, drawingId = "label"): Instance => ({ id, bounds, drawingId, data: {} });

type Sequence = {
  participants: { id: string; label: string; kind?: string }[];
  messages: { id: string; from: string; to: string; label: string; kind?: string }[];
  notes: { id: string; over: string[]; after?: string; text: string }[];
};
const data = (w: Work) => w.scenes.root.modules.find((m) => m.id === "seq")!.data as Sequence;
/** A work with the library's sequence diagram drawn from its example. */
function sequenceWork() {
  const { material, example } = curated("sequence");
  const work = blank();
  work.materials.sequence = material;
  work.scenes.root.modules = [{ ...box("seq", { x: 0, y: 0, width: 640, height: 360 }, "sequence"), data: structuredClone(example) }];
  return work;
}

describe("diagnosis", () => {
  it("problem 1: messages drawn between two lifelines stay at the heights they were drawn at, and follow their participants", () => {
    const work = blank();
    work.materials.label = curated("label").material;
    work.materials.arrow = curated("arrow").material;
    work.scenes.root.modules = [box("a", { x: 0, y: 200, width: 160, height: 60 }), box("b", { x: 400, y: 200, width: 160, height: 60 })];
    const look = { drawingId: "arrow", data: {} };
    // A line pulled down from each box's bottom edge: bound there, free where it was let go.
    let w = work;
    const lifeline = (m: string, x: number) => {
      const made = connect(w, "root", { moduleId: m, at: "bottom" }, { x, y: 600 }, look);
      w = applied(w, made.edit);
      return made.id;
    };
    const la = lifeline("a", 80),
      lb = lifeline("b", 480);
    // Messages drawn from one lifeline to the other, at the heights they were drawn at.
    const share = (y: number) => (y - 260) / (600 - 260);
    const messages = [330, 470].map((y) => {
      const made = connect(w, "root", { linkId: la, along: share(y) }, { linkId: lb, along: share(y) }, look);
      w = applied(w, made.edit);
      return made.id;
    });
    const at = (v: Work, id: string) => linkEnds(v.scenes.root.links.find((l) => l.id === id)!, scenePlacing(v.scenes.root));
    expect(messages.map((id) => at(w, id).from)).toMatchObject([
      { x: 80, y: 330 },
      { x: 80, y: 470 },
    ]);
    // Dragging the first participant takes its lifeline and the messages' ends on it along.
    const moved = applied(w, moveParts(w, "root", [{ id: "a", bounds: { x: 40, y: 230, width: 160, height: 60 } }]));
    expect(at(moved, la)).toMatchObject({ from: { x: 120, y: 290 }, to: { x: 120, y: 630 } });
    expect(messages.map((id) => at(moved, id))).toMatchObject([
      { from: { x: 120, y: 360 }, to: { x: 480, y: 330 } },
      { from: { x: 120, y: 500 }, to: { x: 480, y: 470 } },
    ]);
    // Taking a participant out leaves its lifeline where it was, loose; the messages on it
    // keep to it.
    const gone = applied(moved, { remove: { modules: ["a"] } });
    expect(gone.scenes.root.links.find((l) => l.id === la)).toMatchObject({ from: { x: 120, y: 290 }, to: { x: 120, y: 630 } });
    expect(danglingIn(gone, "root")).toEqual([la]);
    expect(at(gone, messages[0]).from).toEqual({ x: 120, y: 360, side: null });
  });
  it("problem 3A: renaming a participant keeps every message on the participant it was on", () => {
    const work = sequenceWork();
    // Which participant each message runs between, by its place among them.
    const ends = (w: Work) => {
      const d = data(w);
      const place = (ref: string) => d.participants.findIndex((p) => p.id === ref);
      return d.messages.map((m) => [place(m.from), place(m.to)]);
    };
    const before = ends(work);
    // The name is retyped where it is drawn, at the path the drawing marks it with, or
    // found in the data by its words: either way the messages keep to their ids.
    const marked = applied(work, setAt(work, "root", "seq", "participants.#server.label", "API 网关")!);
    expect(data(marked).participants[1].label).toBe("API 网关");
    expect(ends(marked)).toEqual(before);
    const found = applied(work, replace(work, "root", "seq", "text", "服务器", "API 网关")!);
    expect(ends(found)).toEqual(before);
  });
});

describe("items of a drawing's data", () => {
  it("changes, appends and deletes list items by id, and composes such changes onto a list given whole", () => {
    const work = sequenceWork();
    const w = applied(work, { modules: [{ id: "seq", data: { messages: { "#m2": { label: "查用户" }, "#m9": { from: "db", to: "browser", label: "推送" }, "#m5": null } } }] });
    expect(data(w).messages.map((m) => [m.id, m.label])).toEqual([
      ["m1", "登录请求"],
      ["m2", "查用户"],
      ["m3", "用户记录"],
      ["m4", "校验密码"],
      ["m9", "推送"],
    ]);
    const whole = { modules: [{ id: "seq", data: { messages: data(work).messages.slice(0, 2) } }] };
    const both = composed(whole, { modules: [{ id: "seq", data: { messages: { "#m1": { label: "一" } } } }] });
    expect((both as { modules: { data: { messages: { label: string }[] } }[] }).modules[0].data.messages.map((m) => m.label)).toEqual(["一", "查询用户"]);
  });
  it("inserts, moves, copies and takes out items with what referred to them, as the smallest patch", () => {
    const work = sequenceWork();
    // A new message between the first two, made as the schema makes one, after Enter's rule.
    const made = insertItem(work, "root", "seq", "messages", 1, { from: "browser", to: "server" });
    const w1 = applied(work, made.edit);
    expect(made.path).toBe("messages.#m6");
    expect(data(w1).messages[1]).toEqual({ id: "m6", label: "", kind: "sync", from: "browser", to: "server" });
    // Moving gives the list whole, as its order is what changes.
    const moved = moveItem(w1, "root", "seq", "messages", "m6", 4)!;
    expect(data(applied(w1, moved)).messages.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4", "m6", "m5"]);
    const copied = duplicateItem(work, "root", "seq", "messages", "m4");
    expect(data(applied(work, copied.edit)).messages[4]).toMatchObject({ label: "校验密码", from: "server" });
    // Taking out the database takes the two messages to and from it, by id.
    const gone = removeItem(work, "root", "seq", "participants", "db");
    expect(gone.along).toBe(2);
    expect(gone.edit.modules![0].data).toEqual({ participants: { "#db": null }, messages: { "#m2": null, "#m3": null } });
    // A message's end dropped on another lifeline refers to that participant.
    const turned = applied(work, retarget(work, "root", "seq", "messages.#m1.to", "db")!);
    expect(data(turned).messages[0].to).toBe("db");
    expect(() => retarget(work, "root", "seq", "messages.#m1.to", "nobody")).toThrow(/没有 nobody/);
  });
  it("names the way into a part, and patches only what changed", () => {
    const work = sequenceWork();
    const m = work.scenes.root.modules[0];
    expect(trailOf(work, m, "messages.#m3.label")).toEqual([
      { key: "messages", label: { zh: "消息", en: "Messages" }, place: 3 },
      { key: "label", label: { zh: "文字", en: "Words" } },
    ]);
    expect(itemOf("messages.#m3")).toEqual({ list: "messages", item: "m3" });
    expect(itemOf("branches.#b1.children.2")).toEqual({ list: "branches.#b1.children", item: 2 });
    expect(dataPatch({ a: [{ id: "x", v: 1 }, { id: "y", v: 2 }], b: 1 }, { a: [{ id: "x", v: 3 }, { id: "y", v: 2 }] })).toEqual({ a: { "#x": { v: 3 } }, b: null });
  });
});

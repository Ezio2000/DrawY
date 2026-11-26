import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Material } from "@drawy/materials/schema";
import { linkEnds } from "../contracts/geometry.ts";
import type { Bounds, Instance, Work } from "../contracts/index.ts";
import { useOf } from "../materials/index.ts";
import { fixture } from "../runtime/fixture.ts";
import { applied, connect, replace } from "./index.ts";

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

describe("diagnosis", () => {
  it.fails("problem 1: messages drawn between two lifelines stay at the heights they were drawn at", () => {
    const work = blank();
    work.materials.label = curated("label").material;
    work.materials.arrow = curated("arrow").material;
    work.scenes.root.modules = [
      box("a", { x: 0, y: 200, width: 160, height: 60 }),
      box("b", { x: 400, y: 200, width: 160, height: 60 }),
      // The lines pulled down from each box, as the arrow tool leaves them today.
      box("a-life", { x: 60, y: 260, width: 40, height: 340 }, "sketch-line"),
      box("b-life", { x: 460, y: 260, width: 40, height: 340 }, "sketch-line"),
    ];
    let w = work;
    const ids: string[] = [];
    for (const _y of [330, 470]) {
      const { edit, id } = connect(w, "root", { moduleId: "a-life" }, { moduleId: "b-life" }, { drawingId: "arrow", data: {} });
      w = applied(w, edit);
      ids.push(id);
    }
    const boxes = new Map(w.scenes.root.modules.map((m) => [m.id, m.bounds]));
    const heights = ids.map((id) => linkEnds(w.scenes.root.links.find((l) => l.id === id)!, (m) => boxes.get(m)!).from.y);
    expect(heights).toEqual([330, 470]);
  });
  it.fails("problem 3A: renaming a participant keeps every message on the participant it was on", () => {
    const { material, example } = curated("sequence");
    const work = blank();
    work.materials.sequence = material;
    work.scenes.root.modules = [{ ...box("seq", { x: 0, y: 0, width: 640, height: 320 }, "sequence"), data: structuredClone(example) }];
    // Which participant each message runs between, by its place among them.
    const ends = (w: Work) => {
      const d = w.scenes.root.modules[0].data as { actors?: unknown[]; participants?: { id: string; label: string }[]; messages: { from: string; to: string }[] };
      const people = (d.participants ?? (d.actors ?? []).map((a) => (typeof a === "string" ? { id: a, label: a } : a))) as { id?: string; label: string }[];
      const place = (ref: string) => people.findIndex((p) => p.id === ref || p.label === ref);
      return d.messages.map((m) => [place(m.from), place(m.to)]);
    };
    const before = ends(work);
    const edit = replace(work, "root", "seq", "text", "服务器", "API 网关");
    const after = ends(applied(work, edit!));
    expect(after).toEqual(before);
  });
});

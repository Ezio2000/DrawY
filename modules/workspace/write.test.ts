import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveLibrary } from "@drawy/materials/testing";
import { EditRejected, type Problem, type Work } from "../contracts/index.ts";
import { linkEnds } from "../contracts/geometry.ts";
import { register } from "../identity/index.ts";
import { library as client } from "../materials/index.ts";
import { fixture } from "../runtime/fixture.ts";
import { Storage } from "../storage/index.ts";
import { upgradeWork, type OldWork } from "../storage/upgrade.ts";
import { composed } from "../editing/index.ts";
import { createWork, writeWork } from "./index.ts";
import { chestRevision4, chestFailedWrite, chestCorrectWrite, redisFailedWrite, redisCorrections, redisBase } from "./write.fixtures.ts";

/* The commit as a whole, on the writes that failed in real runs (the Redis and chest pain
 * figures of docs/cost-report): what they said, as they said it, and what the same intent
 * costs now. */

let library: ReturnType<typeof serveLibrary>;
let db: Storage, dir: string;
beforeEach(() => {
  library = serveLibrary(client.base);
  dir = mkdtempSync(join(tmpdir(), "drawy-write-"));
  db = new Storage(dir);
});
afterEach(() => {
  library.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
const cause = { kind: "run" as const, runId: "r", prompt: "p" };
const storeWith = (work: Work) => {
  const store = db.scoped(register(db, "author", "abcdef").id);
  store.commit({ ...work, revision: 0 }, 0, { kind: "edit" });
  return store;
};
const refusal = async (fn: () => Promise<unknown>): Promise<Problem[]> => {
  try {
    await fn();
  } catch (e) {
    if (e instanceof EditRejected) return e.problems;
    throw e;
  }
  throw Error("was not refused");
};

describe("a write as a whole", () => {
  it("reports every problem at once, without blaming what depends on one", async () => {
    const work = fixture();
    const store = storeWith(work);
    const found = await refusal(() =>
      writeWork(
        store,
        work.id,
        {
          modules: [
            { id: "no-size", data: {} },
            { id: "y", bounds: [0, 0, 1, 1], drawingId: "nope" },
            { id: "z", bounds: [0, 0, 1, 1], drawingId: "tier", target: { kind: "detail", id: "lost" } },
          ],
          links: [
            { id: "a", from: "heading", to: "ghost" },
            { id: "b", from: "heading", to: "no-size" },
          ],
          drawings: [
            { id: "tier", edits: [{ find: "没有这段", replace: "x" }] },
            { id: "bad", source: "return (" },
          ],
        },
        { cause, scene: "root" },
      ),
    );
    expect(found.map((p) => p.at).sort()).toEqual(
      [
        "modules.no-size",
        "drawings.tier.edits.0",
        "modules.y.drawingId",
        "modules.z.target",
        "links.a.to",
        "drawings.bad.source",
      ].sort(),
    );
    expect(store.work(work.id).revision).toBe(1);
  });
  it("catches a picture and a called material that do not exist before anything is drawn", async () => {
    const work = fixture();
    const store = storeWith(work);
    const found = await refusal(() =>
      writeWork(
        store,
        work.id,
        {
          modules: [{ id: "p", bounds: [0, 0, 10, 10], drawingId: "picture", data: { material: "no-such-picture" } }],
          drawings: [{ id: "uses", source: 'return api.material("no-such-call")' }],
        },
        { cause },
      ),
    );
    expect(found.map((p) => p.at)).toEqual(["materials", "modules.p.data.material"]);
    expect(found[0].problem).toContain("no-such-call");
    expect(found[0].problem).toContain("画法 uses");
  });
  it("copies a library drawing into the work to change it", async () => {
    const work = fixture();
    const store = storeWith(work);
    const { work: saved } = await writeWork(
      store,
      work.id,
      {
        drawings: [{ id: "my-node", from: "node", defaults: { size: 30 } }],
        modules: [{ id: "n", bounds: [0, 0, 100, 60], drawingId: "my-node", data: { title: "我的" } }],
      },
      { cause },
    );
    expect(saved.drawings["my-node"].source).toContain("api.data");
    expect(saved.drawings["my-node"].defaults).toMatchObject({ size: 30 });
    expect(saved.scenes.root.modules.at(-1)!.drawingId).toBe("my-node");
  });
});

describe("the Redis figure's first write", () => {
  it("was refused whole for four anchors never declared; said the same way now it is told at once", async () => {
    const store = storeWith(upgradeWork(redisBase() as unknown as OldWork));
    const id = store.works()[0].id;
    const found = await refusal(() =>
      writeWork(store, id, redisFailedWrite(), { cause, scene: "root" }),
    );
    // The old form names anchors; every end that does is told apart, not one vague message.
    expect(found.filter((p) => p.at.startsWith("links.")).map((p) => p.at)).toEqual([
      "links.l-a1.from",
      "links.l-a1.to",
      "links.l-b1.from",
      "links.l-b1.to",
      "links.l-a3.from",
      "links.l-a3.to",
      "links.l-b3.from",
      "links.l-b3.to",
      "links.l-fa.from",
      "links.l-fa.to",
      "links.l-fb.from",
      "links.l-fb.to",
    ]);
  });
  it("saves first time when each end says where it meets its module, with nothing declared", async () => {
    const store = storeWith(upgradeWork(redisBase() as unknown as OldWork));
    const id = store.works()[0].id;
    const first = redisFailedWrite();
    const size = JSON.stringify(first).length;
    const said = { ...first, links: first.links.map(redisCorrections) };
    const { work } = await writeWork(store, id, said, { cause, scene: "root" });
    const scene = work.scenes.root;
    expect(scene.modules).toHaveLength(first.modules.length);
    expect(scene.links).toHaveLength(first.links.length);
    const box = (m: string) => scene.modules.find((x) => x.id === m)!.bounds;
    const end = (l: string) => linkEnds(scene.links.find((x) => x.id === l)!, box);
    // Where the model's own second write put them: 0.108 along the top of the stock bar.
    expect(end("l-a1").from).toMatchObject({ x: 180 + 0.108 * 740, y: 340, side: "top" });
    expect(end("l-fb").from).toMatchObject({ x: 600 + 0.2 * 800, y: 886, side: "bottom" });
    // Nothing was written twice: the save costs what the first draft cost, not two drafts.
    expect(JSON.stringify(said).length).toBeLessThan(size);
  });
  it("is corrected by the links alone when one is wrong, as one revision", async () => {
    const store = storeWith(upgradeWork(redisBase() as unknown as OldWork));
    const id = store.works()[0].id;
    const first = redisFailedWrite();
    const held = { ...first, links: first.links.map(redisCorrections).map((l: any, i: number) => (i ? l : { ...l, from: "seg-one" })) };
    const found = await refusal(() => writeWork(store, id, held, { cause, scene: "root" }));
    expect(found).toEqual([{ at: "links.l-a1.from", problem: expect.stringContaining("seg-one") }]);
    expect(found[0].problem).toContain("seg1");
    const fix = { links: [{ id: "l-a1", from: { moduleId: "seg1", at: [0.108, 0] } }] };
    const { work } = await writeWork(store, id, composed(held, fix), { cause, scene: "root" });
    expect(work.revision).toBe(2);
    // The correction is a sliver of the write it finishes.
    expect(JSON.stringify(fix).length * 40).toBeLessThan(JSON.stringify(held).length);
  });
});

describe("the chest pain figure's fourth write", () => {
  it("broke every other link when it added one anchor; now one link's end changes alone", async () => {
    const before = upgradeWork(chestRevision4() as unknown as OldWork);
    const store = storeWith(before);
    const id = store.works()[0].id;
    // What the model sent then, read now: the anchors field is not part of a module.
    const found = await refusal(() => writeWork(store, id, chestFailedWrite(), { cause }));
    expect(found.map((p) => p.at).sort()).toEqual(["links.l-cath", "links.l-cath.from", "modules.ecg"]);
    const edit = chestCorrectWrite();
    const { work } = await writeWork(store, id, edit, { cause });
    const links = (w: Work) => w.scenes.root.links;
    const changed = links(work).filter((l, i) => JSON.stringify(l) !== JSON.stringify(links(before)[i]));
    expect(changed.map((l) => l.id)).toEqual(["l-cath"]);
    expect(changed[0].from).toEqual({ moduleId: "ecg", at: [0.72, 0.04] });
    expect(changed[0].data.bend).toBe(-0.08);
    // No module changed, so no other link that meets the ECG module can lose its place.
    expect(work.scenes.root.modules).toEqual(before.scenes.root.modules);
    expect(links(before).filter((l) => l.from.moduleId === "ecg" || l.to.moduleId === "ecg").length).toBeGreaterThan(1);
  });
});

describe("a blank canvas", () => {
  const text = { id: "words", bounds: [40, 40, 200, 60] as [number, number, number, number], drawingId: "label", data: { text: "手写" } };
  it("takes a hand edit before any brief", async () => {
    const store = db.scoped(register(db, "hand", "abcdef").id);
    const blank = createWork(store, "未命名画布");
    const { work } = await writeWork(store, blank.id, { modules: [text] }, { cause: { kind: "edit" } });
    expect(work.brief).toBeNull();
    expect(work.scenes.root.modules.map((m) => m.id)).toEqual(["words"]);
  });
  it("still asks the author for a brief before it draws", async () => {
    const store = db.scoped(register(db, "hand2", "abcdef").id);
    const blank = createWork(store, "未命名画布");
    await expect(writeWork(store, blank.id, { modules: [text] }, { cause })).rejects.toThrow("set_brief");
  });
});

describe("a figure of blocks and lines", () => {
  it("is written without coordinates: an arrangement places it and plain bounds are saved", async () => {
    const store = db.scoped(register(db, "author", "abcdef").id);
    const work = createWork(store, "退款流程");
    const { work: saved, added } = await writeWork(
      store,
      work.id,
      {
        style: { route: "elbow", flow: "down" },
        arrange: [{ layout: "flow", frames: { backend: ["refund", "ledger"] } }],
        modules: [
          { id: "backend", drawingId: "frame", data: { title: "财务" } },
          { id: "ask", drawingId: "node", data: { title: "用户申请退款", shape: "pill" } },
          { id: "review", drawingId: "node", data: { title: "客服审核", shape: "diamond" } },
          { id: "refund", drawingId: "node", data: { title: "财务退款" } },
          { id: "ledger", drawingId: "entity", data: { name: "refund", rows: [{ name: "id", type: "bigint", key: "pk" }, { name: "amount", type: "decimal" }] } },
        ],
        links: [
          { from: "ask", to: "review" },
          { from: "review", to: "refund", data: { label: "通过" } },
          { from: "refund", to: "ledger", data: { head: "zero-many", tail: "only-one" } },
        ],
      },
      { cause: { kind: "edit" } },
    );
    // The library drawings it names are taken first, so each block is sized by its kind.
    expect(added).toEqual(expect.arrayContaining(["arrow", "entity", "frame", "node"]));
    const at = Object.fromEntries(saved.scenes.root.modules.map((m) => [m.id, m.bounds]));
    expect(at.ask.y + at.ask.height).toBeLessThan(at.review.y);
    expect(at.review.y + at.review.height).toBeLessThan(at.refund.y);
    expect(at.ledger.height).toBeGreaterThan(70);
    expect(at.review.width).not.toBe(at.ask.width);
    for (const id of ["refund", "ledger"]) {
      expect(at.backend.x).toBeLessThan(at[id].x);
      expect(at.backend.y).toBeLessThan(at[id].y);
      expect(at.backend.x + at.backend.width).toBeGreaterThan(at[id].x + at[id].width);
      expect(at.backend.y + at.backend.height).toBeGreaterThan(at[id].y + at[id].height);
    }
    // Links are known by their ends; nothing of the arrangement is kept in the work.
    expect(saved.scenes.root.links.map((l) => l.id)).toEqual(["ask-review", "review-refund", "refund-ledger"]);
    expect(JSON.stringify(saved)).not.toContain("arrange");
    // Changed for every block at once, and placed again where they stood.
    const { work: again } = await writeWork(
      store,
      work.id,
      {
        each: [{ drawingId: "node", data: { size: 24 } }],
        arrange: [{ modules: "all", fit: true, frames: { backend: ["refund", "ledger"] } }],
      },
      { cause: { kind: "edit" } },
    );
    const now = Object.fromEntries(again.scenes.root.modules.map((m) => [m.id, m]));
    expect(now.ask.data.size).toBe(24);
    expect(now.ledger.data.size).toBeUndefined();
    expect(now.ask.bounds.height).toBeGreaterThan(at.ask.height);
  });

  it("refuses a new module that is given no place, and says an arrangement would give it one", async () => {
    const store = db.scoped(register(db, "author", "abcdef").id);
    const work = createWork(store, "空");
    const found = await refusal(() =>
      writeWork(
        store,
        work.id,
        { arrange: [{ modules: ["a"] }], modules: [{ id: "a", drawingId: "node", data: { title: "甲" } }, { id: "b", drawingId: "node", data: { title: "乙" } }] },
        { cause: { kind: "edit" } },
      ),
    );
    expect(found.map((p) => p.at)).toEqual(["modules.b"]);
    expect(found[0].problem).toContain("arrange");
  });
});

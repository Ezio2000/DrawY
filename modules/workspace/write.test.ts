import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveLibrary } from "@drawy/materials/testing";
import { EditRejected, type Problem, type Work } from "../contracts/index.ts";
import { register } from "../identity/index.ts";
import { library as client } from "../materials/index.ts";
import { fixture } from "../runtime/fixture.ts";
import { Storage } from "../storage/index.ts";
import { createWork, writeWork } from "./index.ts";


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

describe("data a drawing's schema reads", () => {
  const seq = (data: Record<string, unknown>) => ({ id: "seq", bounds: [0, 0, 640, 360], drawingId: "sequence", data });
  it("gives items ids, reads names written for references, and refuses what names nothing", async () => {
    const work = fixture();
    const store = storeWith(work);
    const { work: saved } = await writeWork(
      store,
      work.id,
      {
        modules: [
          seq({
            participants: ["Browser", { label: "服务器" }],
            messages: [{ from: "Browser", to: "服务器", label: "请求" }],
          }),
        ],
      },
      { cause },
    );
    const data = saved.scenes.root.modules.at(-1)!.data as { participants: { id: string; label: string }[]; messages: { id: string; from: string; to: string }[] };
    expect(data.participants.map((p) => p.label)).toEqual(["Browser", "服务器"]);
    expect(data.participants[0].id).toBe("browser");
    expect(data.participants[1].id).toMatch(/^l[a-z0-9]+$/);
    expect(data.messages[0]).toMatchObject({ from: "browser", to: data.participants[1].id });
    expect(data.messages[0].id).toBeTruthy();
    // A name that is nowhere, or among two, is refused where it is written.
    const found = await refusal(() =>
      writeWork(
        store,
        work.id,
        { modules: [seq({ participants: ["A", "A", "B"], messages: [{ from: "A", to: "C", label: "x", kind: "shout" }] })] },
        { cause },
      ),
    );
    expect(found.map((p) => p.at)).toEqual([
      "modules.seq.data.messages.0.from",
      "modules.seq.data.messages.0.to",
      "modules.seq.data.messages.0.kind",
    ]);
    expect(found[0].problem).toMatch(/有 2 项同名/);
    expect(found[1].problem).toMatch(/participants 里没有 "C"/);
  });
  it("changes, appends and deletes items by id, taking along what referred to them", async () => {
    const work = fixture();
    const store = storeWith(work);
    await writeWork(
      store,
      work.id,
      {
        modules: [
          seq({
            participants: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
            messages: [
              { id: "m1", from: "a", to: "b", label: "1" },
              { id: "m2", from: "b", to: "c", label: "2" },
              { id: "m3", from: "c", to: "a", label: "3" },
            ],
            notes: [{ id: "n1", over: ["a", "c"], text: "跨两人" }],
          }),
        ],
      },
      { cause },
    );
    const { work: saved } = await writeWork(
      store,
      work.id,
      { modules: [{ id: "seq", data: { participants: { "#c": null, "#d": { label: "D" } }, messages: { "#m1": { label: "一" } } } }] },
      { cause },
    );
    const data = saved.scenes.root.modules.at(-1)!.data as Record<string, { id: string }[]>;
    expect(data.participants.map((p) => p.id)).toEqual(["a", "b", "d"]);
    // The messages to and from C went with it; the note over A and C stays over A.
    expect(data.messages).toEqual([{ id: "m1", from: "a", to: "b", label: "一" }]);
    expect(data.notes).toEqual([{ id: "n1", over: ["a"], text: "跨两人" }]);
    // A key a library drawing does not read is refused.
    const found = await refusal(() => writeWork(store, work.id, { modules: [{ id: "seq", data: { actors: ["A"] } }] }, { cause }));
    expect(found[0]).toMatchObject({ at: "modules.seq.data.actors" });
  });
});

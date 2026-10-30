import { fixture } from "../runtime/fixture.ts";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "./index.ts";
import {
  createWork,
  writeWork,
  moveModules,
  restore,
} from "../workspace/index.ts";
import { register, login } from "../identity/index.ts";
import { createApp } from "../../apps/server/app.ts";
let dir: string, db: Storage;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "drawy-test-"));
  db = new Storage(dir);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
});
describe("user owned works", () => {
  it("scopes works, assets, revisions, runs and settings to their owner", () => {
    const a = db.scoped(register(db, "alice", "abcdef").id),
      b = db.scoped(register(db, "bob", "abcdef").id),
      work = createWork(a, "water");
    const asset = a.putAsset(new Uint8Array([1]), "blue", "image/png");
    a.saveRun({
      id: "run",
      workId: work.id,
      sceneId: "root",
      status: "waiting",
      startedAt: 1,
      steps: [],
      observations: [],
    });
    const settings = a.settings();
    settings.preferences = "blue";
    a.saveSettings(settings);
    expect(b.works()).toEqual([]);
    expect(() => b.work(work.id)).toThrow();
    expect(() => b.asset(asset.id)).toThrow();
    expect(() => b.bytes(asset.id)).toThrow();
    expect(() => b.revision(work.id, 1)).toThrow();
    expect(() => b.run("run")).toThrow();
    expect(() => b.context("run")).toThrow();
    expect(b.settings().preferences).toBe("");
    expect(() => b.delete(work.id)).toThrow();
    expect(a.work(work.id)).toEqual(work);
  });
  it("updates shared drawing source and restores the complete composition atomically", () => {
    const store = db.scoped(register(db, "a", "abcdef").id);
    const work = createWork(store, "test");
    const content = fixture();
    const saved = writeWork(store, work.id, {
      baseRevision: 1,
      drawings: Object.values(content.drawings),
      scenes: Object.values(content.scenes),
      details: Object.values(content.details),
      interactions: Object.values(content.interactions),
    });
    expect(saved.revision).toBe(2);
    const changed = {
      ...saved.drawings.tier,
      source: "return api.svg('<svg/>');",
    };
    const edited = writeWork(store, work.id, {
      baseRevision: 2,
      drawings: [changed],
    });
    expect(edited.scenes).toEqual(saved.scenes);
    expect(edited.drawings.tier).toEqual(changed);
    expect(() =>
      writeWork(store, work.id, { baseRevision: 2, title: "stale" }),
    ).toThrow("版本");
    expect(restore(store, work.id, 2).revision).toBe(4);
    expect(store.work(work.id).drawings.tier).toEqual(content.drawings.tier);
    expect(store.revision(work.id, 3).drawings.tier).toEqual(changed);
  });
  it("validates composition references together and permits atomic deletion", () => {
    const store = db.scoped(register(db, "a", "abcdef").id);
    const work = createWork(store, "test"),
      content = fixture();
    writeWork(store, work.id, {
      baseRevision: 1,
      drawings: Object.values(content.drawings),
      scenes: Object.values(content.scenes),
      details: Object.values(content.details),
      interactions: Object.values(content.interactions),
    });
    expect(() =>
      writeWork(store, work.id, {
        baseRevision: 2,
        remove: { drawings: ["tier"] },
      }),
    ).toThrow("画法");
    expect(() =>
      writeWork(store, work.id, {
        baseRevision: 2,
        scenes: [{ ...content.scenes.child, parentId: "child" }],
      }),
    ).toThrow("循环");
    expect(() =>
      writeWork(store, work.id, {
        baseRevision: 2,
        scenes: [{ ...content.scenes.child, parentId: "missing" }],
      }),
    ).toThrow("父场景");
    expect(() =>
      writeWork(store, work.id, {
        baseRevision: 2,
        scenes: [
          {
            ...content.scenes.root,
            links: [
              {
                id: "link",
                drawingId: "connector",
                from: { moduleId: "level-0", anchor: "missing" },
                to: { moduleId: "level-1", anchor: "left" },
                data: {},
              },
            ],
          },
        ],
      }),
    ).toThrow("锚点");
    const cleared = writeWork(store, work.id, {
      baseRevision: 2,
      scenes: [{ ...content.scenes.root, modules: [], checks: [] }],
      remove: { drawings: ["tier"] },
    });
    expect(cleared.revision).toBe(3);
    expect(cleared.drawings.tier).toBeUndefined();
  });
  it("moves modules without changing drawing definitions, data or the saved camera", () => {
    const store = db.scoped(register(db, "a", "abcdef").id),
      work = createWork(store, "test"),
      content = fixture();
    const saved = writeWork(store, work.id, {
      baseRevision: 1,
      drawings: Object.values(content.drawings),
      scenes: Object.values(content.scenes),
      details: Object.values(content.details),
      interactions: Object.values(content.interactions),
    });
    const m = saved.scenes.root.modules[0];
    const moved = moveModules(store, work.id, "root", 2, [
      { id: m.id, bounds: { ...m.bounds, x: 901 } },
    ]);
    expect(moved.drawings).toEqual(saved.drawings);
    expect(moved.scenes.root.modules[0]).toEqual({
      ...m,
      bounds: { ...m.bounds, x: 901 },
    });
    expect(moved.scenes.root.modules.slice(1)).toEqual(
      saved.scenes.root.modules.slice(1),
    );
    expect(moved).not.toHaveProperty("camera");
  });
  it("rejects resources owned by another user before changing any records", () => {
    const a = db.scoped(register(db, "a", "abcdef").id),
      b = db.scoped(register(db, "b", "abcdef").id),
      work = createWork(a, "test");
    const asset = b.putAsset(new Uint8Array([1]), "x", "image/png");
    expect(() =>
      writeWork(a, work.id, {
        baseRevision: 1,
        title: "changed",
        resources: [
          { id: "image", name: "x", url: asset.url, assetId: asset.id },
        ],
      }),
    ).toThrow();
    expect(a.work(work.id)).toEqual(work);
  });
  it("retains saved content and suspended conversation across reopening", () => {
    const uid = register(db, "a", "abcdef").id,
      s = db.scoped(uid),
      w = createWork(s, "persist");
    s.saveRun({
      id: "waiting",
      workId: w.id,
      sceneId: "root",
      status: "waiting",
      startedAt: 0,
      steps: [],
      observations: [],
      question: { text: "which?", options: ["a", "b"] },
    });
    s.context("waiting", { input: [{ role: "user", content: "a" }] });
    db.close();
    db = new Storage(dir);
    expect(db.scoped(uid).work(w.id).title).toBe("persist");
    expect(db.scoped(uid).context("waiting").input).toHaveLength(1);
  });
});
describe("HTTP identity boundary", () => {
  it("uses session ownership on reads, scene rendering and mutations", async () => {
    const { app } = createApp(db);
    const signup = async (name: string) => {
      const r = await app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password: "abcdef" }),
      });
      return r.headers.get("set-cookie")!.split(";")[0];
    };
    const a = await signup("alice"),
      b = await signup("bob");
    const request = (
      path: string,
      cookie: string,
      method = "GET",
      body?: object,
    ) =>
      app.request(path, {
        method,
        headers: { cookie, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
    const w = await (
      await request("/api/works", a, "POST", { title: "private" })
    ).json();
    expect((await request("/api/works/" + w.id, b)).status).toBe(404);
    expect(
      (await request("/api/works/" + w.id + "/scenes/root", b)).status,
    ).toBe(404);
    expect(
      (
        await request("/api/works/" + w.id + "/restore", b, "POST", {
          revision: 1,
        })
      ).status,
    ).toBe(404);
    expect((await request("/api/works/" + w.id, b, "DELETE")).status).toBe(404);
    expect((await app.request("/api/works")).status).toBe(401);
    expect((await request("/api/works/" + w.id, a)).status).toBe(200);
    await request("/api/auth/logout", a, "POST");
    expect((await request("/api/works", a)).status).toBe(401);
    expect(() => login(db, "alice", "wrong")).toThrow();
  });
});

import { fixture, workEdit } from "../runtime/fixture.ts";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "./index.ts";
import { createWork, writeWork, restore, undo } from "../workspace/index.ts";
import { moveParts } from "../editing/index.ts";
import {
  emptySettings,
  modelCatalogSchema,
  defaultCatalog,
  type Work,
} from "../contracts/index.ts";
import { register, login, createInvites } from "../identity/index.ts";
import { createApp } from "../../apps/server/app.ts";
import { serveLibrary, picture } from "@drawy/materials/testing";
import { library as client } from "../materials/index.ts";
let dir: string, db: Storage, library: ReturnType<typeof serveLibrary>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "drawy-test-"));
  db = new Storage(dir);
  library = serveLibrary(client.base);
});
/** A fresh invite for signing up over HTTP once the app has an account. */
const invite = () =>
  db.hasAccounts() ? createInvites(db, db.accounts()[0].id)[0].code : undefined;
afterEach(() => {
  library.close();
  db.close();
  rmSync(dir, { recursive: true });
});
describe("user owned works", () => {
  it("scopes works, captures, revisions, runs and settings to their owner", () => {
    const a = db.scoped(register(db, "alice", "abcdef").id),
      b = db.scoped(register(db, "bob", "abcdef").id),
      work = createWork(a, "water");
    const capture = a.putCapture(new Uint8Array([1]), "blue");
    a.saveRun({
      id: "run",
      workId: work.id,
      sceneId: "root",
      status: "waiting",
      startedAt: 1,
      steps: [],
      observations: [],
    });
    a.saveOwnSettings({ ...emptySettings(), preferences: "blue" });
    expect(b.works()).toEqual([]);
    expect(() => b.work(work.id)).toThrow();
    expect(() => b.capture(capture.id)).toThrow();
    expect(() => b.captureBytes(capture.id)).toThrow();
    expect(() => b.revision(work.id, 1)).toThrow();
    expect(() => b.run("run")).toThrow();
    expect(() => b.context("run")).toThrow();
    expect(b.settings().preferences).toBe("");
    expect(() => b.delete(work.id)).toThrow();
    expect(a.work(work.id)).toEqual(work);
  });
  it("saves a speed or a format the connection lacks as one it has", () => {
    const base = defaultCatalog();
    const catalog = modelCatalogSchema.parse({
      ...base,
      writers: [
        {
          ...base.writers[0],
          channel: "oauth",
          models: [{ ...base.writers[0].models[0], speed: "flex", protocol: "chat" }],
        },
      ],
    });
    // A ChatGPT account speaks the Responses API and has no built-in search to offer.
    expect(catalog.writers[0].models[0]).toMatchObject({
      speed: "default",
      speeds: ["default", "fast"],
      protocol: "responses",
      builtinSearch: false,
    });
  });
  it("starts again from the default catalog when the saved one no longer reads", () => {
    db.db.prepare("UPDATE system SET data=? WHERE key='models'").run(JSON.stringify({ models: [] }));
    expect(db.models()).toEqual(defaultCatalog());
  });
  it("updates shared drawing source and restores the complete composition atomically", async () => {
    const store = db.scoped(register(db, "a", "abcdef").id);
    const work = createWork(store, "test");
    const content = fixture();
    store.commit({ ...store.work(work.id), brief: content.brief }, 1, {
      kind: "edit",
    });
    const { work: saved } = await writeWork(
      store,
      work.id,
      {
        ...workEdit(content),
      }, { cause: { kind: "edit" } });
    expect(saved.revision).toBe(3);
    const changed = {
      ...saved.drawings.tier,
      source: "return api.svg('<svg/>');",
    };
    const { work: edited } = await writeWork(
      store,
      work.id,
      {
        drawings: [changed],
      }, { cause: { kind: "edit" } });
    expect(edited.scenes).toEqual(saved.scenes);
    expect(edited.drawings.tier).toEqual(changed);
    await expect(
      writeWork(
        store,
        work.id,
        { title: "stale" }, { base: 3, cause: { kind: "edit" } }),
    ).rejects.toThrow("版本");
    expect(restore(store, work.id, 3).revision).toBe(5);
    expect(store.work(work.id).drawings.tier).toEqual(content.drawings.tier);
    expect(store.revision(work.id, 4).drawings.tier).toEqual(changed);
  });
  it("takes library code again on each write, so a work runs what the author's catalog describes", async () => {
    const store = db.scoped(register(db, "a", "abcdef").id);
    const work = createWork(store, "test");
    store.commit({ ...store.work(work.id), brief: fixture().brief }, 1, {
      kind: "edit",
    });
    const { work: first } = await writeWork(
      store,
      work.id,
      {
        drawings: [{ id: "x", name: "x", source: 'return api.draw("steps")' }],
      }, { cause: { kind: "edit" } });
    const sourceOf = (w: Work) => {
      const m = w.materials.steps;
      if (m.kind !== "drawing") throw Error("steps is a library drawing");
      return m;
    };
    const current = sourceOf(first).source;
    // As if saved by an earlier version of the library.
    store.commit(
      {
        ...first,
        materials: {
          ...first.materials,
          steps: { ...sourceOf(first), source: "return api.svg('<svg/>')" },
        },
      },
      3,
      { kind: "edit" },
    );
    const { work: next } = await writeWork(
      store,
      work.id,
      { title: "renamed" }, { cause: { kind: "edit" } });
    expect(sourceOf(next).source).toBe(current);
    // Until it is written, a work keeps the version it was saved with.
    expect(sourceOf(store.revision(work.id, 4)).source).toBe(
      "return api.svg('<svg/>')",
    );
  });
  it("undoes a whole request, then a hand edit, walking back through restores", async () => {
    const store = db.scoped(register(db, "a", "abcdef").id);
    const work = createWork(store, "test"),
      content = fixture();
    const run = (id: string) => ({
      kind: "run" as const,
      runId: id,
      prompt: id,
    });
    store.commit(
      { ...store.work(work.id), brief: content.brief },
      1,
      run("r1"),
    );
    await writeWork(
      store,
      work.id,
      {
        ...workEdit(content),
      }, { cause: run("r1") });
    // A second request saves two drafts; undo takes back both.
    await writeWork(store, work.id, { title: "a" }, { cause: run("r2") });
    await writeWork(store, work.id, { title: "b" }, { cause: run("r2") });
    expect(undo(store, work.id)).toMatchObject({ revision: 6, title: "b" });
    expect(store.work(work.id).drawings).toEqual(
      store.revision(work.id, 3).drawings,
    );
    expect(store.revisions(work.id)[0].cause).toEqual({
      kind: "restore",
      revision: 3,
    });
    // Undoing again goes on from the restored revision, back past the first request.
    expect(undo(store, work.id).revision).toBe(7);
    expect(store.work(work.id).scenes).toEqual(
      store.revision(work.id, 1).scenes,
    );
    expect(() => undo(store, work.id)).toThrow("撤销");
    // Once the user names the work, the author's later titles leave it as the user wrote it.
    store.rename(work.id, "【high】我的标题");
    const { work: kept, keptTitle } = await writeWork(
      store,
      work.id,
      { title: "作者的标题" }, { cause: run("r3") });
    expect([kept.title, kept.named, keptTitle]).toEqual(["【high】我的标题", true, true]);
    expect(undo(store, work.id)).toMatchObject({ title: "【high】我的标题", named: true });
  });
  it("keeps undo moving backward after undoing twice and redoing a restored revision", async () => {
    const user = register(db, "author", "abcdef"),
      store = db.scoped(user.id);
    let work = createWork(store, "test");
    for (const title of ["A", "B", "C"])
      work = store.commit(
        { ...work, scenes: { root: { ...work.scenes.root, title } } },
        work.revision,
        { kind: "run", runId: title, prompt: title },
      );
    const { app } = createApp(db),
      cookie = "drawy_session=" + db.session(user.id);
    const change = async (action: "undo" | "restore", revision?: number) => {
      const response = await app.request(`/api/works/${work.id}/${action}`, {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: revision === undefined ? undefined : JSON.stringify({ revision }),
      });
      expect(response.status).toBe(200);
      return (await response.json()) as Work;
    };
    const b = await change("undo");
    expect(b.scenes.root.title).toBe("B");
    expect((await change("undo")).scenes.root.title).toBe("A");
    // Redo uses the revision saved by the first undo, inside the same restore group.
    expect((await change("restore", b.revision)).scenes.root.title).toBe("B");
    expect((await change("undo")).scenes.root.title).toBe("A");
    expect((await change("undo")).scenes).toEqual(store.revision(work.id, 1).scenes);
    // Restoring a previous restoration still follows its own target.
    expect((await change("restore", b.revision)).scenes.root.title).toBe("B");
    expect((await change("undo")).scenes.root.title).toBe("A");
    expect(store.revision(work.id, 4).scenes.root.title).toBe("C");
  });
  it("validates composition references together and permits atomic deletion", async () => {
    const store = db.scoped(register(db, "a", "abcdef").id);
    const work = createWork(store, "test"),
      content = fixture();
    store.commit({ ...store.work(work.id), brief: content.brief }, 1, {
      kind: "edit",
    });
    await writeWork(
      store,
      work.id,
      {
        ...workEdit(content),
      }, { cause: { kind: "edit" } });
    await expect(
      writeWork(
        store,
        work.id,
        {
          remove: { drawings: ["tier"] },
        }, { cause: { kind: "edit" } }),
    ).rejects.toThrow("画法");
    await expect(
      writeWork(
        store,
        work.id,
        {
          scenes: [{ id: "child", parentId: "child" }],
        }, { cause: { kind: "edit" } }),
    ).rejects.toThrow("循环");
    await expect(
      writeWork(
        store,
        work.id,
        {
          scenes: [{ id: "child", parentId: "missing" }],
        }, { cause: { kind: "edit" } }),
    ).rejects.toThrow("父场景");
    await expect(
      writeWork(
        store,
        work.id,
        {
          links: [
            {
              id: "link",
              from: { moduleId: "level-0", at: "right" },
              to: { moduleId: "gone", at: "left" },
            },
          ],
        },
        { cause: { kind: "edit" } },
      ),
    ).rejects.toThrow("连线 link 的一端 gone");
    const { work: cleared } = await writeWork(
      store,
      work.id,
      {
        scenes: [{ id: "root", clear: true }],
        remove: { drawings: ["tier"] },
      }, { cause: { kind: "edit" } });
    expect(cleared.revision).toBe(4);
    expect(cleared.drawings.tier).toBeUndefined();
  });
  it("commits a hand edit from the canvas as a revision of its own, changing only what it names", async () => {
    const { app } = createApp(db);
    const signup = async (name: string) => {
      const r = await app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password: "abcdef", invite: invite() }),
      });
      return {
        cookie: r.headers.get("set-cookie")!.split(";")[0],
        id: ((await r.json()) as { id: string }).id,
      };
    };
    const alice = await signup("alice"),
      bob = await signup("bob");
    const store = db.scoped(alice.id),
      work = createWork(store, "test"),
      content = fixture();
    store.commit({ ...store.work(work.id), brief: content.brief }, 1, {
      kind: "edit",
    });
    const { work: saved } = await writeWork(
      store,
      work.id,
      {
        ...workEdit(content),
      }, { cause: { kind: "run", runId: "r", prompt: "draw" } });
    const m = saved.scenes.root.modules[0];
    const send = (cookie: string, body: object) =>
      app.request(`/api/works/${work.id}/edits`, {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const edit = {
      baseRevision: saved.revision,
      edit: moveParts(saved, "root", [{ id: m.id, bounds: { ...m.bounds, x: 901 } }]),
    };
    expect((await send(bob.cookie, edit)).status).toBe(404);
    const r = await send(alice.cookie, edit);
    expect(r.status).toBe(200);
    const moved = (await r.json()) as Work;
    expect(moved.revision).toBe(4);
    expect(moved.drawings).toEqual(saved.drawings);
    expect(moved.scenes.root.modules[0]).toEqual({
      ...m,
      bounds: { ...m.bounds, x: 901 },
    });
    expect(moved.scenes.root.modules.slice(1)).toEqual(
      saved.scenes.root.modules.slice(1),
    );
    expect(store.revisions(work.id)[0]).toMatchObject({
      revision: 4,
      cause: { kind: "edit" },
    });
    // An edit made from a revision that is no longer the latest is refused.
    expect((await send(alice.cookie, edit)).status).toBe(409);
    // Until the person saves it, the edit is not a version of its own.
    expect(store.revisions(work.id)[0].cause).toEqual({ kind: "edit", draft: true });
    expect(store.progress(work.id)).toMatchObject({ version: 2, unsaved: 1 });
    const save = (cookie: string) =>
      app.request(`/api/works/${work.id}/save`, { method: "POST", headers: { cookie } });
    expect((await save(bob.cookie)).status).toBe(404);
    const kept = await save(alice.cookie);
    expect(kept.status).toBe(200);
    expect(((await kept.json()) as Work).scenes).toEqual(moved.scenes);
    expect(store.progress(work.id)).toMatchObject({ version: 3 });
    expect(store.progress(work.id).unsaved).toBeUndefined();
    // With nothing left to save, saving says so.
    expect((await save(alice.cookie)).status).not.toBe(200);
    // A hand edit is a step of its own: undoing it leaves the author's drawing.
    expect(undo(store, work.id).scenes).toEqual(saved.scenes);
  });
  it("takes named materials into the work and keeps other users' pictures out", async () => {
    // The first account administers the app and may use everyone's materials.
    const admin = db.scoped(register(db, "admin", "abcdef").id),
      a = db.scoped(register(db, "a", "abcdef").id),
      b = db.scoped(register(db, "b", "abcdef").id),
      work = createWork(a, "test");
    const content = fixture();
    const fruit = {
      id: "fruit",
      name: "苹果",
      source: 'return api.material("apple")',
    };
    const module = {
      id: "apple",
      label: "苹果",
      drawingId: "fruit",
      data: { body: "earth", label: "earth orbit" },
      bounds: [0, 0, 10, 10],
    };
    await expect(
      writeWork(
        a,
        work.id,
        {
          drawings: [fruit],
          modules: [module],
        }, { cause: { kind: "edit" } }),
    ).rejects.toThrow("set_brief");
    a.commit({ ...a.work(work.id), brief: content.brief }, 1, { kind: "edit" });
    const theirs = await client.ingest(
      await picture(),
      "image/png",
      {
        role: "object",
        name: { zh: "私图", en: "private" },
        style: null,
        origin: { kind: "upload" },
      },
      b.userId,
    );
    await expect(
      writeWork(
        a,
        work.id,
        { materials: [theirs.id] }, { cause: { kind: "edit" } }),
    ).rejects.toThrow();
    // One whose role sees all materials may use it.
    const theirsToo = createWork(admin, "admin's");
    admin.commit({ ...admin.work(theirsToo.id), brief: content.brief }, 1, {
      kind: "edit",
    });
    const { added: taken } = await writeWork(
      admin,
      theirsToo.id,
      { materials: [theirs.id] }, { cause: { kind: "edit" } });
    expect(taken).toEqual([theirs.id]);
    const { work: saved, added } = await writeWork(
      a,
      work.id,
      {
        drawings: [fruit],
        modules: [module],
      }, { cause: { kind: "edit" } });
    // Called literally in code, or held as an id in module data.
    expect(added.sort()).toEqual(["apple", "earth"]);
    expect(saved.materials.apple).toMatchObject({
      kind: "picture",
      url: "/materials/files/apple",
      anchors: { stem: expect.any(Object) },
    });
    await expect(
      writeWork(
        a,
        work.id,
        {
          drawings: [
            { ...fruit, source: 'return api.material("no-such-thing")' },
          ],
        }, { cause: { kind: "edit" } }),
    ).rejects.toThrow("no-such-thing");
    // A module drawn by a library drawing as it is takes that drawing in; a picture is
    // not a drawing.
    const { work: plotted } = await writeWork(
      a,
      work.id,
      {
        modules: [
              module,
              { ...module, id: "wave", drawingId: "waves", data: {} },
            ],
      }, { cause: { kind: "edit" } });
    expect(plotted.materials.waves).toMatchObject({ kind: "drawing" });
    // A picture generated before ids were cut first may carry "--"; data naming it keeps it.
    await client.reserve(
      {
        id: "g-old-name--ab12",
        role: "object",
        name: { zh: "旧图", en: "old" },
        about: "",
        tags: [],
        category: "",
        style: null,
        width: 64,
        height: 64,
        origin: { kind: "generated", prompt: "", model: "test" },
      },
      a.userId,
    );
    const { added: old } = await writeWork(
      a,
      work.id,
      {
        modules: [
              module,
              { ...module, id: "wave", drawingId: "waves", data: {} },
              { ...module, id: "old", data: { picture: "g-old-name--ab12" } },
            ],
      }, { cause: { kind: "edit" } });
    expect(old).toEqual(["g-old-name--ab12"]);
    await expect(
      writeWork(
        a,
        work.id,
        {
          modules: [{ ...module, drawingId: "apple" }],
        }, { cause: { kind: "edit" } }),
    ).rejects.toThrow("画法 apple 不存在");
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
      questions: [
        { id: "q", text: "which?", options: [{ label: "a" }, { label: "b" }] },
      ],
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
        body: JSON.stringify({ name, password: "abcdef", invite: invite() }),
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
describe("roles and shared models", () => {
  it("lets the first account administer models, materials and roles, and others only pick", async () => {
    const { app } = createApp(db);
    const signup = async (name: string) => {
      const r = await app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password: "abcdef", invite: invite() }),
      });
      const account = (await r.json()) as { id: string; role: string };
      return { ...account, cookie: r.headers.get("set-cookie")!.split(";")[0] };
    };
    const call = async (
      cookie: string,
      path: string,
      method = "GET",
      body?: object,
    ) => {
      const r = await app.request("/api" + path, {
        method,
        headers: { cookie, "Content-Type": "application/json" },
        body: body && JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    };
    const admin = await signup("admin"),
      member = await signup("member");
    expect([admin.role, member.role]).toEqual(["admin", "member"]);
    // Members see labels by name only, never the models in them, and cannot manage
    // anything.
    const seen = await call(member.cookie, "/models");
    expect(seen.body).toEqual({
      labels: [{ id: "default", name: "默认", description: "", ready: false }],
      chosen: { label: "default" },
    });
    expect(JSON.stringify(seen.body)).not.toMatch(/credential|prices|gpt/);
    for (const path of ["/admin/models", "/admin/accounts", "/admin/roles", "/traces"])
      expect((await call(member.cookie, path)).status).toBe(403);
    // The administrator connects a second provider and makes two labels of the models;
    // members pick a label, which their runs use.
    const catalog = (await call(admin.cookie, "/admin/models")).body;
    const quick = {
      ...catalog.writers[0],
      id: "quick-provider",
      name: "quick",
      credential: "key",
      models: [{ ...catalog.writers[0].models[0], id: "quick", efforts: ["low", "high"], effort: "low" }],
    };
    const image = catalog.defaults.image;
    const labels = [
      { id: "fast", name: "快速", description: "", writer: "quick", web: "off", image },
      { id: "deep", name: "深入", description: "", writer: "quick", effort: "high", web: "builtin", image },
    ];
    expect(
      (
        await call(admin.cookie, "/admin/models", "PUT", {
          ...catalog,
          writers: [...catalog.writers, quick],
          labels: [...labels, { ...labels[0], id: "broken", writer: "missing" }],
          defaults: { ...catalog.defaults, label: "fast" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(admin.cookie, "/admin/models", "PUT", {
          ...catalog,
          writers: [...catalog.writers, quick],
          labels,
          defaults: { ...catalog.defaults, label: "fast" },
        })
      ).status,
    ).toBe(200);
    expect((await call(member.cookie, "/models")).body.chosen.label).toBe("fast");
    expect(db.scoped(member.id).settings()).toMatchObject({
      label: "快速",
      author: { credential: "key", effort: "low" },
      search: { mode: "off" },
    });
    // Only a label can be picked.
    await call(member.cookie, "/settings", "PUT", { preferences: "", label: "deep", writer: "gpt-6-astra" });
    expect(db.scoped(member.id).ownSettings()).toEqual({ preferences: "", label: "deep" });
    expect(db.scoped(member.id).settings()).toMatchObject({
      label: "深入",
      author: { credential: "key", effort: "high" },
      search: { mode: "builtin" },
    });
    // Members start with ten requests, the first account with no limit; an administrator
    // sets how many are left, and a request past them is refused.
    expect((await call(member.cookie, "/auth/me")).body.quota).toBe(10);
    expect((await call(admin.cookie, "/auth/me")).body.quota).toBe(null);
    expect(
      (await call(member.cookie, "/admin/accounts/" + member.id, "PATCH", { quota: 99 })).status,
    ).toBe(403);
    expect(
      (await call(admin.cookie, "/admin/accounts/" + member.id, "PATCH", { quota: 1 })).body,
    ).toMatchObject({ quota: 1, role: "member" });
    db.spendQuota(member.id);
    expect(() => db.spendQuota(member.id)).toThrow("提问次数已用完");
    db.refundQuota(member.id);
    expect(db.account(member.id).quota).toBe(1);
    db.setQuota(member.id, 0);
    const w = (await call(member.cookie, "/works", "POST", { title: "t" })).body;
    const refused = await call(member.cookie, "/works/" + w.id + "/runs", "POST", {
      prompt: "draw",
      sceneId: w.rootSceneId,
    });
    expect(refused.status).toBe(403);
    // A request that cannot start gives its allowance back.
    db.setQuota(member.id, 1);
    const missing = await call(member.cookie, "/works/" + w.id + "/runs", "POST", {
      prompt: "draw",
      sceneId: "nowhere",
    });
    expect(missing.status).toBe(404);
    expect(db.account(member.id).quota).toBe(1);
    // The list of works says where each has got to.
    expect((await call(member.cookie, "/works")).body[0].progress).toEqual({
      run: null,
      prompt: "",
      version: 0,
      blank: true,
    });
    // A role that manages models makes its accounts able to.
    const editors = await call(admin.cookie, "/admin/roles", "POST", {
      name: "Model editors",
      permissions: ["models.manage"],
    });
    expect(
      (
        await call(admin.cookie, "/admin/accounts/" + member.id, "PATCH", {
          role: editors.body.id,
        })
      ).body,
    ).toMatchObject({ role: editors.body.id, permissions: ["models.manage"] });
    expect((await call(member.cookie, "/admin/models")).status).toBe(200);
    expect((await call(member.cookie, "/admin/roles")).status).toBe(403);
    // Built-in roles stay; the last administrator stays one.
    expect(
      (
        await call(admin.cookie, "/admin/roles/admin", "PUT", {
          name: "x",
          permissions: [],
        })
      ).status,
    ).toBe(409);
    expect(
      (await call(admin.cookie, "/admin/roles/member", "DELETE")).status,
    ).toBe(409);
    expect(
      (
        await call(admin.cookie, "/admin/accounts/" + admin.id, "PATCH", {
          role: "member",
        })
      ).status,
    ).toBe(409);
    // Removing a role makes its accounts members again.
    await call(admin.cookie, "/admin/roles/" + editors.body.id, "DELETE");
    expect((await call(member.cookie, "/auth/me")).body).toMatchObject({
      role: "member",
      permissions: [],
    });
  });
  it("shows material model names only to accounts that manage models", async () => {
    const admin = register(db, "admin", "abcdef"),
      member = register(db, "member", "abcdef"),
      { app } = createApp(db);
    const made = await client.ingest(
      await picture(),
      "image/png",
      {
        role: "object",
        name: { zh: "生成图", en: "Generated picture" },
        style: null,
        origin: { kind: "generated", model: "image-model", prompt: "A red square" },
      },
      member.id,
    );
    const cookies = [admin, member].map((a) => "drawy_session=" + db.session(a.id));
    const read = async (cookie: string, path: string) => {
      const response = await app.request("/api/materials" + path, { headers: { cookie } });
      expect(response.status).toBe(200);
      return response.json();
    };
    const withoutModel = ({ model, ...origin }: typeof made.origin) => origin;
    for (const material of [
      await read(cookies[1], "/" + made.id),
      (await read(cookies[1], "?kind=picture&shelf=mine")).items[0],
    ])
      expect(material.origin).toEqual(withoutModel(made.origin));
    expect((await read(cookies[0], "/" + made.id)).origin).toEqual(made.origin);
    expect((await read(cookies[0], "?kind=picture&shelf=others")).items[0]).toMatchObject({
      ownerName: "member",
      origin: made.origin,
    });
    // Managing materials alone does not grant access to model names, including on publish.
    db.saveRole({ id: "librarian", name: "Librarian", permissions: ["materials.manage"], builtin: false });
    db.setRole(member.id, "librarian");
    const published = await app.request(`/api/materials/${made.id}/publish`, {
      method: "POST",
      headers: { cookie: cookies[1], "Content-Type": "application/json" },
      body: JSON.stringify({ published: true }),
    });
    expect(published.status).toBe(200);
    expect((await published.json()).origin).toEqual(withoutModel(made.origin));
    expect((await read(cookies[1], "?kind=picture&shelf=public")).items
      .find((m: { id: string }) => m.id === made.id).origin)
      .toEqual(withoutModel(made.origin));
    // Filtering a response leaves provenance available in the library and to model managers.
    expect((await client.get([made.id], { id: member.id }))[0].origin).toEqual(made.origin);
    db.saveRole({ id: "model-editor", name: "Model editor", permissions: ["models.manage"], builtin: false });
    db.setRole(member.id, "model-editor");
    expect((await read(cookies[1], "/" + made.id)).origin).toEqual(made.origin);
  });
  it("shelves materials apart and lets those who manage them publish", async () => {
    const { app } = createApp(db);
    const signup = async (name: string) => {
      const r = await app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password: "abcdef", invite: invite() }),
      });
      const account = (await r.json()) as { id: string };
      return { ...account, cookie: r.headers.get("set-cookie")!.split(";")[0] };
    };
    const admin = await signup("admin"),
      alice = await signup("alice"),
      bob = await signup("bob");
    const mine = await client.ingest(
      await picture(),
      "image/png",
      {
        role: "object",
        name: { zh: "私图", en: "private" },
        style: null,
        origin: { kind: "upload" },
      },
      alice.id,
    );
    const shelf = async (cookie: string, on: string) => {
      const r = await app.request(
        `/api/materials?kind=picture&size=200&shelf=${on}`,
        { headers: { cookie } },
      );
      return r.ok
        ? ((await r.json()) as { items: { id: string; ownerName?: string }[] })
            .items
        : r.status;
    };
    const ids = (items: Awaited<ReturnType<typeof shelf>>) =>
      typeof items === "number" ? items : items.map((m) => m.id);
    expect(ids(await shelf(alice.cookie, "mine"))).toEqual([mine.id]);
    expect(ids(await shelf(alice.cookie, "public"))).not.toContain(mine.id);
    expect(ids(await shelf(bob.cookie, "mine"))).toEqual([]);
    expect(await shelf(bob.cookie, "others")).toBe(400);
    const others = await shelf(admin.cookie, "others");
    expect(others).toEqual([
      expect.objectContaining({ id: mine.id, ownerName: "alice" }),
    ]);
    // The picture file itself follows the same rule.
    const file = (cookie: string) =>
      app.request("/materials/files/" + mine.id, { headers: { cookie } });
    expect((await file(bob.cookie)).status).toBe(404);
    expect((await file(admin.cookie)).status).toBe(200);
    const publish = (cookie: string, published: boolean) =>
      app.request(`/api/materials/${mine.id}/publish`, {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ published }),
      });
    expect((await publish(alice.cookie, true)).status).toBe(403);
    expect((await publish(admin.cookie, true)).status).toBe(200);
    expect(ids(await shelf(bob.cookie, "public"))).toContain(mine.id);
    expect((await file(bob.cookie)).status).toBe(200);
    expect((await publish(admin.cookie, false)).status).toBe(200);
    expect(ids(await shelf(alice.cookie, "mine"))).toEqual([mine.id]);
  });
});
describe("invites", () => {
  it("lets the first account set the app up, then admits each later one with an unused invite", async () => {
    const { app } = createApp(db);
    const post = (path: string, body: object, cookie = "") =>
      app.request("/api" + path, {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const call = async (cookie: string, path: string, method = "GET") => {
      const r = await app.request("/api" + path, { method, headers: { cookie } });
      return { status: r.status, body: await r.json() };
    };
    expect((await (await app.request("/api/auth/signup")).json()).invite).toBe(false);
    const first = await post("/auth/register", { name: "admin", password: "abcdef" });
    expect(first.status).toBe(200);
    const admin = first.headers.get("set-cookie")!.split(";")[0];
    expect((await (await app.request("/api/auth/signup")).json()).invite).toBe(true);
    // Without an invite, or with one that doesn't exist, nobody else gets in.
    expect(
      (await post("/auth/register", { name: "a", password: "abcdef" })).status,
    ).toBe(400);
    expect(
      (await post("/auth/register", { name: "a", password: "abcdef", invite: "NOPE-NOPE" }))
        .status,
    ).toBe(403);
    const made = await post("/admin/invites", { count: 2 }, admin);
    const [one, two] = (await made.json()) as { code: string }[];
    expect(one.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    // A failed sign-up leaves the invite; a lowercase, undashed one still works, once.
    expect(
      (await post("/auth/register", { name: "admin", password: "abcdef", invite: one.code }))
        .status,
    ).toBe(409);
    const typed = one.code.toLowerCase().replace("-", " ");
    const member = await post("/auth/register", { name: "a", password: "abcdef", invite: typed });
    expect(member.status).toBe(200);
    const memberCookie = member.headers.get("set-cookie")!.split(";")[0];
    expect(
      (await post("/auth/register", { name: "b", password: "abcdef", invite: one.code }))
        .status,
    ).toBe(403);
    // Only those who manage accounts see and change invites.
    expect((await call(memberCookie, "/admin/invites")).status).toBe(403);
    expect((await post("/admin/invites", {}, memberCookie)).status).toBe(403);
    const list = (await call(admin, "/admin/invites")).body;
    expect(list).toHaveLength(2);
    expect(list.find((i: { code: string }) => i.code === one.code)).toMatchObject({
      createdBy: "admin",
      usedBy: { name: "a" },
    });
    expect(list.find((i: { code: string }) => i.code === two.code).usedBy).toBeNull();
    // A used invite stays as a record; an unused one can be withdrawn.
    expect((await call(admin, "/admin/invites/" + one.code, "DELETE")).status).toBe(409);
    expect((await call(admin, "/admin/invites/" + two.code, "DELETE")).status).toBe(200);
    expect(
      (await post("/auth/register", { name: "b", password: "abcdef", invite: two.code }))
        .status,
    ).toBe(403);
    expect((await call(admin, "/admin/invites")).body).toHaveLength(1);
  });
});
describe("exported pages", () => {
  it("carries detail pictures inside the file, inked in the colour their address asks for", async () => {
    const { app } = createApp(db);
    const r = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "exporter", password: "abcdef" }),
    });
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    const store = db.scoped(((await r.json()) as { id: string }).id),
      work = createWork(store, "export"),
      content = fixture();
    store.commit({ ...store.work(work.id), brief: content.brief }, 1, { kind: "edit" });
    await writeWork(
      store,
      work.id,
      {
        drawings: Object.values(content.drawings),
        ...workEdit(content),
        details: [
          ...Object.values(content.details),
          {
            id: "icons",
            title: "icons",
            html: `<img src="/materials/files/line-activity"><img src="/materials/files/line-activity?color=%23ff0000"><img src="/materials/files/line-activity?wait=0&amp;color=%2300aa00">`,
          },
        ],
      }, { cause: { kind: "edit" } });
    const page = await (
      await app.request(`/api/works/${work.id}/scenes/root/page`, { headers: { cookie } })
    ).text();
    const data = JSON.parse(page.match(/window\.drawyData=(\{.*?\});\n/)![1]);
    const sources = [...(data.work.details.icons.html as string).matchAll(/src="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(sources).toHaveLength(3);
    // Each is a whole SVG with nothing after it, inked as its address asked.
    const svgs = sources.map((s) => {
      expect(s).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
      return decodeURIComponent(s.slice(s.indexOf(",") + 1));
    });
    for (const svg of svgs) expect(svg.trimEnd()).toMatch(/<\/svg>$/);
    expect(svgs[0]).toContain("currentColor");
    expect(svgs[1]).toContain("#ff0000");
    expect(svgs[2]).toContain("#00aa00");
  });
});

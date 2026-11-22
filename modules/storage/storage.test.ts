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
/** Calls the API as whoever `cookie` signs in: the status, the body read, and the cookie set. */
const caller =
  (app: ReturnType<typeof createApp>["app"]) =>
  async (cookie: string, path: string, method = "GET", body?: object) => {
    const r = await app.request("/api" + path, {
      method,
      headers: { cookie, "Content-Type": "application/json" },
      body: body && JSON.stringify(body),
    });
    return {
      status: r.status,
      body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text(),
      cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  };
/** Signs an account up over HTTP: who it is, and the cookie it is signed in with. */
const signup = async (call: ReturnType<typeof caller>, name: string) => {
  const r = await call("", "/auth/register", "POST", { name, password: "abcdef", invite: invite() });
  return { ...(r.body as { id: string; role: string }), cookie: r.cookie };
};
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
  it("keeps the version of library code a work took, through every later write", async () => {
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
    expect(sourceOf(first).version).toBe(1);
    // As if taken from an earlier version of the library.
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
    // A library update reaches a work only when it takes the material again on purpose:
    // writing something else leaves the code it holds as it is.
    expect(sourceOf(next).source).toBe("return api.svg('<svg/>')");
    expect(sourceOf(store.revision(work.id, 4)).source).toBe(
      "return api.svg('<svg/>')",
    );
    // An already-held library drawing referenced indirectly through a variable stays across
    // unrelated edits, while an arbitrary module data string never auto-imports a library drawing.
    const { work: indirect } = await writeWork(
      store,
      work.id,
      {
        drawings: [{ id: "x", name: "x", source: 'const kind = "steps"; return api.draw(kind)' }],
        modules: [{ id: "m1", label: "m1", bounds: [0, 0, 40, 40], drawingId: "x", data: { glyph: "gauge" } }],
      },
      { cause: { kind: "edit" } },
    );
    expect(indirect.materials.steps?.kind).toBe("drawing");
    expect(indirect.materials.gauge).toBeUndefined();
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
  it("keeps undo moving backward after undoing twice and restoring the revision an undo made", async () => {
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
    // Going back to the revision the first undo saved stays inside the same restore group.
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
    const call = caller(createApp(db).app);
    const alice = await signup(call, "alice"),
      bob = await signup(call, "bob");
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
    const send = (cookie: string, body: object) => call(cookie, `/works/${work.id}/edits`, "POST", body);
    const edit = {
      baseRevision: saved.revision,
      edit: moveParts(saved, "root", [{ id: m.id, bounds: { ...m.bounds, x: 901 } }]),
    };
    expect((await send(bob.cookie, edit)).status).toBe(404);
    const r = await send(alice.cookie, edit);
    expect(r.status).toBe(200);
    const moved = r.body as Work;
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
    expect(store.revisions(work.id)[0].cause).toEqual({ kind: "edit" });
    expect(store.progress(work.id)).toMatchObject({ version: 1, unsaved: 1 });
    const save = (cookie: string) => call(cookie, `/works/${work.id}/save`, "POST");
    expect((await save(bob.cookie)).status).toBe(404);
    const kept = await save(alice.cookie);
    expect(kept.status).toBe(200);
    expect((kept.body as Work).scenes).toEqual(moved.scenes);
    expect(store.progress(work.id)).toMatchObject({ version: 2 });
    expect(store.progress(work.id).unsaved).toBeUndefined();
    // With nothing left to save, saving says so.
    expect((await save(alice.cookie)).status).not.toBe(200);
    // A hand edit is a step of its own: undoing it leaves the author's drawing.
    const undone = undo(store, work.id);
    expect(undone.scenes).toEqual(saved.scenes);
    // While the author is at work, nothing changes the drawing by hand.
    store.saveRun({ id: "r", workId: work.id, sceneId: "root", status: "running", startedAt: 1, steps: [], observations: [] });
    for (const [path, body] of [
      ["edits", { ...edit, baseRevision: undone.revision }],
      ["save", undefined],
      ["undo", undefined],
      ["restore", { revision: 1 }],
    ] as const)
      expect((await call(alice.cookie, `/works/${work.id}/${path}`, "POST", body)).status).toBe(409);
    expect(store.work(work.id).revision).toBe(undone.revision);
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
        }, { cause: { kind: "run", runId: "r", prompt: "p" } }),
    ).rejects.toThrow("set_brief");
    a.commit({ ...a.work(work.id), brief: content.brief }, 1, { kind: "edit" });
    const theirs = await client.ingest(
      await picture(),
      "image/png",
      {
        type: "object",
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
      // A pack picture is addressed at the version the work took.
        url: "/materials/files/apple?v=1",
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
        type: "object",
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
});
describe("over HTTP, by role", () => {
  it("lets the first account set the app up, admits each later one with an unused invite, and keeps it signed in until it signs out", async () => {
    const { app } = createApp(db),
      call = caller(app);
    expect((await call("", "/auth/signup")).body.invite).toBe(false);
    const first = await call("", "/auth/register", "POST", { name: "admin", password: "abcdef" });
    expect(first.status).toBe(200);
    const admin = first.cookie;
    expect((await call("", "/auth/signup")).body.invite).toBe(true);
    // Without an invite, or with one that doesn't exist, nobody else gets in.
    const join = (name: string, invite?: string) =>
      call("", "/auth/register", "POST", { name, password: "abcdef", invite });
    expect((await join("a")).status).toBe(400);
    expect((await join("a", "NOPE-NOPE")).status).toBe(403);
    const [one, two] = (await call(admin, "/admin/invites", "POST", { count: 2 })).body as { code: string }[];
    expect(one.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    // A failed sign-up leaves the invite; a lowercase, undashed one still works, once.
    expect((await join("admin", one.code)).status).toBe(409);
    const member = await join("a", one.code.toLowerCase().replace("-", " "));
    expect(member.status).toBe(200);
    expect((await join("b", one.code)).status).toBe(403);
    // Only those who manage accounts see and change invites.
    expect((await call(member.cookie, "/admin/invites")).status).toBe(403);
    expect((await call(member.cookie, "/admin/invites", "POST", {})).status).toBe(403);
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
    expect((await join("b", two.code)).status).toBe(403);
    expect((await call(admin, "/admin/invites")).body).toHaveLength(1);
    // Signed out, the session no longer reads anything; a wrong password does not sign in.
    expect((await call(member.cookie, "/works")).status).toBe(200);
    await call(member.cookie, "/auth/logout", "POST");
    expect((await call(member.cookie, "/works")).status).toBe(401);
    expect((await call("", "/works")).status).toBe(401);
    expect(() => login(db, "a", "wrong")).toThrow();
  });
  it("lets an administrator set models, labels, roles, allowances and the public shelf, while a member keeps to their own works and picks a label", async () => {
    const { app } = createApp(db),
      call = caller(app);
    const admin = await signup(call, "admin"),
      member = await signup(call, "member"),
      bob = await signup(call, "bob");
    expect([admin.role, member.role]).toEqual(["admin", "member"]);
    // A work is its owner's alone, on reads, scene rendering and changes.
    const w = (await call(member.cookie, "/works", "POST", { title: "private" })).body;
    for (const [path, method, body] of [
      ["", "GET"],
      ["/scenes/root", "GET"],
      ["/restore", "POST", { revision: 1 }],
      ["", "DELETE"],
    ] as const)
      expect((await call(bob.cookie, "/works/" + w.id + path, method, body)).status).toBe(404);
    expect((await call(member.cookie, "/works/" + w.id)).status).toBe(200);
    // Those who manage accounts read anyone's works and runs, for the run records; others
    // cannot, whoever they name.
    const of = "?account=" + member.id;
    expect((await call(admin.cookie, "/works" + of)).body.map((x: Work) => x.title)).toContain("private");
    expect((await call(admin.cookie, "/works/" + w.id + of)).body.title).toBe("private");
    expect((await call(admin.cookie, "/works/" + w.id)).status).toBe(404);
    expect((await call(admin.cookie, "/traces" + of)).body).toEqual([]);
    expect((await call(admin.cookie, "/works?account=nobody")).status).toBe(404);
    expect((await call(bob.cookie, "/works" + of)).status).toBe(403);
    expect((await call(bob.cookie, "/works/" + w.id + of)).status).toBe(403);
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
    const models = (labels: object[]) =>
      call(admin.cookie, "/admin/models", "PUT", {
        ...catalog,
        writers: [...catalog.writers, quick],
        labels,
        defaults: { ...catalog.defaults, label: "fast" },
      });
    expect((await models([...labels, { ...labels[0], id: "broken", writer: "missing" }])).status).toBe(400);
    expect((await models(labels)).status).toBe(200);
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
    expect((await call(member.cookie, "/admin/accounts/" + member.id, "PATCH", { quota: 99 })).status).toBe(403);
    expect((await call(admin.cookie, "/admin/accounts/" + member.id, "PATCH", { quota: 1 })).body).toMatchObject({
      quota: 1,
      role: "member",
    });
    db.spendQuota(member.id);
    expect(() => db.spendQuota(member.id)).toThrow("提问次数已用完");
    db.refundQuota(member.id);
    expect(db.account(member.id).quota).toBe(1);
    db.setQuota(member.id, 0);
    const run = (sceneId: string) =>
      call(member.cookie, "/works/" + w.id + "/runs", "POST", { prompt: "draw", sceneId });
    expect((await run(w.rootSceneId)).status).toBe(403);
    // A request that cannot start gives its allowance back.
    db.setQuota(member.id, 1);
    expect((await run("nowhere")).status).toBe(404);
    expect(db.account(member.id).quota).toBe(1);
    // The list of works says where each has got to.
    expect((await call(member.cookie, "/works")).body[0].progress).toEqual({
      run: null,
      prompt: "",
      version: 0,
      blank: true,
    });
    // A member's pictures are on their own shelf; those who see all materials see them
    // under the member's name, with the model that made them, which the member is not told.
    const made = await client.ingest(
      await picture(),
      "image/png",
      {
        type: "object",
        name: { zh: "生成图", en: "Generated picture" },
        style: null,
        origin: { kind: "generated", model: "image-model", prompt: "A red square" },
      },
      member.id,
    );
    const { model, ...unnamed } = made.origin as typeof made.origin & { model: string };
    expect(model).toBe("image-model");
    const shelf = async (cookie: string, on: string) => {
      const r = await call(cookie, `/materials?kind=picture&size=200&shelf=${on}`);
      return r.status === 200 ? (r.body.items as { id: string; ownerName?: string; origin: object }[]) : r.status;
    };
    const ids = (items: Awaited<ReturnType<typeof shelf>>) =>
      typeof items === "number" ? items : items.map((m) => m.id);
    expect(await shelf(member.cookie, "mine")).toEqual([expect.objectContaining({ id: made.id, origin: unnamed })]);
    expect((await call(member.cookie, "/materials/" + made.id)).body.origin).toEqual(unnamed);
    expect(ids(await shelf(member.cookie, "public"))).not.toContain(made.id);
    expect(ids(await shelf(bob.cookie, "mine"))).toEqual([]);
    expect(await shelf(bob.cookie, "others")).toBe(400);
    expect(await shelf(admin.cookie, "others")).toEqual([
      expect.objectContaining({ id: made.id, ownerName: "member", origin: made.origin }),
    ]);
    expect((await call(admin.cookie, "/materials/" + made.id)).body.origin).toEqual(made.origin);
    // The picture file itself follows the same rule.
    const file = (cookie: string) => app.request("/materials/files/" + made.id, { headers: { cookie } });
    expect((await file(bob.cookie)).status).toBe(404);
    expect((await file(admin.cookie)).status).toBe(200);
    // Those who manage materials publish it, for everyone, and give it back.
    const publish = (cookie: string, published: boolean) =>
      call(cookie, `/materials/${made.id}/publish`, "POST", { published });
    expect((await publish(member.cookie, true)).status).toBe(403);
    expect((await publish(admin.cookie, true)).status).toBe(200);
    expect(ids(await shelf(bob.cookie, "public"))).toContain(made.id);
    expect((await file(bob.cookie)).status).toBe(200);
    expect((await publish(admin.cookie, false)).status).toBe(200);
    expect(ids(await shelf(member.cookie, "mine"))).toEqual([made.id]);
    // Managing materials alone does not tell the model, on publishing either.
    db.saveRole({ id: "librarian", name: "Librarian", permissions: ["materials.manage"], builtin: false });
    db.setRole(member.id, "librarian");
    const published = await publish(member.cookie, true);
    expect(published.status).toBe(200);
    expect(published.body.origin).toEqual(unnamed);
    expect((await shelf(member.cookie, "public") as { id: string; origin: object }[]).find((m) => m.id === made.id)!.origin).toEqual(unnamed);
    // The library itself keeps where it came from.
    expect((await client.get([made.id], { id: member.id }))[0].origin).toEqual(made.origin);
    // A role that manages models makes its accounts able to, and to see the model.
    const editors = await call(admin.cookie, "/admin/roles", "POST", { name: "Model editors", permissions: ["models.manage"] });
    expect((await call(admin.cookie, "/admin/accounts/" + member.id, "PATCH", { role: editors.body.id })).body).toMatchObject({
      role: editors.body.id,
      permissions: ["models.manage"],
    });
    expect((await call(member.cookie, "/admin/models")).status).toBe(200);
    expect((await call(member.cookie, "/admin/roles")).status).toBe(403);
    expect((await call(member.cookie, "/materials/" + made.id)).body.origin).toEqual(made.origin);
    // Built-in roles stay; the last administrator stays one.
    expect((await call(admin.cookie, "/admin/roles/admin", "PUT", { name: "x", permissions: [] })).status).toBe(409);
    expect((await call(admin.cookie, "/admin/roles/member", "DELETE")).status).toBe(409);
    expect((await call(admin.cookie, "/admin/accounts/" + admin.id, "PATCH", { role: "member" })).status).toBe(409);
    // Removing a role makes its accounts members again.
    await call(admin.cookie, "/admin/roles/" + editors.body.id, "DELETE");
    expect((await call(member.cookie, "/auth/me")).body).toMatchObject({ role: "member", permissions: [] });
  });
});
describe("exported pages", () => {
  it("carries detail pictures inside the file, inked in the colour their address asks for", async () => {
    const call = caller(createApp(db).app);
    const { id, cookie } = await signup(call, "exporter");
    const store = db.scoped(id),
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
    const page = (await call(cookie, `/works/${work.id}/scenes/root/page`)).body as string;
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

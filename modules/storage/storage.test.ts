import { fixture } from "../runtime/fixture.ts";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "./index.ts";
import { createWork, writeWork, restore, undo } from "../workspace/index.ts";
import { moveParts } from "../editing/index.ts";
import {
  defaultSettings,
  settingsSchema,
  type Work,
} from "../contracts/index.ts";
import { register, login } from "../identity/index.ts";
import { createApp } from "../../apps/server/app.ts";
import { serveLibrary, picture } from "@drawy/materials/testing";
import { library as client } from "../materials/index.ts";
let dir: string, db: Storage, library: ReturnType<typeof serveLibrary>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "drawy-test-"));
  db = new Storage(dir);
  library = serveLibrary(client.base);
});
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
    a.saveOwnSettings({ preferences: "blue", model: null });
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
  it("moves the first account's own connection into the shared models, keeping the Fast switch as a speed", () => {
    for (const [fast, speed] of [
      [true, "fast"],
      [false, "default"],
    ] as const) {
      const at = mkdtempSync(join(tmpdir(), "drawy-old-"));
      let old = new Storage(at);
      const first = register(old, "first", "abcdef"),
        second = register(old, "second", "abcdef");
      const { speed: _, ...author } = defaultSettings().author;
      const saved = (user: string, credential: string) =>
        old.db.prepare("INSERT OR REPLACE INTO settings VALUES(?,?)").run(
          user,
          JSON.stringify({
            author: { ...author, credential, fast },
            image: { ...defaultSettings().image, credential },
            preferences: "mine " + credential,
          }),
        );
      saved(first.id, "key-1");
      saved(second.id, "key-2");
      // As before roles and shared models existed.
      old.db.exec("DELETE FROM system; UPDATE users SET role='member'");
      old.close();
      old = new Storage(at);
      try {
        expect(old.account(first.id).role).toBe("admin");
        expect(old.account(second.id).role).toBe("member");
        const catalog = old.models();
        expect(catalog.models).toHaveLength(1);
        expect(catalog.models[0]).toMatchObject({
          credential: "key-1",
          speed,
        });
        expect(catalog.image.credential).toBe("key-1");
        const store = old.scoped(second.id);
        expect(store.settings().author.credential).toBe("key-1");
        expect(store.settings().preferences).toBe("mine key-2");
      } finally {
        old.close();
        rmSync(at, { recursive: true });
      }
    }
  });
  it("saves a speed the connection lacks as default", () => {
    const settings = settingsSchema.parse({
      ...defaultSettings(),
      author: { ...defaultSettings().author, channel: "oauth", speed: "flex" },
    });
    expect(settings.author.speed).toBe("default");
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
        baseRevision: 2,
        drawings: Object.values(content.drawings),
        scenes: Object.values(content.scenes),
        details: Object.values(content.details),
        interactions: Object.values(content.interactions),
      },
      { kind: "edit" },
    );
    expect(saved.revision).toBe(3);
    const changed = {
      ...saved.drawings.tier,
      source: "return api.svg('<svg/>');",
    };
    const { work: edited } = await writeWork(
      store,
      work.id,
      {
        baseRevision: 3,
        drawings: [changed],
      },
      { kind: "edit" },
    );
    expect(edited.scenes).toEqual(saved.scenes);
    expect(edited.drawings.tier).toEqual(changed);
    await expect(
      writeWork(
        store,
        work.id,
        { baseRevision: 3, title: "stale" },
        { kind: "edit" },
      ),
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
        baseRevision: 2,
        drawings: [{ id: "x", name: "x", source: 'return api.draw("steps")' }],
      },
      { kind: "edit" },
    );
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
      { baseRevision: 4, title: "renamed" },
      { kind: "edit" },
    );
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
        baseRevision: 2,
        drawings: Object.values(content.drawings),
        scenes: Object.values(content.scenes),
        details: Object.values(content.details),
        interactions: Object.values(content.interactions),
      },
      run("r1"),
    );
    // A second request saves two drafts; undo takes back both.
    await writeWork(store, work.id, { baseRevision: 3, title: "a" }, run("r2"));
    await writeWork(store, work.id, { baseRevision: 4, title: "b" }, run("r2"));
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
        baseRevision: 2,
        drawings: Object.values(content.drawings),
        scenes: Object.values(content.scenes),
        details: Object.values(content.details),
        interactions: Object.values(content.interactions),
      },
      { kind: "edit" },
    );
    await expect(
      writeWork(
        store,
        work.id,
        {
          baseRevision: 3,
          remove: { drawings: ["tier"] },
        },
        { kind: "edit" },
      ),
    ).rejects.toThrow("画法");
    await expect(
      writeWork(
        store,
        work.id,
        {
          baseRevision: 3,
          scenes: [{ ...content.scenes.child, parentId: "child" }],
        },
        { kind: "edit" },
      ),
    ).rejects.toThrow("循环");
    await expect(
      writeWork(
        store,
        work.id,
        {
          baseRevision: 3,
          scenes: [{ ...content.scenes.child, parentId: "missing" }],
        },
        { kind: "edit" },
      ),
    ).rejects.toThrow("父场景");
    await expect(
      writeWork(
        store,
        work.id,
        {
          baseRevision: 3,
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
        },
        { kind: "edit" },
      ),
    ).rejects.toThrow("锚点");
    const { work: cleared } = await writeWork(
      store,
      work.id,
      {
        baseRevision: 3,
        scenes: [{ ...content.scenes.root, modules: [], checks: [] }],
        remove: { drawings: ["tier"] },
      },
      { kind: "edit" },
    );
    expect(cleared.revision).toBe(4);
    expect(cleared.drawings.tier).toBeUndefined();
  });
  it("commits a hand edit from the canvas as a revision of its own, changing only what it names", async () => {
    const { app } = createApp(db);
    const signup = async (name: string) => {
      const r = await app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password: "abcdef" }),
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
        baseRevision: 2,
        drawings: Object.values(content.drawings),
        scenes: Object.values(content.scenes),
        details: Object.values(content.details),
        interactions: Object.values(content.interactions),
      },
      { kind: "run", runId: "r", prompt: "draw" },
    );
    const m = saved.scenes.root.modules[0];
    const send = (cookie: string, body: object) =>
      app.request(`/api/works/${work.id}/edits`, {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const edit = moveParts(saved, "root", [
      { id: m.id, bounds: { ...m.bounds, x: 901 } },
    ]);
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
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      anchors: {},
      group: null,
      target: null,
    };
    await expect(
      writeWork(
        a,
        work.id,
        {
          baseRevision: 1,
          drawings: [fruit],
          scenes: [
            {
              ...content.scenes.root,
              modules: [module],
              links: [],
              checks: [],
              interactionId: null,
            },
          ],
        },
        { kind: "edit" },
      ),
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
        { baseRevision: 2, materials: [theirs.id] },
        { kind: "edit" },
      ),
    ).rejects.toThrow();
    // One whose role sees all materials may use it.
    const theirsToo = createWork(admin, "admin's");
    admin.commit({ ...admin.work(theirsToo.id), brief: content.brief }, 1, {
      kind: "edit",
    });
    const { added: taken } = await writeWork(
      admin,
      theirsToo.id,
      { baseRevision: 2, materials: [theirs.id] },
      { kind: "edit" },
    );
    expect(taken).toEqual([theirs.id]);
    const { work: saved, added } = await writeWork(
      a,
      work.id,
      {
        baseRevision: 2,
        drawings: [fruit],
        scenes: [
          {
            ...content.scenes.root,
            modules: [module],
            links: [],
            checks: [],
            interactionId: null,
          },
        ],
      },
      { kind: "edit" },
    );
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
          baseRevision: saved.revision,
          drawings: [
            { ...fruit, source: 'return api.material("no-such-thing")' },
          ],
        },
        { kind: "edit" },
      ),
    ).rejects.toThrow("no-such-thing");
    // A module drawn by a library drawing as it is takes that drawing in; a picture is
    // not a drawing.
    const { work: plotted } = await writeWork(
      a,
      work.id,
      {
        baseRevision: saved.revision,
        scenes: [
          {
            ...content.scenes.root,
            modules: [
              module,
              { ...module, id: "wave", drawingId: "waves", data: {} },
            ],
            links: [],
            checks: [],
            interactionId: null,
          },
        ],
      },
      { kind: "edit" },
    );
    expect(plotted.materials.waves).toMatchObject({ kind: "drawing" });
    await expect(
      writeWork(
        a,
        work.id,
        {
          baseRevision: plotted.revision,
          scenes: [
            {
              ...content.scenes.root,
              modules: [{ ...module, drawingId: "apple" }],
              links: [],
              checks: [],
              interactionId: null,
            },
          ],
        },
        { kind: "edit" },
      ),
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
describe("roles and shared models", () => {
  it("lets the first account administer models, materials and roles, and others only pick", async () => {
    const { app } = createApp(db);
    const signup = async (name: string) => {
      const r = await app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password: "abcdef" }),
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
    // Members see the models by name only, and cannot manage anything.
    const seen = await call(member.cookie, "/models");
    expect(seen.body).toEqual({
      models: [
        { id: "default", name: "gpt-6-astra", description: "", ready: false },
      ],
      default: "default",
      chosen: "default",
    });
    for (const path of ["/admin/models", "/admin/accounts", "/admin/roles"])
      expect((await call(member.cookie, path)).status).toBe(403);
    // The administrator connects two models; members pick one, which their runs use.
    const catalog = (await call(admin.cookie, "/admin/models")).body;
    const fast = {
      ...catalog.models[0],
      id: "quick",
      name: "Quick",
      description: "For small changes",
      credential: "key",
      effort: "low",
    };
    expect(
      (
        await call(admin.cookie, "/admin/models", "PUT", {
          ...catalog,
          models: [...catalog.models, fast],
          default: "missing",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(admin.cookie, "/admin/models", "PUT", {
          ...catalog,
          models: [...catalog.models, fast],
        })
      ).status,
    ).toBe(200);
    await call(member.cookie, "/settings", "PUT", {
      preferences: "",
      model: "quick",
    });
    expect((await call(member.cookie, "/models")).body.chosen).toBe("quick");
    expect(db.scoped(member.id).settings().author).toMatchObject({
      credential: "key",
      effort: "low",
    });
    expect(db.scoped(admin.id).settings().author.credential).toBe("");
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
  it("shelves materials apart and lets those who manage them publish", async () => {
    const { app } = createApp(db);
    const signup = async (name: string) => {
      const r = await app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password: "abcdef" }),
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

import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "./index.ts";
import { createWork, writePages, restore } from "../workspace/index.ts";
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
      pageId: "root",
      status: "waiting",
      startedAt: 1,
      messages: [],
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
  it("commits atomically and restores a snapshot as a new revision", () => {
    const s = db.scoped(register(db, "a", "abcdef").id),
      w = createWork(s, "test");
    const p = { ...w.pages.root, html: "<h1>one</h1>" };
    const next = writePages(s, w.id, [p], 1);
    expect(next.revision).toBe(2);
    expect(() => writePages(s, w.id, [{ ...p, html: "bad" }], 1)).toThrow(
      "版本",
    );
    expect(s.work(w.id).pages.root.html).toBe(p.html);
    expect(restore(s, w.id, 1).revision).toBe(3);
    expect(s.work(w.id).pages.root.html).toBe("");
    expect(s.revision(w.id, 2).pages.root.html).toBe(p.html);
  });
  it("rejects cycles, missing parents and another user asset before changing data", () => {
    const a = db.scoped(register(db, "a", "abcdef").id),
      b = db.scoped(register(db, "b", "abcdef").id),
      w = createWork(a, "test");
    const p = { ...w.pages.root, id: "child", parentId: "child" };
    expect(() => writePages(a, w.id, [p], 1)).toThrow("循环");
    const asset = b.putAsset(new Uint8Array([1]), "x", "image/png");
    expect(() =>
      writePages(a, w.id, [{ ...w.pages.root, assetIds: [asset.id] }], 1),
    ).toThrow();
    expect(a.work(w.id).revision).toBe(1);
  });
  it("retains saved content and suspended conversation across reopening", () => {
    const uid = register(db, "a", "abcdef").id,
      s = db.scoped(uid),
      w = createWork(s, "persist");
    s.saveRun({
      id: "waiting",
      workId: w.id,
      pageId: "root",
      status: "waiting",
      startedAt: 0,
      messages: [],
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
  it("uses session ownership on reads, page rendering and mutations", async () => {
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
      (await request("/api/works/" + w.id + "/pages/root", b)).status,
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

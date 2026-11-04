import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { linkEnds } from "../contracts/geometry.ts";
import { validateWork } from "../workspace/index.ts";
import { Storage } from "./index.ts";
import { upgradeWork, WORK_FORMAT, type OldWork } from "./upgrade.ts";

/** A work as it was saved before links held their own ends and scenes their own scripts. */
const old = (): OldWork =>
  ({
    id: "w",
    title: "旧作品",
    rootSceneId: "root",
    revision: 3,
    updatedAt: 1,
    named: true,
    drawings: { box: { id: "box", name: "框", source: "return api.svg('<svg/>')" } },
    scenes: {
      root: {
        id: "root",
        title: "根",
        parentId: null,
        interactionId: "script",
        checks: [{ moduleId: "a", selector: "button" }],
        modules: [
          {
            id: "a",
            label: "甲",
            bounds: { x: 0, y: 0, width: 100, height: 100 },
            drawingId: "box",
            group: null,
            target: null,
            anchors: { right: { x: 1, y: 0.5 }, stem: { x: 0.25, y: 0.75 }, near: { x: 0.03, y: 0.3 } },
            data: { text: "甲" },
          },
          {
            id: "b",
            label: "乙的名字",
            bounds: { x: 300, y: 0, width: 100, height: 100 },
            drawingId: "box",
            group: "g",
            target: { kind: "detail", id: "d" },
            anchors: { left: { x: 0, y: 0.5 } },
            data: { text: "乙" },
          },
        ],
        links: [
          { id: "side", drawingId: "box", from: { moduleId: "a", anchor: "right" }, to: { moduleId: "b", anchor: "left" }, data: {} },
          { id: "point", drawingId: "box", from: { moduleId: "a", anchor: "stem" }, to: { moduleId: "b", anchor: "left" }, data: { color: "#000" } },
          { id: "near", drawingId: "box", from: { moduleId: "a", anchor: "near" }, to: { moduleId: "b", anchor: "left" }, data: {} },
          { id: "lost", drawingId: "box", from: { moduleId: "a", anchor: "gone" }, to: { moduleId: "b", anchor: "left" }, data: {} },
        ],
      },
    },
    interactions: { script: { id: "script", source: "api.on('a','x',()=>{})" } },
    details: { d: { id: "d", title: "详情", html: "<p>x</p>" } },
    brief: null,
    materials: {},
    style: { ink: "#111" },
  }) as unknown as OldWork;

describe("a saved work brought to today's form", () => {
  it("draws exactly what it drew", () => {
    const before = old();
    const after = upgradeWork(before);
    validateWork(after);
    const scene = after.scenes.root;
    expect(scene.links.map((l) => l.from.at)).toEqual(["right", [0.25, 0.75], [0.03, 0.3], [0.5, 0.5]]);
    expect(scene.links[0].to).toEqual({ moduleId: "b", at: "left" });
    // Every end lands where its anchor put it, on the same side.
    const box = (id: string) => scene.modules.find((m) => m.id === id)!.bounds;
    expect(linkEnds(scene.links[1], box).from).toEqual({ x: 25, y: 75, side: null });
    expect(linkEnds(scene.links[2], box).from).toEqual({ x: 3, y: 30, side: "left" });
    expect(linkEnds(scene.links[3], box).from).toEqual({ x: 50, y: 50, side: null });
    expect(scene.interaction).toBe("api.on('a','x',()=>{})");
    expect(after).not.toHaveProperty("interactions");
    expect(scene).not.toHaveProperty("interactionId");
  });
  it("keeps every name and setting that means something, and drops only what repeats", () => {
    const [a, b] = upgradeWork(old()).scenes.root.modules;
    expect(a).toEqual({ id: "a", bounds: { x: 0, y: 0, width: 100, height: 100 }, drawingId: "box", data: { text: "甲" } });
    expect(b).toEqual({
      id: "b",
      label: "乙的名字",
      bounds: { x: 300, y: 0, width: 100, height: 100 },
      drawingId: "box",
      group: "g",
      target: { kind: "detail", id: "d" },
      data: { text: "乙" },
    });
    expect(upgradeWork(old())).toMatchObject({ title: "旧作品", named: true, revision: 3 });
  });
});

describe("opening a database from before", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "drawy-upgrade-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  /** A database as the last version left it, with one work in two revisions. */
  function saved(work: unknown = old()) {
    const db = new Storage(dir);
    db.db.exec("PRAGMA user_version=1");
    db.db.prepare("INSERT INTO users(id,name,password) VALUES('u','n','p')").run();
    const json = JSON.stringify(work);
    db.db.prepare("INSERT INTO works VALUES('u','w',?)").run(json);
    for (const n of [2, 3])
      db.db.prepare("INSERT INTO revisions(user_id,work_id,revision,data,cause) VALUES('u','w',?,?,?)").run(n, json, '{"kind":"edit"}');
    db.close();
  }
  it("upgrades the work and all its revisions, keeping a copy as it was", () => {
    saved();
    const db = new Storage(dir);
    const store = db.scoped("u");
    expect(store.work("w").scenes.root.links[0].from).toEqual({ moduleId: "a", at: "right" });
    expect(store.revision("w", 2).scenes.root.interaction).toBe("api.on('a','x',()=>{})");
    expect(store.revisions("w").map((r) => r.revision)).toEqual([3, 2]);
    const format = () => (db.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    expect(format()).toBe(WORK_FORMAT);
    db.close();
    const copy = join(dir, "backups", "drawy-format-1.sqlite");
    expect(existsSync(copy)).toBe(true);
    const kept = new DatabaseSync(copy, { readOnly: true });
    const row = kept.prepare("SELECT data FROM works").get() as { data: string };
    expect(JSON.parse(row.data).scenes.root.links[0].from.anchor).toBe("right");
    kept.close();
    // Opening it again changes nothing.
    const again = new Storage(dir);
    expect(again.scoped("u").work("w").scenes.root.links[0].from).toEqual({ moduleId: "a", at: "right" });
    again.close();
    expect(readdirSync(join(dir, "backups"))).toEqual(["drawy-format-1.sqlite"]);
  });
  it("leaves everything as it was and does not start when a work cannot be read", () => {
    saved();
    const raw = new DatabaseSync(join(dir, "drawy.sqlite"));
    raw.prepare("UPDATE revisions SET data='{broken' WHERE revision=2").run();
    raw.close();
    expect(() => new Storage(dir)).toThrow(/作品数据升级失败（revisions w:2）/);
    const after = new DatabaseSync(join(dir, "drawy.sqlite"));
    const row = after.prepare("SELECT data FROM works").get() as { data: string };
    expect(JSON.parse(row.data).scenes.root.links[0].from.anchor).toBe("right");
    expect((after.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(1);
    after.close();
  });
  it("starts an empty database at the current format with no copy", () => {
    const db = new Storage(dir);
    expect((db.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(WORK_FORMAT);
    db.close();
    expect(existsSync(join(dir, "backups"))).toBe(false);
  });
});

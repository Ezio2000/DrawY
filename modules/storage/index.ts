import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  id,
  defaultSettings,
  DomainError,
  type Work,
  type Asset,
  type Settings,
  type Run,
} from "../contracts/index.ts";
export class Storage {
  db: DatabaseSync;
  dir: string;
  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(join(dir, "assets"), { recursive: true });
    this.db = new DatabaseSync(join(dir, "drawy.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS works(user_id TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(user_id,id));
 CREATE TABLE IF NOT EXISTS revisions(user_id TEXT NOT NULL,work_id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(user_id,work_id,revision));
 CREATE TABLE IF NOT EXISTS assets(user_id TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(user_id,id));
 CREATE TABLE IF NOT EXISTS settings(user_id TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS runs(user_id TEXT NOT NULL,id TEXT NOT NULL,work_id TEXT NOT NULL,data TEXT NOT NULL,context TEXT,PRIMARY KEY(user_id,id));`);
  }
  session(userId: string) {
    const token = id();
    this.db.prepare("INSERT INTO sessions VALUES(?,?)").run(token, userId);
    return token;
  }
  userFor(token: string) {
    return this.db
      .prepare(
        "SELECT users.id,users.name FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.id=?",
      )
      .get(token) as { id: string; name: string } | undefined;
  }
  scoped(userId: string) {
    return new UserStore(this, userId);
  }
  close() {
    this.db.close();
  }
}
export class UserStore {
  constructor(
    public storage: Storage,
    public userId: string,
  ) {}
  private one<T>(sql: string, ...args: (string | number)[]): T {
    const r = this.storage.db.prepare(sql).get(this.userId, ...args) as
      { data: string } | undefined;
    if (!r) throw new DomainError("资源不存在", 404);
    return JSON.parse(r.data);
  }
  works(): Work[] {
    return this.storage.db
      .prepare("SELECT data FROM works WHERE user_id=? ORDER BY rowid DESC")
      .all(this.userId)
      .map((r) => JSON.parse(r.data as string));
  }
  work(workId: string) {
    return this.one<Work>(
      "SELECT data FROM works WHERE user_id=? AND id=?",
      workId,
    );
  }
  commit(work: Work, base: number) {
    const db = this.storage.db;
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = db
        .prepare("SELECT data FROM works WHERE user_id=? AND id=?")
        .get(this.userId, work.id) as { data: string } | undefined;
      if ((existing ? JSON.parse(existing.data).revision : 0) !== base)
        throw new DomainError("作品版本已更新，请重新读取", 409);
      work = { ...work, revision: base + 1, updatedAt: Date.now() };
      const json = JSON.stringify(work);
      db.prepare(
        "INSERT INTO works VALUES(?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET data=excluded.data",
      ).run(this.userId, work.id, json);
      db.prepare("INSERT INTO revisions VALUES(?,?,?,?)").run(
        this.userId,
        work.id,
        work.revision,
        json,
      );
      db.exec("COMMIT");
      return work;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  revisions(workId: string) {
    this.work(workId);
    return this.storage.db
      .prepare(
        "SELECT revision,data FROM revisions WHERE user_id=? AND work_id=? ORDER BY revision DESC",
      )
      .all(this.userId, workId)
      .map((r) => ({
        revision: r.revision as number,
        updatedAt: JSON.parse(r.data as string).updatedAt,
      }));
  }
  revision(workId: string, revision: number) {
    return this.one<Work>(
      "SELECT data FROM revisions WHERE user_id=? AND work_id=? AND revision=?",
      workId,
      revision,
    );
  }
  delete(workId: string) {
    this.work(workId);
    const db = this.storage.db;
    db.exec("BEGIN");
    try {
      for (const table of ["runs", "revisions"])
        db.prepare(`DELETE FROM ${table} WHERE user_id=? AND work_id=?`).run(
          this.userId,
          workId,
        );
      db.prepare("DELETE FROM works WHERE user_id=? AND id=?").run(
        this.userId,
        workId,
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  settings(): Settings {
    const r = this.storage.db
      .prepare("SELECT data FROM settings WHERE user_id=?")
      .get(this.userId);
    return r ? JSON.parse(r.data as string) : defaultSettings();
  }
  saveSettings(value: Settings) {
    this.storage.db
      .prepare(
        "INSERT INTO settings VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data",
      )
      .run(this.userId, JSON.stringify(value));
  }
  asset(assetId: string) {
    return this.one<Asset>(
      "SELECT data FROM assets WHERE user_id=? AND id=?",
      assetId,
    );
  }
  bytes(assetId: string) {
    this.asset(assetId);
    return readFileSync(join(this.storage.dir, "assets", assetId));
  }
  assets(): Asset[] {
    return this.storage.db
      .prepare("SELECT data FROM assets WHERE user_id=?")
      .all(this.userId)
      .map((r) => JSON.parse(r.data as string));
  }
  putAsset(
    bytes: Uint8Array,
    name: string,
    mediaType: string,
    source: Asset["source"] = "upload",
    generationId?: string,
  ) {
    const assetId = id();
    const asset: Asset = {
      id: assetId,
      name,
      mediaType,
      size: bytes.length,
      source,
      url: `/api/assets/${assetId}`,
      generationId,
    };
    writeFileSync(join(this.storage.dir, "assets", assetId), bytes);
    this.storage.db
      .prepare("INSERT INTO assets VALUES(?,?,?)")
      .run(this.userId, assetId, JSON.stringify(asset));
    return asset;
  }
  saveRun(run: Run) {
    this.storage.db
      .prepare(
        "INSERT INTO runs(user_id,id,work_id,data) VALUES(?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET data=excluded.data",
      )
      .run(this.userId, run.id, run.workId, JSON.stringify(run));
  }
  run(runId: string) {
    return this.one<Run>(
      "SELECT data FROM runs WHERE user_id=? AND id=?",
      runId,
    );
  }
  runs(workId: string): Run[] {
    this.work(workId);
    return this.storage.db
      .prepare(
        "SELECT data FROM runs WHERE user_id=? AND work_id=? ORDER BY rowid",
      )
      .all(this.userId, workId)
      .map((r) => JSON.parse(r.data as string));
  }
  context(runId: string, value?: unknown) {
    this.run(runId);
    if (value !== undefined)
      this.storage.db
        .prepare("UPDATE runs SET context=? WHERE user_id=? AND id=?")
        .run(JSON.stringify(value), this.userId, runId);
    const row = this.storage.db
      .prepare("SELECT context FROM runs WHERE user_id=? AND id=?")
      .get(this.userId, runId);
    return row?.context ? JSON.parse(row.context as string) : null;
  }
}

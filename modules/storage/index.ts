import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  id,
  ADMIN,
  MEMBER,
  defaultCatalog,
  permissions,
  DomainError,
  type Account,
  type AccountRole,
  type ModelCatalog,
  type Permission,
  type UserSettings,
  type Work,
  type Capture,
  type Settings,
  type Run,
  type Cause,
  type RevisionSummary,
} from "../contracts/index.ts";
export class Storage {
  db: DatabaseSync;
  dir: string;
  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(join(dir, "captures"), { recursive: true });
    this.db = new DatabaseSync(join(dir, "drawy.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS works(user_id TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(user_id,id));
 CREATE TABLE IF NOT EXISTS revisions(user_id TEXT NOT NULL,work_id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(user_id,work_id,revision));
 CREATE TABLE IF NOT EXISTS captures(user_id TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(user_id,id));
 CREATE TABLE IF NOT EXISTS settings(user_id TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS runs(user_id TEXT NOT NULL,id TEXT NOT NULL,work_id TEXT NOT NULL,data TEXT NOT NULL,context TEXT,PRIMARY KEY(user_id,id));
 CREATE TABLE IF NOT EXISTS roles(id TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS system(key TEXT PRIMARY KEY,data TEXT NOT NULL);`);
    const columns = this.db.prepare("PRAGMA table_info(revisions)").all();
    if (!columns.some((c) => c.name === "cause")) this.recordCauses();
    this.recordRoles();
    if (!this.db.prepare("SELECT 1 FROM system WHERE key='models'").get())
      this.saveModels(this.firstCatalog());
  }
  /** Gives the app its two built-in roles and every account one: accounts made before
   * roles existed are members, except the first, who set the app up and administers it. */
  private recordRoles() {
    const db = this.db;
    const columns = db.prepare("PRAGMA table_info(users)").all();
    if (!columns.some((c) => c.name === "role"))
      db.exec(
        `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT '${MEMBER}'`,
      );
    const builtin: AccountRole[] = [
      {
        id: ADMIN,
        name: "管理员",
        permissions: [...permissions],
        builtin: true,
      },
      { id: MEMBER, name: "普通用户", permissions: [], builtin: true },
    ];
    for (const r of builtin)
      db.prepare("INSERT OR IGNORE INTO roles VALUES(?,?)").run(
        r.id,
        JSON.stringify(r),
      );
    if (!db.prepare("SELECT 1 FROM users WHERE role=?").get(ADMIN))
      db.prepare(
        "UPDATE users SET role=? WHERE rowid=(SELECT MIN(rowid) FROM users)",
      ).run(ADMIN);
  }
  /** The models the app starts with: those the first administrator had connected for
   * themselves, from when each account connected its own. */
  private firstCatalog(): ModelCatalog {
    const catalog = defaultCatalog();
    const row = this.db
      .prepare(
        "SELECT settings.data FROM settings JOIN users ON users.id=settings.user_id WHERE users.role=? ORDER BY users.rowid LIMIT 1",
      )
      .get(ADMIN) as { data: string } | undefined;
    const old = row && JSON.parse(row.data);
    if (!old?.author) return catalog;
    // Settings saved before speeds had a Fast switch instead.
    const { fast, ...author } = old.author;
    if (!author.speed) author.speed = fast ? "fast" : "default";
    return {
      models: [{ ...catalog.models[0], ...author, name: author.model }],
      default: catalog.default,
      image: old.image ?? catalog.image,
    };
  }
  models(): ModelCatalog {
    const row = this.db
      .prepare("SELECT data FROM system WHERE key='models'")
      .get() as { data: string };
    return JSON.parse(row.data);
  }
  saveModels(catalog: ModelCatalog) {
    this.db
      .prepare(
        "INSERT INTO system VALUES('models',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
      )
      .run(JSON.stringify(catalog));
  }
  /** Every role, built-in first. An administrator may always do everything, including
   * what later versions add. */
  roles(): AccountRole[] {
    return this.db
      .prepare("SELECT data FROM roles ORDER BY rowid")
      .all()
      .map((r) => JSON.parse(r.data as string) as AccountRole)
      .map((r) =>
        r.id === ADMIN ? { ...r, permissions: [...permissions] } : r,
      );
  }
  role(roleId: string) {
    const r = this.roles().find((r) => r.id === roleId);
    if (!r) throw new DomainError("角色不存在", 404);
    return r;
  }
  saveRole(role: AccountRole) {
    this.db
      .prepare(
        "INSERT INTO roles VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(role.id, JSON.stringify(role));
    return role;
  }
  deleteRole(roleId: string) {
    this.db.prepare("UPDATE users SET role=? WHERE role=?").run(MEMBER, roleId);
    this.db.prepare("DELETE FROM roles WHERE id=?").run(roleId);
  }
  account(userId: string): Account {
    const u = this.db
      .prepare("SELECT id,name,role FROM users WHERE id=?")
      .get(userId) as { id: string; name: string; role: string } | undefined;
    if (!u) throw new DomainError("账号不存在", 404);
    const role = this.roles().find((r) => r.id === u.role) ?? this.role(MEMBER);
    return {
      id: u.id,
      name: u.name,
      role: role.id,
      roleName: role.name,
      builtinRole: role.builtin,
      permissions: role.permissions,
    };
  }
  /** An account's name, for showing whose a material is; a removed one has none. */
  accountName(userId: string) {
    const u = this.db
      .prepare("SELECT name FROM users WHERE id=?")
      .get(userId) as { name: string } | undefined;
    return u?.name ?? null;
  }
  accounts(): Account[] {
    return this.db
      .prepare("SELECT id FROM users ORDER BY rowid")
      .all()
      .map((r) => this.account(r.id as string));
  }
  setRole(userId: string, roleId: string) {
    this.role(roleId);
    const was = this.account(userId);
    if (
      was.role === ADMIN &&
      roleId !== ADMIN &&
      (
        this.db
          .prepare("SELECT COUNT(*) AS n FROM users WHERE role=?")
          .get(ADMIN) as { n: number }
      ).n <= 1
    )
      throw new DomainError("至少要保留一位管理员", 409);
    this.db.prepare("UPDATE users SET role=? WHERE id=?").run(roleId, userId);
    return this.account(userId);
  }
  /** Gives revisions saved before they recorded their cause one: the first creates the
   * work, those a run's steps saved belong to its request, and the rest were edits. */
  private recordCauses() {
    const db = this.db;
    db.exec("BEGIN");
    try {
      db.exec(`ALTER TABLE revisions ADD COLUMN cause TEXT NOT NULL DEFAULT '{"kind":"edit"}';
 UPDATE revisions SET cause='{"kind":"create"}' WHERE revision=1;`);
      const update = db.prepare(
        "UPDATE revisions SET cause=? WHERE user_id=? AND work_id=? AND revision=?",
      );
      for (const row of db
        .prepare("SELECT user_id,data FROM runs ORDER BY rowid")
        .all()) {
        const run = JSON.parse(row.data as string) as Run;
        const first = run.steps[0];
        const cause = JSON.stringify({
          kind: "run",
          runId: run.id,
          prompt: first?.kind === "message" ? first.text : "",
        });
        for (const step of run.steps)
          if (
            step.kind === "tool" &&
            (step.name === "write_work" || step.name === "set_brief") &&
            step.revision
          )
            update.run(cause, row.user_id as string, run.workId, step.revision);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  session(userId: string) {
    const token = id();
    this.db.prepare("INSERT INTO sessions VALUES(?,?)").run(token, userId);
    return token;
  }
  userFor(token: string): Account | undefined {
    const row = this.db
      .prepare("SELECT user_id FROM sessions WHERE id=?")
      .get(token) as { user_id: string } | undefined;
    return row && this.account(row.user_id);
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
  commit(work: Work, base: number, cause: Cause) {
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
      db.prepare(
        "INSERT INTO revisions(user_id,work_id,revision,data,cause) VALUES(?,?,?,?,?)",
      ).run(this.userId, work.id, work.revision, json, JSON.stringify(cause));
      db.exec("COMMIT");
      return work;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  /** Names the work, without making a new revision of its drawing. */
  rename(workId: string, title: string) {
    const work = { ...this.work(workId), title, named: true };
    this.storage.db
      .prepare("UPDATE works SET data=? WHERE user_id=? AND id=?")
      .run(JSON.stringify(work), this.userId, workId);
    return work;
  }
  /** The work as the author last saw it whole: the overview of its latest look. */
  cover(workId: string) {
    const rows = this.storage.db
      .prepare(
        "SELECT data FROM runs WHERE user_id=? AND work_id=? ORDER BY rowid DESC",
      )
      .all(this.userId, workId);
    for (const r of rows) {
      const run = JSON.parse(r.data as string) as Run;
      const look = run.steps.findLast(
        (s) =>
          s.kind === "tool" &&
          s.name === "view_canvas" &&
          s.focus === "overview" &&
          !!s.screenshots?.length,
      );
      if (look?.kind === "tool" && look.name === "view_canvas")
        return look.screenshots![0].url;
    }
    return null;
  }
  revisions(workId: string): RevisionSummary[] {
    this.work(workId);
    return this.storage.db
      .prepare(
        "SELECT revision,data,cause FROM revisions WHERE user_id=? AND work_id=? ORDER BY revision DESC",
      )
      .all(this.userId, workId)
      .map((r) => ({
        revision: r.revision as number,
        updatedAt: JSON.parse(r.data as string).updatedAt,
        cause: JSON.parse(r.cause as string),
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
  /** Whether this account's role allows it. */
  can(permission: Permission) {
    return this.storage.account(this.userId).permissions.includes(permission);
  }
  /** Who the material library serves: this user, and everyone's materials if their role
   * lets them see all. */
  get viewer() {
    return { id: this.userId, all: this.can("materials.all") };
  }
  /** The user's own preferences and model pick. Settings saved before models were managed
   * for everyone held a whole connection; only the preferences carry over. */
  ownSettings(): UserSettings {
    const r = this.storage.db
      .prepare("SELECT data FROM settings WHERE user_id=?")
      .get(this.userId);
    const value = r ? JSON.parse(r.data as string) : {};
    return { preferences: value.preferences ?? "", model: value.model ?? null };
  }
  saveOwnSettings(value: UserSettings) {
    this.storage.db
      .prepare(
        "INSERT INTO settings VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data",
      )
      .run(this.userId, JSON.stringify(value));
  }
  /** What a run draws and paints with: the model the user picked, or the default when
   * they have not or it was taken away, the shared image model, and their preferences. */
  settings(): Settings {
    const own = this.ownSettings(),
      catalog = this.storage.models();
    const model =
      catalog.models.find((m) => m.id === own.model) ??
      catalog.models.find((m) => m.id === catalog.default) ??
      catalog.models[0];
    const { id: _, name: __, description: ___, ...author } = model;
    return { author, image: catalog.image, preferences: own.preferences };
  }
  capture(captureId: string) {
    return this.one<Capture>(
      "SELECT data FROM captures WHERE user_id=? AND id=?",
      captureId,
    );
  }
  captureBytes(captureId: string) {
    this.capture(captureId);
    return readFileSync(join(this.storage.dir, "captures", captureId));
  }
  putCapture(bytes: Uint8Array, name: string): Capture {
    const captureId = id();
    const capture = { id: captureId, name, url: `/api/captures/${captureId}` };
    writeFileSync(join(this.storage.dir, "captures", captureId), bytes);
    this.storage.db
      .prepare("INSERT INTO captures VALUES(?,?,?)")
      .run(this.userId, captureId, JSON.stringify(capture));
    return capture;
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

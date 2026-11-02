import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  ADMIN,
  MEMBER,
  DomainError,
  accountRoleSchema,
  id,
  type AccountRole,
} from "../contracts/index.ts";
import type { Storage } from "../storage/index.ts";
/** Makes an account. The first one sets the app up, so it administers it; the rest start
 * as members until an administrator gives them another role. */
export function register(db: Storage, name: string, password: string) {
  if (!name.trim() || password.length < 6)
    throw new DomainError("请输入用户名和至少六位密码");
  if (db.db.prepare("SELECT id FROM users WHERE name=?").get(name))
    throw new DomainError("用户名已存在", 409);
  const salt = randomBytes(16).toString("hex"),
    userId = id(),
    first = !db.db.prepare("SELECT 1 FROM users LIMIT 1").get();
  db.db
    .prepare("INSERT INTO users(id,name,password,role) VALUES(?,?,?,?)")
    .run(
      userId,
      name,
      salt + ":" + scryptSync(password, salt, 32).toString("hex"),
      first ? ADMIN : MEMBER,
    );
  return db.account(userId);
}
/** Letters and digits that cannot be mistaken for one another when read aloud or typed. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** An invite as people type it: case, spaces and dashes don't matter. */
export const inviteCode = (raw: string) =>
  raw.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(?=.)/, "$1-");
/** Makes `count` one-time invites for an administrator to hand out. */
export function createInvites(db: Storage, userId: string, count = 1) {
  if (!Number.isInteger(count) || count < 1 || count > 50)
    throw new DomainError("一次可以生成 1 到 50 个邀请码");
  const made: string[] = [];
  while (made.length < count) {
    const raw = [...randomBytes(8)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
    const code = inviteCode(raw);
    if (db.db.prepare("SELECT 1 FROM invites WHERE code=?").get(code)) continue;
    db.addInvite(code, userId);
    made.push(code);
  }
  return db.invites().filter((i) => made.includes(i.code));
}
/** Makes an account from the sign-up page. Once the app is set up, a person needs an
 * unused invite, which their account uses up; the account and the invite change together,
 * so a failed sign-up leaves the invite for another try. */
export function signUp(
  db: Storage,
  name: string,
  password: string,
  invite = "",
) {
  if (!db.hasAccounts()) return register(db, name, password);
  const code = inviteCode(invite);
  if (!code) throw new DomainError("请输入邀请码");
  db.db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.db
      .prepare("SELECT used_by FROM invites WHERE code=?")
      .get(code) as { used_by: string | null } | undefined;
    if (!row || row.used_by) throw new DomainError("邀请码无效或已被使用", 403);
    const account = register(db, name, password);
    if (!db.useInvite(code, account.id))
      throw new DomainError("邀请码无效或已被使用", 403);
    db.db.exec("COMMIT");
    return account;
  } catch (e) {
    db.db.exec("ROLLBACK");
    throw e;
  }
}
export function login(db: Storage, name: string, password: string) {
  const u = db.db.prepare("SELECT * FROM users WHERE name=?").get(name) as
    { id: string; name: string; password: string } | undefined;
  if (!u) throw new DomainError("用户名或密码错误", 401);
  const [salt, hash] = u.password.split(":");
  if (
    !timingSafeEqual(Buffer.from(hash, "hex"), scryptSync(password, salt, 32))
  )
    throw new DomainError("用户名或密码错误", 401);
  return db.account(u.id);
}
/** Adds a role, or changes one. The administrator role always may do everything, so it
 * cannot be changed; the member role keeps its place but its permissions can change. */
export function saveRole(
  db: Storage,
  input: unknown,
  roleId?: string,
): AccountRole {
  const { name, permissions } = accountRoleSchema.parse(input);
  if (roleId === ADMIN) throw new DomainError("管理员角色不能修改", 409);
  const old = roleId ? db.role(roleId) : undefined;
  if (db.roles().some((r) => r.id !== roleId && r.name === name && !r.builtin))
    throw new DomainError("角色名称已存在", 409);
  return db.saveRole({
    id: old?.id ?? "r-" + id().slice(0, 8),
    name: old?.builtin ? old.name : name,
    permissions: [...new Set(permissions)],
    builtin: old?.builtin ?? false,
  });
}
/** Removes a role an administrator added; its accounts become members. */
export function removeRole(db: Storage, roleId: string) {
  if (db.role(roleId).builtin) throw new DomainError("内置角色不能删除", 409);
  db.deleteRole(roleId);
}

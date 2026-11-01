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

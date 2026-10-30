import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { DomainError, id } from "../contracts/index.ts";
import type { Storage } from "../storage/index.ts";
export function register(db: Storage, name: string, password: string) {
  if (!name.trim() || password.length < 6)
    throw new DomainError("请输入用户名和至少六位密码");
  if (db.db.prepare("SELECT id FROM users WHERE name=?").get(name))
    throw new DomainError("用户名已存在", 409);
  const salt = randomBytes(16).toString("hex"),
    userId = id();
  db.db
    .prepare("INSERT INTO users VALUES(?,?,?)")
    .run(
      userId,
      name,
      salt + ":" + scryptSync(password, salt, 32).toString("hex"),
    );
  return { id: userId, name };
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
  return { id: u.id, name: u.name };
}

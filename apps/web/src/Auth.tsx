import { useState } from "react";
import { Lantern } from "@drawy/ui/brand";
import { Spinner } from "@drawy/ui";
import { Lettering } from "./Lettering.tsx";
import { api, type User } from "./api.ts";
import { cx } from "./cx.ts";

/** Signing in or up, beside a drawing that shows what DrawY does. */
export function Auth({ done }: { done: (user: User) => void }) {
  const [signup, S] = useState(false),
    [name, N] = useState(""),
    [password, P] = useState(""),
    [busy, B] = useState(false),
    [error, E] = useState("");
  return (
    <div className={cx("auth")}>
      <header className={cx("auth-brand")}>
        <Lantern size={28} />
        <Lettering name="brand" height={34} />
      </header>
      <section className={cx("auth-copy")}>
        <h1>
          <Lettering name="hero" height={92} />
        </h1>
        <p>说出你想弄明白的事，DrawY 把它画成一幅可以探索的图。</p>
        <form
          className={cx("auth-card")}
          onSubmit={async (e) => {
            e.preventDefault();
            B(true);
            E("");
            try {
              done(
                await api<User>(
                  "/auth/" + (signup ? "register" : "login"),
                  "POST",
                  { name, password },
                ),
              );
            } catch (e) {
              E(e instanceof Error ? e.message : String(e));
            } finally {
              B(false);
            }
          }}
        >
          <label>
            用户名
            <input
              autoComplete="username"
              value={name}
              onChange={(e) => N(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => P(e.target.value)}
              required
              minLength={6}
              placeholder={signup ? "至少 6 位" : undefined}
            />
          </label>
          {error && (
            <p className={cx("error")} role="alert">
              {error}
            </p>
          )}
          <button className={cx("primary")} disabled={busy}>
            {busy ? <Spinner size={16} /> : signup ? "创建账号" : "登录"}
          </button>
          <p className={cx("auth-switch")}>
            {signup ? "已有账号？" : "还没有账号？"}
            <button
              type="button"
              onClick={() => {
                S(!signup);
                E("");
              }}
            >
              {signup ? "登录" : "创建一个"}
            </button>
          </p>
        </form>
      </section>
      <figure className={cx("auth-art")}>
        <img
          src="/sketch-to-drawing.webp"
          alt="纸上一团铅笔线条渐渐变成一幅画好的树与水循环"
        />
      </figure>
    </div>
  );
}

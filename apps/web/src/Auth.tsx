import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Spinner } from "@drawy/ui";
import { Brand } from "./Title.tsx";
import { LanguageSwitch, useT } from "./i18n.tsx";
import { api, type User } from "./api.ts";
import { cx } from "./cx.ts";

/** Signing in or up: a headline and one card on the left, what DrawY makes on the right. */
export function Auth({ done }: { done: (user: User) => void }) {
  const t = useT();
  const [signup, S] = useState(false),
    [name, N] = useState(""),
    [password, P] = useState(""),
    [busy, B] = useState(false),
    [error, E] = useState("");
  return (
    <div className={cx("auth")}>
      <section className={cx("auth-side")}>
        <header className={cx("auth-top")}>
          <Brand size={26} />
          <LanguageSwitch label />
        </header>
        <div className={cx("auth-copy")}>
          <h1>{t.auth.headline}</h1>
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
            <p className={cx("auth-greeting")}>
              {signup ? t.auth.join : t.auth.welcome}
            </p>
            <input
              aria-label={t.auth.username}
              placeholder={t.auth.username}
              autoComplete="username"
              value={name}
              onChange={(e) => N(e.target.value)}
              required
              autoFocus
            />
            <input
              type="password"
              aria-label={t.auth.password}
              placeholder={signup ? `${t.auth.password} · ${t.auth.atLeast6}` : t.auth.password}
              autoComplete={signup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => P(e.target.value)}
              required
              minLength={6}
            />
            {error && (
              <p className={cx("error")} role="alert">
                {error}
              </p>
            )}
            <button className={cx("primary")} disabled={busy}>
              {busy ? (
                <Spinner size={16} />
              ) : (
                <>
                  {signup ? t.auth.signup : t.auth.login}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
            <hr />
            <button
              type="button"
              className={cx("auth-switch")}
              onClick={() => {
                S(!signup);
                E("");
              }}
            >
              {signup ? t.auth.toLogin : t.auth.toSignup}
            </button>
          </form>
        </div>
      </section>
      <figure className={cx("auth-art")}>
        <img src="/sketch-to-drawing.webp" alt={t.auth.art} />
      </figure>
    </div>
  );
}

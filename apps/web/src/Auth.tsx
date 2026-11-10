import { useEffect, useState } from "react";
import { ArrowRight, ArrowUp } from "lucide-react";
import { Spinner } from "@drawy/ui";
import { ModelSketch, KinshipSketch } from "@drawy/ui/sketches";
import { OrbitSketch } from "../../../modules/ui/brand/orbit.tsx";
import { Brand, Seal } from "./Title.tsx";
import { LanguageSwitch, useT } from "./i18n.tsx";
import { api, type User } from "./api.ts";
import { cx } from "./cx.ts";

/** Signing in or up: a headline and a form on a sheet at the left; on the desk at the right,
 * what DrawY makes: a request as it is typed, and the drawings that came of three. */
export function Auth({ done }: { done: (user: User) => void }) {
  const t = useT();
  const [signup, S] = useState(false),
    [name, N] = useState(""),
    [password, P] = useState(""),
    [invite, I] = useState(""),
    // Whether signing up takes an invite: it does once the app has its first account.
    [needsInvite, setNeedsInvite] = useState(true),
    [busy, B] = useState(false),
    [error, E] = useState("");
  useEffect(() => {
    void api<{ invite: boolean }>("/auth/signup").then(
      (r) => setNeedsInvite(r.invite),
      () => {},
    );
  }, []);
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
                    signup && needsInvite
                      ? { name, password, invite }
                      : { name, password },
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
            <label>
              <span>{t.auth.username}</span>
              <input
                autoComplete="username"
                autoCapitalize="none"
                value={name}
                onChange={(e) => N(e.target.value)}
                required
                autoFocus
              />
            </label>
            <label>
              <span>
                {t.auth.password}
                {signup && <small>{t.auth.atLeast6}</small>}
              </span>
              <input
                type="password"
                autoComplete={signup ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => P(e.target.value)}
                required
                minLength={6}
              />
            </label>
            {signup && needsInvite && (
              <label>
                <span>{t.auth.invite}</span>
                <input
                  autoComplete="off"
                  spellCheck={false}
                  value={invite}
                  onChange={(e) => I(e.target.value)}
                  aria-describedby="invite-hint"
                  required
                />
              </label>
            )}
            {signup && needsInvite && (
              <p className={cx("auth-hint")} id="invite-hint">
                {t.auth.inviteHint}
              </p>
            )}
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
      <figure className={cx("auth-art")} role="img" aria-label={t.auth.art}>
        <div className={cx("auth-desk")} aria-hidden>
          <div className={cx("auth-sheet")} data-at="back">
            <KinshipSketch />
            <p>
              <b>{t.home.examples[2]}</b>
              <Seal version={1} quiet />
            </p>
          </div>
          <div className={cx("auth-sheet")} data-at="mid">
            <ModelSketch />
            <p>
              <b>{t.home.examples[1]}</b>
              <Seal version={3} quiet />
            </p>
          </div>
          <div className={cx("auth-sheet")} data-at="front">
            <OrbitSketch />
            <p>
              <b>{t.home.examples[0]}</b>
              <Seal version={2} />
            </p>
          </div>
          <div className={cx("auth-slip")}>
            <span>{t.home.examples[0]}</span>
            <i>
              <ArrowUp size={15} strokeWidth={2.4} />
            </i>
          </div>
        </div>
      </figure>
    </div>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import * as Hand from "./ui/brand/icons.tsx";
import { Spinner } from "./ui/primitives.tsx";
import { Dialog } from "./ui/dialogs.tsx";
import { ModelSketch, KinshipSketch } from "./ui/brand/sketches.tsx";
import { OrbitSketch } from "./ui/brand/orbit.tsx";
import { Brand, Seal } from "./Title.tsx";
import { LanguageSwitch, useT } from "./i18n.tsx";
import { api, type User } from "./api.ts";
import { cx } from "./cx.ts";

/** The sign-in / sign-up form, shared between the full page and the contextual modal. */
function AuthForm({ done }: { done: (user: User) => void }) {
  const t = useT();
  const baseId = useId();
  const nameId = `${baseId}-name`,
    passId = `${baseId}-pass`,
    inviteId = `${baseId}-invite`,
    inviteHintId = `${baseId}-invite-hint`,
    errorId = `${baseId}-error`;
  const nameRef = useRef<HTMLInputElement>(null),
    passRef = useRef<HTMLInputElement>(null),
    inviteRef = useRef<HTMLInputElement>(null);
  const [signup, S] = useState(false),
    [name, N] = useState(""),
    [password, P] = useState(""),
    [invite, I] = useState(""),
    // Whether signing up takes an invite: it does once the app has its first account.
    [needsInvite, setNeedsInvite] = useState(true),
    [shown, setShown] = useState(false),
    [busy, B] = useState(false),
    [invalid, setInvalid] = useState<"name" | "password" | "invite">(),
    [error, E] = useState("");
  useEffect(() => {
    void api<{ invite: boolean }>("/auth/signup").then(
      (r) => setNeedsInvite(r.invite),
      () => {},
    );
  }, []);
  const clearError = (field: "name" | "password" | "invite") => {
    if (invalid === field) setInvalid(undefined);
    if (error) E("");
  };
  return (
    <form
      className={cx("auth-card")}
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) {
          setInvalid("name");
          E(t.auth.needUsername);
          nameRef.current?.focus();
          return;
        }
        if (!password) {
          setInvalid("password");
          E(t.auth.needPassword);
          passRef.current?.focus();
          return;
        }
        if (signup && password.length < 6) {
          setInvalid("password");
          E(t.auth.passwordShort);
          passRef.current?.focus();
          return;
        }
        if (signup && needsInvite && !invite.trim()) {
          setInvalid("invite");
          E(t.auth.needInvite);
          inviteRef.current?.focus();
          return;
        }
        B(true);
        setInvalid(undefined);
        E("");
        try {
          done(
            await api<User>(
              "/auth/" + (signup ? "register" : "login"),
              "POST",
              signup && needsInvite
                ? { name: trimmedName, password, invite: invite.trim() }
                : { name: trimmedName, password },
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
      <div className={cx("auth-field")}>
        <label htmlFor={nameId}>{t.auth.username}</label>
        <input
          ref={nameRef}
          id={nameId}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={name}
          aria-invalid={invalid === "name" || undefined}
          aria-describedby={invalid === "name" && error ? errorId : undefined}
          onChange={(e) => {
            N(e.target.value);
            clearError("name");
          }}
          required
          autoFocus
        />
      </div>
      <div className={cx("auth-field")}>
        <label htmlFor={passId}>
          <span>{t.auth.password}</span>
          {signup && <small>{t.auth.atLeast6}</small>}
        </label>
        <div className={cx("auth-secret")}>
          <input
            ref={passRef}
            id={passId}
            name="password"
            type={shown ? "text" : "password"}
            autoComplete={signup ? "new-password" : "current-password"}
            value={password}
            aria-invalid={invalid === "password" || undefined}
            aria-describedby={invalid === "password" && error ? errorId : undefined}
            onChange={(e) => {
              P(e.target.value);
              clearError("password");
            }}
            required
            minLength={6}
          />
          {/* What was typed can be read back before it is sent: a mistyped password
              is otherwise found out only by being refused. */}
          <button
            type="button"
            aria-label={shown ? t.auth.hidePassword : t.auth.showPassword}
            aria-pressed={shown}
            data-tip={shown ? t.auth.hidePassword : t.auth.showPassword}
            onClick={() => setShown(!shown)}
          >
            {shown ? <Hand.EyeShut size={17} /> : <Hand.Eye size={17} />}
          </button>
        </div>
      </div>
      {signup && needsInvite && (
        <div className={cx("auth-field")}>
          <label htmlFor={inviteId}>{t.auth.invite}</label>
          <input
            ref={inviteRef}
            id={inviteId}
            name="invite"
            autoComplete="off"
            spellCheck={false}
            value={invite}
            aria-invalid={invalid === "invite" || undefined}
            aria-describedby={invalid === "invite" && error ? `${errorId} ${inviteHintId}` : inviteHintId}
            onChange={(e) => {
              I(e.target.value);
              clearError("invite");
            }}
            required
          />
        </div>
      )}
      {signup && needsInvite && (
        <p className={cx("auth-hint")} id={inviteHintId}>
          {t.auth.inviteHint}
        </p>
      )}
      {error && (
        <p id={errorId} className={cx("error")} role="alert">
          {error}
        </p>
      )}
      <button className={cx("primary")} disabled={busy}>
        {busy ? (
          <Spinner size={16} />
        ) : (
          <>
            {signup ? t.auth.signup : t.auth.login}
            <Hand.ArrowRight size={17} />
          </>
        )}
      </button>
      <button
        type="button"
        className={cx("auth-switch")}
        onClick={() => {
          S(!signup);
          setInvalid(undefined);
          E("");
        }}
      >
        {signup ? t.auth.toLogin : t.auth.toSignup}
      </button>
    </form>
  );
}

/** Contextual sign-in / sign-up modal shown when an unauthenticated user uses a feature. */
export function AuthDialog({
  reason,
  done,
  onClose,
}: {
  reason?: string;
  done: (user: User) => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Dialog
      title={t.auth.login}
      heading={
        <span className={cx("auth-modal-head")}>
          <Brand size={22} />
          <LanguageSwitch />
        </span>
      }
      description={reason}
      onClose={onClose}
    >
      <AuthForm done={done} />
    </Dialog>
  );
}

/** Signing in or up: a headline and a form on a sheet at the left; on the desk at the right,
 * what DrawY makes: a request as it is typed, and the drawings that came of three. */
export function Auth({ done }: { done: (user: User) => void }) {
  const t = useT();
  return (
    <div className={cx("auth")}>
      <section className={cx("auth-side")}>
        <header className={cx("auth-top")}>
          <Brand size={26} />
          <LanguageSwitch />
        </header>
        <div className={cx("auth-copy")}>
          <h1>{t.auth.headline}</h1>
          <AuthForm done={done} />
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

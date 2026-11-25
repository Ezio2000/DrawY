import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import { PanelMark } from "./ui/brand/hand.tsx";
import * as Hand from "./ui/brand/icons.tsx";
import { useLocale } from "./ui/locale.tsx";
import type { ShellChoice, Shells } from "./shells.ts";
import { cx } from "./cx.ts";
import { useDismiss } from "./popover.ts";
import { Brand } from "./Title.tsx";
import { readSettings } from "./Settings.tsx";
import { LanguageSwitch, useT } from "./i18n.tsx";
import { counted } from "./probe.ts";
import { Spinner } from "./ui/primitives.tsx";
import { useStore } from "./session/store.ts";
import type { Recents } from "./recents.ts";
import type { WorkSummary } from "../../../modules/contracts/index.ts";
import type { User } from "./api.ts";
import { ago } from "./time.ts";
import type { Words } from "./i18n.tsx";

/** Where a work has got to, in a few words: drawing, waiting for an answer, stopped, or
 * the version it is at. */
export function progressOf(w: WorkSummary, t: Words) {
  const p = w.progress;
  const where =
    (p.blank ? t.rail.blank : t.rail.version(p.version)) +
    (p.unsaved ? ` · ${t.rail.unsaved}` : "");
  switch (p.run) {
    case "running":
    case "viewing":
      return { tone: "live", text: t.rail.drawing };
    case "waiting":
      return { tone: "ask", text: t.rail.asking };
    case "failed":
      return { tone: "failed", text: t.rail.failed(where) };
    case "cancelled":
      return { tone: "", text: t.rail.stopped(where) };
    default:
      return { tone: "", text: `${where} · ${ago(w.updatedAt)}` };
  }
}

/** A title that can be renamed in place: Enter keeps the new name, Escape or an empty
 * name keeps the old. */
export function Rename({
  title,
  done,
}: {
  title: string;
  done: (title: string | null) => void;
}) {
  const t = useT();
  const [value, set] = useState(title);
  const finish = (keep: boolean) =>
    done(keep && value.trim() && value.trim() !== title ? value.trim() : null);
  return (
    <input
      className={cx("rename")}
      aria-label={t.rail.workName}
      autoFocus
      value={value}
      maxLength={80}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => set(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") {
          e.stopPropagation();
          finish(false);
        }
      }}
    />
  );
}

/** The app's navigation: home (where a request starts a new work), a blank canvas to
 * draw on by hand, the library, the recent works and the account. Collapsed it shows icons; open it slides over the page. */
export function Rail({
  user,
  open,
  setOpen,
  page,
  recents,
  current,
  go,
  remove,
  shells,
  logout,
  onLogin,
}: {
  user: User | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  page: string;
  recents: Recents;
  current?: string;
  go: (path: string) => void;
  remove: (work: WorkSummary) => void;
  /** The work pages there are for each kind of device, and the one picked. */
  shells: Shells;
  logout: () => void;
  onLogin: () => void;
}) {
  const t = useT();
  const [account, setAccount] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  useDismiss(account, () => setAccount(false), accountRef);
  const nav = useCallback((path: string) => {
    go(path);
    setOpen(false);
  }, [go, setOpen]);
  const link = (
    path: string,
    label: string,
    Icon: Hand.HandIcon,
    active: boolean,
  ) => (
    <button
      className={cx("rail-button")}
      aria-label={label}
      data-tip={open ? undefined : label}
      aria-current={active || undefined}
      onClick={() => nav(path)}
    >
      <Icon size={18} />
      <span className={cx("rail-label")}>{label}</span>
    </button>
  );
  return (
    <nav className={cx("rail")} data-open={open} aria-label={t.rail.nav}>
      <div className={cx("rail-head")}>
        <button
          className={cx("rail-button")}
          aria-label={open ? t.rail.close : t.rail.open}
          data-tip={open ? undefined : t.rail.open}
          onClick={() => setOpen(!open)}
        >
          <PanelMark size={22} open={open} />
        </button>
        <span className={cx("rail-brand")}>
          <Brand size={20} />
        </span>
      </div>
      {link("/", t.rail.home, Hand.Home, page === "home")}
      {link("/new", t.rail.blankCanvas, Hand.Plus, page === "new")}
      {link("/library", t.rail.library, Hand.Library, page === "library")}
      <section className={cx("rail-recents")} inert={!open}>
        {open && user && <RecentList recents={recents} current={current} nav={nav} remove={remove} />}
      </section>
      <div className={cx("rail-foot")} ref={accountRef}>
        {user ? (
          <>
            {account && (
              <div className={cx("popover account-menu")} role="menu">
                <p>
                  {user.name}
                  <small>
                    {(user.builtinRole && t.settings.roleNames[user.role]) ||
                      user.roleName}
                  </small>
                </p>
                <button role="menuitem" onClick={() => (setAccount(false), nav("/settings"))}>
                  <Hand.Settings size={16} />
                  {t.rail.settings}
                </button>
                {user.permissions.includes("models.manage") && (
                  <button role="menuitem" onClick={() => (setAccount(false), nav("/traces"))}>
                    <Hand.Records size={16} />
                    {t.rail.traces}
                  </button>
                )}
                <LanguageSwitch />
                <ShellSwitch shells={shells} />
                <hr />
                <button
                  role="menuitem"
                  onClick={() => {
                    setAccount(false);
                    logout();
                  }}
                >
                  <Hand.LogOut size={16} />
                  {t.rail.logout}
                </button>
              </div>
            )}
            <button
              className={cx("rail-button rail-account")}
              aria-label={t.rail.account}
              aria-expanded={account}
              data-tip={open ? undefined : user.name}
              onClick={() => {
                // Settings are a press away: what they show is read as the menu opens.
                if (!account) readSettings((p) => user.permissions.includes(p));
                setAccount(!account);
              }}
            >
              <Hand.Avatar name={user.name} />
              <span className={cx("rail-label")}>{user.name}</span>
              <Hand.UpDown size={15} className={cx("rail-label")} />
            </button>
          </>
        ) : (
          <button
            className={cx("rail-button")}
            aria-label={t.rail.signIn}
            data-tip={open ? undefined : t.rail.signIn}
            onClick={() => {
              setOpen(false);
              onLogin();
            }}
          >
            <Hand.LogIn size={18} />
            <span className={cx("rail-label")}>{t.rail.signIn}</span>
          </button>
        )}
      </div>
    </nav>
  );
}

type RowActions = { nav: (path: string) => void; remove: (work: WorkSummary) => void };

function RecentList({ recents, current, nav, remove }: RowActions & { recents: Recents; current?: string }) {
  const t = useT(), { rows, loading } = useStore(recents);
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = recents.scrollTop;
  }, [recents]);
  return <>
    <h2>{t.rail.recents}</h2>
    <ul ref={list} aria-busy={loading} onScroll={(e) => { recents.scrollTop = e.currentTarget.scrollTop; }}>
      {loading && <li><Spinner /></li>}
      {rows.map((work) => <WorkRow key={work.id} work={work} current={work.id === current} nav={nav} remove={remove} />)}
    </ul>
  </>;
}

const WorkRow = memo(function WorkRow({ work, current, nav, remove }: RowActions & { work: WorkSummary; current: boolean }) {
  counted("rail-row");
  const t = useT(), state = progressOf(work, t);
  return (
    <li className={cx("rail-work")} data-current={current || undefined}>
      <button className={cx("rail-work-open")} title={work.progress.prompt || undefined} onClick={() => nav("/a/" + work.id)}>
        <span>{work.title}</span>
        <small data-tone={state.tone || undefined}>{state.tone && <i />}{state.text}</small>
      </button>
      <button className={cx("rail-work-remove")} aria-label={t.rail.removeWork(work.title)} data-tip={t.rail.remove} onClick={() => remove(work)}>
        <Hand.Trash size={16} />
      </button>
    </li>
  );
});

/** Picks the work page by hand, in turn: the one the device fits, then each there is;
 * the pick is remembered on this browser. */
function ShellSwitch({ shells }: { shells: Shells }) {
  const t = useT(),
    locale = useLocale();
  const order: ShellChoice[] = ["auto", "phone", "desktop"];
  const next = order[(order.indexOf(shells.choice) + 1) % order.length];
  const name = (c: ShellChoice) =>
    c === "auto" ? t.rail.layoutAuto(shells.nameOf(shells.fits, locale)) : shells.nameOf(c, locale);
  return (
    <button role="menuitem" onClick={() => shells.choose(next)}>
      <Hand.Devices size={16} />
      {t.rail.layout}
      <small>{name(shells.choice)}</small>
    </button>
  );
}

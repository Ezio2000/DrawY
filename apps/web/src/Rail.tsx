import { useRef, useState } from "react";
import {
  House,
  Shapes,
  Settings2,
  ScrollText,
  LogOut,
  Trash2,
  ChevronsUpDown,
  SquarePen,
  MonitorSmartphone,
} from "lucide-react";
import { PanelMark } from "@drawy/ui/brand";
import { useLocale } from "@drawy/ui";
import type { ShellChoice, Shells } from "./shells.ts";
import { cx } from "./cx.ts";
import { useDismiss } from "./popover.ts";
import { Brand } from "./Title.tsx";
import { LanguageSwitch, useT } from "./i18n.tsx";
import type { Summary, User } from "./api.ts";
import { ago } from "./time.ts";
import type { Words } from "./i18n.tsx";

/** Where a work has got to, in a few words: drawing, waiting for an answer, stopped, or
 * the version it is at. */
export function progressOf(w: Summary, t: Words) {
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

/** The app's navigation: home (where a new work starts), the library, the recent works
 * and the account. Collapsed it shows icons; open it slides over the page. */
export function Rail({
  user,
  open,
  setOpen,
  page,
  works,
  current,
  go,
  create,
  remove,
  shells,
  logout,
}: {
  user: User;
  open: boolean;
  setOpen: (open: boolean) => void;
  page: string;
  works: Summary[];
  current?: string;
  go: (path: string) => void;
  /** Starts a blank canvas and opens it. */
  create: () => void;
  remove: (work: Summary) => void;
  /** The work pages there are for each kind of device, and the one picked. */
  shells: Shells;
  logout: () => void;
}) {
  const t = useT();
  const [account, setAccount] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  useDismiss(account, () => setAccount(false), accountRef);
  const nav = (path: string) => {
    go(path);
    setOpen(false);
  };
  const link = (
    path: string,
    label: string,
    Icon: typeof House,
    active: boolean,
  ) => (
    <button
      className={cx("rail-button")}
      aria-label={label}
      data-tip={open ? undefined : label}
      aria-current={active || undefined}
      onClick={() => nav(path)}
    >
      <Icon size={17} />
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
      {link("/", t.rail.home, House, page === "home")}
      <button
        className={cx("rail-button")}
        aria-label={t.rail.blankCanvas}
        data-tip={open ? undefined : t.rail.blankCanvas}
        onClick={() => {
          create();
          setOpen(false);
        }}
      >
        <SquarePen size={17} />
        <span className={cx("rail-label")}>{t.rail.blankCanvas}</span>
      </button>
      {link("/library", t.rail.library, Shapes, page === "library")}
      <section className={cx("rail-recents")} inert={!open}>
        <h2>{t.rail.recents}</h2>
        <ul>
          {works.map((w) => {
            const state = progressOf(w, t);
            return (
            <li
              className={cx("rail-work")}
              data-current={w.id === current || undefined}
              key={w.id}
            >
              <button
                className={cx("rail-work-open")}
                title={w.progress.prompt || undefined}
                onClick={() => nav("/a/" + w.id)}
              >
                <span>{w.title}</span>
                <small data-tone={state.tone || undefined}>
                  {state.tone && <i />}
                  {state.text}
                </small>
              </button>
              <button
                className={cx("rail-work-remove")}
                aria-label={t.rail.removeWork(w.title)}
                data-tip={t.rail.remove}
                onClick={() => remove(w)}
              >
                <Trash2 size={15} />
              </button>
            </li>
            );
          })}
        </ul>
      </section>
      <div className={cx("rail-foot")} ref={accountRef}>
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
              <Settings2 size={15} />
              {t.rail.settings}
            </button>
            {user.permissions.includes("models.manage") && (
              <button role="menuitem" onClick={() => (setAccount(false), nav("/traces"))}>
                <ScrollText size={15} />
                {t.rail.traces}
              </button>
            )}
            <LanguageSwitch label />
            {shells.devices.length > 1 && <ShellSwitch shells={shells} />}
            <hr />
            <button
              role="menuitem"
              onClick={() => {
                setAccount(false);
                logout();
              }}
            >
              <LogOut size={15} />
              {t.rail.logout}
            </button>
          </div>
        )}
        <button
          className={cx("rail-button rail-account")}
          aria-label={t.rail.account}
          aria-expanded={account}
          data-tip={open ? undefined : user.name}
          onClick={() => setAccount(!account)}
        >
          <span className={cx("avatar")}>{[...user.name][0]?.toUpperCase()}</span>
          <span className={cx("rail-label")}>{user.name}</span>
          <ChevronsUpDown size={14} className={cx("rail-label")} />
        </button>
      </div>
    </nav>
  );
}

/** Picks the work page by hand, in turn: the one the device fits, then each there is;
 * the pick is remembered on this browser. */
function ShellSwitch({ shells }: { shells: Shells }) {
  const t = useT(),
    locale = useLocale();
  const order: ShellChoice[] = ["auto", ...shells.devices];
  const next = order[(order.indexOf(shells.choice) + 1) % order.length];
  const name = (c: ShellChoice) =>
    c === "auto" ? t.rail.layoutAuto(shells.nameOf(shells.fits, locale)) : shells.nameOf(c, locale);
  return (
    <button role="menuitem" onClick={() => shells.choose(next)}>
      <MonitorSmartphone size={15} />
      {t.rail.layout}
      <small>{name(shells.choice)}</small>
    </button>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  House,
  Shapes,
  Settings2,
  ScrollText,
  LogOut,
  Ellipsis,
  PenLine,
  Trash2,
  ChevronsUpDown,
} from "lucide-react";
import { PanelMark } from "@drawy/ui/brand";
import { cx } from "./cx.ts";
import { Brand } from "./Title.tsx";
import { LanguageSwitch, useT } from "./i18n.tsx";
import type { Summary, User } from "./api.ts";

/** Closes a popover on a press outside `ref` or on Escape. */
export function useDismiss(
  open: boolean,
  close: () => void,
  ref: React.RefObject<HTMLElement | null>,
) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) latest.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      latest.current();
    };
    addEventListener("pointerdown", away, true);
    addEventListener("keydown", key, true);
    return () => {
      removeEventListener("pointerdown", away, true);
      removeEventListener("keydown", key, true);
    };
  }, [open]);
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
  rename,
  remove,
  logout,
}: {
  user: User;
  open: boolean;
  setOpen: (open: boolean) => void;
  page: string;
  works: Summary[];
  current?: string;
  go: (path: string) => void;
  rename: (id: string, title: string) => void;
  remove: (work: Summary) => void;
  logout: () => void;
}) {
  const t = useT();
  const [menu, setMenu] = useState<string>(),
    [renaming, setRenaming] = useState<string>(),
    [account, setAccount] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null),
    accountRef = useRef<HTMLDivElement>(null);
  useDismiss(!!menu, () => setMenu(undefined), menuRef);
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
      {link("/library", t.rail.library, Shapes, page === "library")}
      <section className={cx("rail-recents")} inert={!open}>
        <h2>
          <button aria-current={page === "works" || undefined} onClick={() => nav("/works")}>
            {t.rail.recents}
          </button>
        </h2>
        <ul>
          {works.slice(0, 30).map((w) => (
            <li
              className={cx("rail-work")}
              data-current={w.id === current || undefined}
              data-menu={menu === w.id || undefined}
              key={w.id}
            >
              {renaming === w.id ? (
                <Rename
                  title={w.title}
                  done={(title) => {
                    setRenaming(undefined);
                    if (title) rename(w.id, title);
                  }}
                />
              ) : (
                <button
                  className={cx("rail-work-open")}
                  onClick={() => nav("/a/" + w.id)}
                  onDoubleClick={() => setRenaming(w.id)}
                >
                  <span>{w.title}</span>
                </button>
              )}
              <div className={cx("rail-work-more")} ref={menu === w.id ? menuRef : undefined}>
                <button
                  aria-label={t.rail.more(w.title)}
                  aria-expanded={menu === w.id}
                  onClick={() => setMenu(menu === w.id ? undefined : w.id)}
                >
                  <Ellipsis size={15} />
                </button>
                {menu === w.id && (
                  <div className={cx("popover")} role="menu">
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenu(undefined);
                        setRenaming(w.id);
                      }}
                    >
                      <PenLine size={15} />
                      {t.rail.rename}
                    </button>
                    <button
                      role="menuitem"
                      data-danger
                      onClick={() => {
                        setMenu(undefined);
                        remove(w);
                      }}
                    >
                      <Trash2 size={15} />
                      {t.rail.remove}
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        {works.length > 30 && (
          <button className={cx("rail-all")} onClick={() => nav("/works")}>
            {t.rail.all(works.length)}
          </button>
        )}
      </section>
      <div className={cx("rail-foot")} ref={accountRef}>
        {account && (
          <div className={cx("popover account-menu")} role="menu">
            <p>{user.name}</p>
            <button role="menuitem" onClick={() => (setAccount(false), nav("/settings"))}>
              <Settings2 size={15} />
              {t.rail.settings}
            </button>
            <button role="menuitem" onClick={() => (setAccount(false), nav("/traces"))}>
              <ScrollText size={15} />
              {t.rail.traces}
            </button>
            <LanguageSwitch label />
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

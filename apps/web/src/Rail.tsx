import { useEffect, useRef, useState } from "react";
import {
  Plus,
  LayoutGrid,
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
import { Lettering } from "./Lettering.tsx";
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
  const [value, set] = useState(title);
  const finish = (keep: boolean) =>
    done(keep && value.trim() && value.trim() !== title ? value.trim() : null);
  return (
    <input
      className={cx("rename")}
      aria-label="作品名称"
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

/** The app's navigation: new work, all works, the library, the recent works and the
 * account. Collapsed it shows icons; open it slides over the page. */
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
    Icon: typeof Plus,
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
    <nav className={cx("rail")} data-open={open} aria-label="导航">
      <div className={cx("rail-head")}>
        <button
          className={cx("rail-button")}
          aria-label={open ? "收起侧栏" : "展开侧栏"}
          data-tip={open ? undefined : "展开侧栏"}
          onClick={() => setOpen(!open)}
        >
          <PanelMark size={22} open={open} />
        </button>
        <span className={cx("rail-brand")}>
          <Lettering name="brand" height={28} />
        </span>
      </div>
      <button
        className={cx("rail-button rail-new")}
        aria-label="新作品"
        data-tip={open ? undefined : "新作品"}
        onClick={() => nav("/")}
      >
        <span className={cx("rail-plus")}>
          <Plus size={15} />
        </span>
        <span className={cx("rail-label")}>新作品</span>
      </button>
      {link("/works", "作品", LayoutGrid, page === "works")}
      {link("/library", "素材库", Shapes, page === "library")}
      <section className={cx("rail-recents")} inert={!open}>
        <h2>最近</h2>
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
                  aria-label={"更多操作：" + w.title}
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
                      重命名
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
                      删除
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        {works.length > 30 && (
          <button className={cx("rail-all")} onClick={() => nav("/works")}>
            全部 {works.length} 个作品
          </button>
        )}
      </section>
      <div className={cx("rail-foot")} ref={accountRef}>
        {account && (
          <div className={cx("popover account-menu")} role="menu">
            <p>{user.name}</p>
            <button role="menuitem" onClick={() => (setAccount(false), nav("/settings"))}>
              <Settings2 size={15} />
              设置
            </button>
            <button role="menuitem" onClick={() => (setAccount(false), nav("/traces"))}>
              <ScrollText size={15} />
              运行记录
            </button>
            <hr />
            <button
              role="menuitem"
              onClick={() => {
                setAccount(false);
                logout();
              }}
            >
              <LogOut size={15} />
              退出登录
            </button>
          </div>
        )}
        <button
          className={cx("rail-button rail-account")}
          aria-label="账户"
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

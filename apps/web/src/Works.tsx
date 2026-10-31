import { useRef, useState } from "react";
import { Plus, Search, Ellipsis, PenLine, Trash2 } from "lucide-react";
import { Lantern } from "@drawy/ui/brand";
import { cx } from "./cx.ts";
import { ago } from "./time.ts";
import { Rename, useDismiss } from "./Rail.tsx";
import { Lettering } from "./Lettering.tsx";
import type { Summary } from "./api.ts";

/** Every work, each by the last overview the author took of it. */
export function Works({
  works,
  go,
  rename,
  remove,
}: {
  works: Summary[];
  go: (path: string) => void;
  rename: (id: string, title: string) => void;
  remove: (work: Summary) => void;
}) {
  const [query, setQuery] = useState(""),
    [menu, setMenu] = useState<string>(),
    [renaming, setRenaming] = useState<string>();
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(!!menu, () => setMenu(undefined), ref);
  const shown = works.filter((w) =>
    w.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div className={cx("page")}>
      <header className={cx("page-head")}>
        <h1>
          <Lettering name="works" height={64} />
        </h1>
        <button className={cx("primary")} onClick={() => go("/")}>
          <Plus size={16} />
          新作品
        </button>
      </header>
      <p className={cx("page-lede")}>你画过的每一幅图，最近改过的在前。</p>
      <label className={cx("page-search")}>
        <Search size={16} />
        <input
          placeholder="搜索作品"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <p className={cx("page-count")}>
        {query.trim()
          ? `${shown.length} 个匹配的作品`
          : `共 ${works.length} 个作品`}
      </p>
      {!works.length ? (
        <div className={cx("page-empty")}>
          <Lantern size={36} />
          <p>还没有作品</p>
          <button className={cx("secondary")} onClick={() => go("/")}>
            画第一幅
          </button>
        </div>
      ) : (
        <ul className={cx("gallery")}>
          {shown.map((w, i) => (
            <li
              key={w.id}
              data-menu={menu === w.id || undefined}
              style={{ animationDelay: Math.min(i, 12) * 30 + "ms" }}
            >
              <button
                className={cx("gallery-cover")}
                aria-label={"打开 " + w.title}
                onClick={() => go("/a/" + w.id)}
              >
                {w.cover ? (
                  <img src={w.cover} alt="" loading="lazy" />
                ) : (
                  <span>还没有画面</span>
                )}
              </button>
              <div className={cx("gallery-text")}>
                {renaming === w.id ? (
                  <Rename
                    title={w.title}
                    done={(title) => {
                      setRenaming(undefined);
                      if (title) rename(w.id, title);
                    }}
                  />
                ) : (
                  <b title={w.title} onDoubleClick={() => setRenaming(w.id)}>
                    {w.title}
                  </b>
                )}
                <small>
                  {ago(w.updatedAt)} · 第 {w.revision} 稿
                </small>
              </div>
              <div
                className={cx("gallery-more")}
                ref={menu === w.id ? ref : undefined}
              >
                <button
                  aria-label={"更多操作：" + w.title}
                  aria-expanded={menu === w.id}
                  onClick={() => setMenu(menu === w.id ? undefined : w.id)}
                >
                  <Ellipsis size={16} />
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
      )}
    </div>
  );
}

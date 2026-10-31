import { useRef, useState } from "react";
import { Plus, Search, Ellipsis, PenLine, Trash2 } from "lucide-react";
import { Lantern } from "@drawy/ui/brand";
import { cx } from "./cx.ts";
import { ago } from "./time.ts";
import { Rename, useDismiss } from "./Rail.tsx";
import { Title } from "./Title.tsx";
import { useT } from "./i18n.tsx";
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
  const t = useT();
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
          <Title name="works" />
        </h1>
        <button className={cx("primary")} onClick={() => go("/")}>
          <Plus size={16} />
          {t.works.newWork}
        </button>
      </header>
      <label className={cx("page-search")}>
        <Search size={16} />
        <input
          placeholder={t.works.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <p className={cx("page-count")}>
        {query.trim() ? t.works.matched(shown.length) : t.works.total(works.length)}
      </p>
      {!works.length ? (
        <div className={cx("page-empty")}>
          <Lantern size={36} />
          <p>{t.works.empty}</p>
          <button className={cx("secondary")} onClick={() => go("/")}>
            {t.works.first}
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
                aria-label={t.works.open(w.title)}
                onClick={() => go("/a/" + w.id)}
              >
                {w.cover ? (
                  <img src={w.cover} alt="" loading="lazy" />
                ) : (
                  <span>{t.works.noCover}</span>
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
                  {ago(w.updatedAt)} · {t.works.revision(w.revision)}
                </small>
              </div>
              <div
                className={cx("gallery-more")}
                ref={menu === w.id ? ref : undefined}
              >
                <button
                  aria-label={t.rail.more(w.title)}
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
      )}
    </div>
  );
}

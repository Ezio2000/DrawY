import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { OrbitSketch } from "../../../modules/ui/brand/orbit.tsx";
import { ModelSketch, KinshipSketch } from "@drawy/ui/sketches";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";
import { Title } from "./Title.tsx";
import { progressOf } from "./Rail.tsx";
import type { Summary } from "./api.ts";

const sketches = [OrbitSketch, ModelSketch, KinshipSketch];

/** How many whole rows of `list`'s items fit in its height, times the columns it lays out:
 * the page never scrolls, it shows fewer works instead. */
function useFits(list: React.RefObject<HTMLUListElement | null>, deps: unknown[]) {
  const [fits, setFits] = useState(Infinity);
  // A card's height, kept from when one was shown, so the shelf can grow back from none.
  const card = useRef(0);
  useLayoutEffect(() => {
    const ul = list.current;
    if (!ul) return;
    const measure = () => {
      const style = getComputedStyle(ul);
      // Where the page scrolls (a phone), every work is shown.
      if (style.overflowY !== "hidden") return setFits(Infinity);
      const cols = style.gridTemplateColumns.split(" ").filter(Boolean).length || 1;
      const item = ul.firstElementChild as HTMLElement | null;
      if (item) card.current = item.offsetHeight;
      if (!card.current) return;
      const gap = parseFloat(style.rowGap) || 0;
      const rows = Math.floor((ul.clientHeight + gap) / (card.current + gap));
      setFits(cols * rows);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(ul);
    return () => watch.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return fits;
}

/** The first page, laid out like a drawing tool's file browser rather than a chatbot's
 * greeting: ways to start a work (a blank canvas, or one of three requests, as small
 * tiles that say so, so they do not pass for works of one's own), then as many of
 * the works last drawn on as fit the window. The composer stays at the bottom, where it is on
 * every page. */
export function Home({
  works,
  listed,
  start,
  blank,
  all,
  open,
  composer,
}: {
  works: Summary[];
  /** Whether `works` has arrived; until then the shelf stays empty rather than say "none". */
  listed: boolean;
  /** Sends one of the examples as a request. */
  start: (text: string) => void;
  /** Makes a blank canvas and opens it. */
  blank: () => void;
  /** Shows every work, in the side bar. */
  all: () => void;
  open: (id: string) => void;
  composer: ReactNode;
}) {
  const t = useT();
  const shelf = useRef<HTMLUListElement>(null);
  const recent = [...works].sort((a, b) => b.updatedAt - a.updatedAt);
  const fits = useFits(shelf, [listed, recent.length > 0]);
  const shown = recent.slice(0, fits);
  const hidden = recent.length - shown.length;
  return (
    <div className={cx("home")}>
      <header className={cx("home-head")}>
        <h1>
          <Title name="home" />
        </h1>
      </header>
      <section className={cx("home-section")} aria-labelledby="home-new">
        <h2 id="home-new">{t.home.create}</h2>
        <ul className={cx("starts")}>
          <li>
            <button className={cx("start")} data-blank onClick={blank}>
              <span className={cx("start-art")}>
                <Plus size={22} strokeWidth={1.6} />
              </span>
              <span className={cx("start-text")}>
                <span className={cx("start-name")}>{t.rail.blankCanvas}</span>
                <span className={cx("start-note")}>{t.home.blankNote}</span>
              </span>
            </button>
          </li>
          {t.home.examples.map((text, i) => {
            const Sketch = sketches[i];
            return (
              <li key={text}>
                <button className={cx("start")} title={text} onClick={() => start(text)}>
                  <span className={cx("start-art")}>
                    <Sketch />
                  </span>
                  <span className={cx("start-text")}>
                    <span className={cx("start-name")}>{text}</span>
                    <span className={cx("start-note")}>{t.home.exampleNote}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section className={cx("home-section", "home-recent")} aria-labelledby="home-recent">
        <h2 id="home-recent">
          {t.home.recent}
          {hidden > 0 && (
            <button className={cx("home-all")} onClick={all}>
              {t.home.all(recent.length)}
            </button>
          )}
        </h2>
        {listed && !recent.length ? (
          // Someone new is told what DrawY does and how to start, where their works will be.
          <p className={cx("home-empty")}>{t.home.firstSteps}</p>
        ) : (
          <ul className={cx("recent")} ref={shelf}>
            {shown.map((w) => {
              const state = progressOf(w, t);
              return (
                <li key={w.id}>
                  <button onClick={() => open(w.id)} title={w.progress.prompt || undefined}>
                    <span className={cx("recent-cover")}>
                      {w.cover && !w.progress.blank ? (
                        <img src={w.cover} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <i aria-hidden>{w.progress.blank ? "" : w.title.slice(0, 1)}</i>
                      )}
                    </span>
                    <b>{w.title}</b>
                    <span className={cx("work-state")} data-tone={state.tone || undefined}>
                      {state.text}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <div className={cx("home-composer")}>{composer}</div>
    </div>
  );
}

import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { OrbitSketch } from "../../../modules/ui/brand/orbit.tsx";
import { ModelSketch, KinshipSketch } from "@drawy/ui/sketches";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";
import { Title } from "./Title.tsx";
import { progressOf } from "./Rail.tsx";
import type { Summary } from "./api.ts";

const sketches = [OrbitSketch, ModelSketch, KinshipSketch];
/** How many works the home page shows; the rest are a press away in the side bar. */
const RECENT = 12;

/** The first page, laid out like a drawing tool's file browser rather than a chatbot's
 * greeting: ways to start a work (a blank canvas, or one of three requests), then the works
 * the person was last on. The composer stays at the bottom, where it is on every page. */
export function Home({
  works,
  start,
  blank,
  open,
  composer,
}: {
  works: Summary[];
  /** Sends one of the examples as a request. */
  start: (text: string) => void;
  /** Makes a blank canvas and opens it. */
  blank: () => void;
  open: (id: string) => void;
  composer: ReactNode;
}) {
  const t = useT();
  const recent = [...works].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT);
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
              <span className={cx("start-name")}>{t.rail.blankCanvas}</span>
            </button>
          </li>
          {t.home.examples.map((text, i) => {
            const Sketch = sketches[i];
            return (
              <li key={text}>
                <button className={cx("start")} onClick={() => start(text)}>
                  <span className={cx("start-art")}>
                    <Sketch />
                  </span>
                  <span className={cx("start-name")}>{text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section className={cx("home-section")} aria-labelledby="home-recent">
        <h2 id="home-recent">{t.home.recent}</h2>
        {recent.length ? (
          <ul className={cx("recent")}>
            {recent.map((w) => {
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
        ) : (
          <p className={cx("home-empty")}>{t.home.noWorks}</p>
        )}
      </section>
      <div className={cx("home-composer")}>{composer}</div>
    </div>
  );
}

import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { OrbitSketch } from "../../../modules/ui/brand/orbit.tsx";
import { ModelSketch, KinshipSketch } from "@drawy/ui/sketches";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";
import { Title } from "./Title.tsx";
import { progressOf } from "./Rail.tsx";
import type { Summary } from "./api.ts";

const sketches = [OrbitSketch, ModelSketch, KinshipSketch];
/** How many works the shelf shows; the rest are a press away in the side bar. */
const RECENT = 8;

/** The first page: a plain question, three requests to start from, and the works the
 * person was last on, so coming back is one press rather than a trip through the side bar.
 * The composer stays at the bottom, where it is on every page. */
export function Home({
  works,
  start,
  open,
  composer,
}: {
  works: Summary[];
  /** Sends one of the examples as a request. */
  start: (text: string) => void;
  open: (id: string) => void;
  composer: ReactNode;
}) {
  const t = useT();
  const recent = [...works].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT);
  return (
    <div className={cx("home")} data-returning={recent.length > 0 || undefined}>
      <section className={cx("hero")}>
        <h1 className={cx("hero-title")}>
          <Title name="hero" size="hero" />
        </h1>
        <nav className={cx("examples")} aria-label={t.home.starters}>
          {t.home.examples.map((text, i) => {
            const Sketch = sketches[i];
            return (
              <button
                className={cx("example")}
                key={text}
                style={{ animationDelay: 120 + i * 60 + "ms" }}
                onClick={() => start(text)}
              >
                <span className={cx("example-art")}>
                  <Sketch />
                </span>
                <span className={cx("example-text")}>
                  {text}
                  <ArrowRight size={14} aria-hidden />
                </span>
              </button>
            );
          })}
        </nav>
      </section>
      {recent.length > 0 && (
        <section className={cx("recent")} aria-labelledby="recent-title">
          <h2 id="recent-title">{t.home.recent}</h2>
          <ul>
            {recent.map((w, i) => {
              const state = progressOf(w, t);
              return (
                <li key={w.id} style={{ animationDelay: 160 + i * 40 + "ms" }}>
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
        </section>
      )}
      <div className={cx("home-composer")}>{composer}</div>
    </div>
  );
}

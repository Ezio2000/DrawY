import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Plus,
  Pause,
  Play,
  ArrowDown,
} from "lucide-react";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";
import { Brand, Seal } from "./Title.tsx";
import { progressOf } from "./Rail.tsx";
import { HomeShowcase } from "./HomeShowcase.tsx";
import { HomeJourney } from "./HomeJourney.tsx";
import { HomeExhibition, homeChapters } from "./HomeExhibition.tsx";
import type { Summary } from "./api.ts";

/** Generated works play on the desk; trying a topic only prepares a request. */
export function Home({
  works,
  listed,
  prepare,
  blank,
  all,
  open,
  composer,
  signIn,
}: {
  works: Summary[];
  listed: boolean;
  prepare: (text: string) => void;
  blank: () => void;
  all: () => void;
  open: (id: string) => void;
  composer: ReactNode;
  signIn?: () => void;
}) {
  const t = useT();
  const home = useRef<HTMLDivElement>(null);
  const [awake, setAwake] = useState(!document.hidden);
  useEffect(() => {
    const visibility = () => setAwake(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          (entry.target as HTMLElement).dataset.inView = String(
            entry.isIntersecting,
          );
          if (entry.isIntersecting)
            (entry.target as HTMLElement).dataset.seen = "true";
        }
      },
      { threshold: 0.08 },
    );
    home.current
      ?.querySelectorAll("[data-motion-region]")
      .forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  const [playing, setPlaying] = useState(
    () => !matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => { if (motion.matches) setPlaying(false); };
    motion.addEventListener("change", changed);
    return () => motion.removeEventListener("change", changed);
  }, []);
  const recent = [...works].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div ref={home} className={cx("home")} data-motion={playing && awake}>
      <div className={cx("home-scroll")}>
        <header className={cx("home-head")}>
          <Brand size={26} />
          <span className={cx("home-desk-name")}>{t.home.desk}</span>
          <nav className={cx("home-chapter-nav")} aria-label={t.home.exhibitionNavigation}>
            {homeChapters.map((chapter, index) => <button key={chapter} data-chapter-link={chapter} onClick={() => home.current?.querySelector('[data-home-chapter="'+chapter+'"]')?.scrollIntoView({ block: "start", behavior: playing ? "smooth" : "instant" })}>{t.home.exhibitionChapters[index].label}</button>)}
          </nav>
          <button
            className={cx("home-global-play")}
            onClick={() => setPlaying(!playing)}
            aria-label={playing ? t.home.pausePreview : t.home.playPreview}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
            <span>{t.home.motionControl}</span>
          </button>
          {signIn && (
            <button className={cx("home-login")} onClick={signIn}>
              {t.auth.login}
            </button>
          )}
          <button className={cx("home-blank")} onClick={blank}>
            <Plus size={16} />
            {t.rail.blankCanvas}
          </button>
        </header>
        <HomeShowcase playing={playing && awake} onReplay={() => setPlaying(true)} browse={chapter => home.current?.querySelector('[data-home-chapter="'+chapter+'"]')?.scrollIntoView({ block: "start", behavior: playing ? "smooth" : "instant" })} />
        <button className={cx("home-scroll-cue")} onClick={() =>
          home.current?.querySelector("[data-gallery]")?.scrollIntoView({ block: "start", behavior: playing ? "smooth" : "instant" })
        }>
          {t.home.galleryBridge}<ArrowDown size={17} />
        </button>
        <HomeExhibition playing={playing && awake} prepare={prepare} />
        <HomeJourney playing={playing && awake} onReplay={() => setPlaying(true)} />
        <section
          className={cx("home-next-drawing")}
          data-motion-region="true"
          data-in-view="false"
        >
          <svg viewBox="0 0 150 70" aria-hidden="true">
            <path
              pathLength="100"
              d="M5 10 C85 0 105 28 78 42 S39 24 98 41 L137 56 M119 39 l21 18 -24 4"
            />
          </svg>
          <h2>{t.home.nextDrawing}</h2>
          <button
            onClick={() => home.current?.querySelector("textarea")?.focus()}
          >
            {t.home.startYourIdea}
            <ArrowRight size={18} />
          </button>
        </section>
        {!signIn && (!listed || recent.length > 0) && (
          <section
            className={cx("home-recent")}
            aria-labelledby="home-recent"
            aria-busy={!listed}
          >
            <header className={cx("home-recent-heading")}>
              <h2 id="home-recent">{t.home.recent}</h2>
              {listed && (
                <span className={cx("home-count")}>{recent.length}</span>
              )}
              {recent.length > 0 && (
                <button className={cx("home-all")} onClick={all}>
                  {t.home.all}
                  <ArrowRight size={14} />
                </button>
              )}
            </header>
            {!listed ? (
              <div className={cx("home-loading")} role="status">
                {t.home.loading}
              </div>
            ) : (
              <ul className={cx("recent")}>
                {recent.map((w) => {
                  const state = progressOf(w, t);
                  return (
                    <li key={w.id}>
                      <button
                        onClick={() => open(w.id)}
                        title={w.progress.prompt || undefined}
                      >
                        <span className={cx("recent-cover")}>
                          {w.cover && !w.progress.blank ? (
                            <img
                              src={w.cover}
                              alt=""
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <i aria-hidden>
                              {w.progress.blank ? "" : w.title.slice(0, 1)}
                            </i>
                          )}
                          {!w.progress.blank && w.progress.version > 0 && (
                            <Seal version={w.progress.version} />
                          )}
                        </span>
                        <b>{w.title}</b>
                        <span
                          className={cx("work-state")}
                          data-tone={state.tone || undefined}
                        >
                          {state.text}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>
      <div className={cx("home-foot")}>
        <div className={cx("home-composer")}>{composer}</div>
      </div>
    </div>
  );
}

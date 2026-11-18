import { ArrowRight, ArrowDownRight } from "lucide-react";
import { HomeArtwork } from "./HomeArtwork.tsx";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";
import { showcase } from "./showcase.ts";

export const homeChapters = ["nature", "connections", "plans"] as const;
const works = [[8, 7, 0, 6], [1, 3, 2], [4, 5]] as const;

/** A continuous exhibition of real exports, grouped by what the reader can discover. */
export function HomeExhibition({ playing, prepare }: {
  playing: boolean;
  prepare: (request: string) => void;
}) {
  const t = useT();
  return <section className={cx("home-exhibition")} data-gallery aria-labelledby="home-gallery">
    <header className={cx("home-exhibition-intro")}>
      <span>{t.home.exhibitionKicker}</span>
      <h2 id="home-gallery">{t.home.exhibitionTitle}<em>{t.home.exhibitionTitleEnd}</em></h2>
      <p>{t.home.exhibitionDescription}</p>
      <ArrowDownRight aria-hidden="true" size={54} strokeWidth={1} />
    </header>
    {homeChapters.map((chapter, index) => <section
      key={chapter}
      className={cx("home-exhibition-chapter")}
      data-home-chapter={chapter}
      data-motion-region="true"
      data-in-view="false"
      aria-labelledby={`home-chapter-${chapter}`}
    >
      <header className={cx("home-chapter-heading")}>
        <span aria-hidden="true">0{index + 1}</span>
        <div><small>{t.home.exhibitionChapters[index].label}</small><h3 id={`home-chapter-${chapter}`}>{t.home.exhibitionChapters[index].title}</h3></div>
        <p>{t.home.exhibitionChapters[index].body}</p>
      </header>
      <ul className={cx("home-chapter-works")}>
        {works[index].map((kind, position) => {
          const item = t.home.samples[kind];
          return <li key={showcase[kind]} data-work={showcase[kind]}>
            <button className={cx("home-work-sheet")} aria-label={t.home.viewExample(item.title)} onClick={() => prepare(t.home.examples[kind])}>
              <span className={cx("home-work-label")}><span>{item.category}</span><span><i />{t.home.liveDrawing}</span></span>
              <div className={cx("home-work-picture")} aria-hidden="true"><HomeArtwork kind={kind} playing={playing} mode="tile" /></div>
              <span className={cx("home-work-caption")}>
                <span><b>{item.title}</b><span>{item.caption}</span></span>
                <span className={cx("home-work-action")}><span>{t.home.useExample}</span><ArrowRight size={19} /></span>
              </span>
            </button>
            <p className={cx("home-work-note")}><span aria-hidden="true">↳</span>{t.home.exhibitionChapters[index].notes[position]}</p>
          </li>;
        })}
      </ul>
      {index < homeChapters.length - 1 && <div className={cx("home-chapter-bridge")} aria-hidden="true">
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none"><path pathLength="100" d={index === 0 ? "M760 0 C760 65 230 18 230 96 M224 87 l6 9 6 -9" : "M230 0 C230 66 760 26 760 96 M754 87 l6 9 6 -9"} /></svg>
        <span>{t.home.exhibitionChapters[index].bridge}</span>
      </div>}
    </section>)}
  </section>;
}

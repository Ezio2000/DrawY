import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CodeXml,
  Download,
  MousePointerClick,
  NotebookPen,
  Plus,
  ScanEye,
  SlidersHorizontal,
} from "lucide-react";
import type { Work } from "../../../../modules/contracts/index.ts";
import { Composer, Unconnected } from "../Composer.tsx";
import { useAccount } from "../account.tsx";
import type { Summary } from "../api.ts";
import type { Feedback } from "../feedback.ts";
import { useT } from "../i18n.tsx";
import { progressOf } from "../Rail.tsx";
import type { Asking } from "../shell.ts";
import { useSelect } from "../session/store.ts";
import { Brand } from "../Title.tsx";
import { useLocale } from "../ui/locale.tsx";
import { reducedMotion } from "../ui/primitives.tsx";
import { cx } from "./cx.ts";
import { LiveWork } from "./LiveWork.tsx";
import { loadShowcase, useShowcase, type ShowcaseId } from "./showcase.ts";

/* The home page, told the way a drawing tool's site tells it: the box to ask in first,
 * then the range of pictures that one box draws, from a flowchart to a poster, then how
 * each is drawn, who it is for and what people ask. Every picture on it is a work DrawY
 * made (apps/showcase), drawn live by the work page's own canvas, so what it shows is what
 * the product does. */

type Words = ReturnType<typeof useT>["landing"];
/** Room the drawing leaves for what lies over its sheet: the title card above, and the
 * composer's strip below where there is one. */
const docked = { top: 64, bottom: 84 };

export function Landing({
  asking,
  feedback,
  go,
  works,
  open,
}: {
  asking: Asking;
  feedback: Feedback;
  go: (path: string) => void;
  /** The signed-in person's works, newest first; empty for a visitor. */
  works: Summary[];
  open: (id: string) => void;
}) {
  const t = useT();
  const l = t.landing;
  const locale = useLocale();
  const page = useRef<HTMLDivElement>(null);
  const solar = useShowcase("solar", locale);
  /** Hands a question to the box at the top and takes the reader there. */
  const ask = (text: string) => {
    asking.draft.hand(text);
    page.current?.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
  };
  const intro = useRef<HTMLDivElement>(null);
  return (
    <div className={cx("l-page")} ref={page}>
      <Hero
        asking={asking}
        feedback={feedback}
        go={go}
        ask={ask}
        recent={works.length > 0 && <Recent works={works} open={open} />}
        more={() => intro.current?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth" })}
      />
      {/* What DrawY is, apart from where one asks it: a sheet laid over the desk below. */}
      <div className={cx("l-intro")} ref={intro}>
        <Showpiece solar={solar} />
        <Ticker words={l} ask={ask} />
        <Story />
        <Process words={l} />
        <People words={l} />
        <Belief words={l} />
        <Closing words={l} ask={() => ask(asking.draft.get().text)} blank={() => go("/new")} />
        <Questions words={l} />
        <Footer words={l} go={go} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- hero */

/** Where one asks: the whole first screen, a desk with nothing on it but the box to write
 * in, a few questions to start from and, for someone signed in, their latest works. What
 * DrawY is waits below, a scroll away. */
function Hero({
  asking,
  feedback,
  go,
  ask,
  recent,
  more,
}: {
  asking: Asking;
  feedback: Feedback;
  go: (path: string) => void;
  ask: (text: string) => void;
  recent: ReactNode;
  /** Takes the reader down to what DrawY is. */
  more: () => void;
}) {
  const t = useT(),
    l = t.landing;
  const user = useAccount();
  const request = useSelect(asking.draft, (r) => r);
  return (
    <section className={cx("l-hero")} aria-labelledby="l-hero-title">
      <p className={cx("l-eyebrow")}>
        <Brand size={17} />
      </p>
      <h1 id="l-hero-title" className={cx("l-display")}>
        {l.title.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </h1>
      <p className={cx("l-lead")}>{l.lead}</p>
      <div className={cx("l-ask")}>
        <Composer
          place="home"
          value={request.text}
          set={asking.draft.write}
          attachments={request.attachments}
          detach={asking.draft.detach}
          uploading={request.uploading}
          focus={request.asked}
          placeholder={t.home.placeholder}
          style={request.style}
          setStyle={user ? asking.draft.setStyle : undefined}
          working={false}
          busy={false}
          send={() => void feedback.attempt(() => asking.send())}
          attach={(files) => void feedback.attempt(() => asking.upload(files))}
          pick={asking.pick}
          status={asking.blocked === "unconnected" ? <Unconnected go={go} /> : undefined}
          models={asking.models}
          choose={asking.choose}
          quota={user?.quota}
          spent={asking.blocked === "spent"}
        />
      </div>
      <div className={cx("l-tries")}>
        <span>{l.tryOne}</span>
        {t.home.examples.map((text) => (
          <button key={text} className={cx("l-chip")} onClick={() => ask(text)}>
            {text}
          </button>
        ))}
        <i aria-hidden />
        <button className={cx("l-blank")} onClick={() => go("/new")}>
          <Plus size={14} />
          {l.blank}
        </button>
      </div>
      {recent}
      <button className={cx("l-more")} onClick={more}>
        {l.more}
        <ChevronDown size={16} aria-hidden />
      </button>
    </section>
  );
}

/** The first thing below the fold: what DrawY is, and one of its works running. */
function Showpiece({ solar }: { solar: Work[] }) {
  const l = useT().landing;
  const [scene, setScene] = useState<string>();
  const latest = solar.at(-1);
  return (
    <section className={cx("l-showpiece")} aria-labelledby="l-intro-title">
      <header className={cx("l-section-head")}>
        <p className={cx("l-kicker")}>{l.introKicker}</p>
        <h2 id="l-intro-title" className={cx("l-display")} data-size="section">
          {l.introTitle}
        </h2>
        <p className={cx("l-lead")}>{l.introLead}</p>
      </header>
      <figure>
        <Board
          work={latest}
          scene={scene}
          setScene={setScene}
          foot={<Dock text={l.followUp} />}
        >
          <LiveWork work={latest} scene={scene} open={setScene} label={latest?.title} insets={docked} />
        </Board>
        <figcaption>
          <i aria-hidden />
          {l.live}
        </figcaption>
      </figure>
    </section>
  );
}

/* ---------------------------------------------------------------- the board */

/** A work as the work page frames it, in small: the title card with the scene path, and
 * the composer's strip along the foot holding what was asked. */
function Board({
  work,
  scene,
  setScene,
  foot,
  children,
}: {
  work?: Work;
  scene?: string;
  setScene?: (id: string) => void;
  foot?: ReactNode;
  children: ReactNode;
}) {
  const l = useT().landing;
  const path = useMemo(() => {
    if (!work) return [];
    const chain = [];
    let at: string | null = scene && work.scenes[scene] ? scene : work.rootSceneId;
    while (at) {
      chain.unshift(work.scenes[at]);
      at = work.scenes[at].parentId;
    }
    return chain;
  }, [work, scene]);
  return (
    <div className={cx("l-board")}>
      <div className={cx("l-board-card")}>
        <nav aria-label={l.path}>
          {path.map((s, i) => (
            <span key={s.id}>
              {i > 0 && <ChevronRight size={13} aria-hidden />}
              {i < path.length - 1 && setScene ? (
                <button onClick={() => setScene(s.id)}>{i ? s.title : work!.title}</button>
              ) : (
                <b>{i ? s.title : work!.title}</b>
              )}
            </span>
          ))}
        </nav>
      </div>
      <div className={cx("l-board-body")}>
        <div className={cx("l-board-paper")}>{children}</div>
      </div>
      {foot}
    </div>
  );
}

/** The composer's strip under a work, holding what was asked. */
function Dock({ text }: { text: string }) {
  return (
    <div className={cx("l-dock")} aria-hidden>
      <span>{text}</span>
      <i>
        <ArrowUp size={14} />
      </i>
    </div>
  );
}

/* ---------------------------------------------------------------- recent work */

function Recent({ works, open }: { works: Summary[]; open: (id: string) => void }) {
  const t = useT();
  const shown = [...works].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
  return (
    <section className={cx("l-recent")} aria-label={t.home.recent}>
      <h2>{t.home.recent}</h2>
      <ul>
        {shown.map((w) => {
          const state = progressOf(w, t);
          return (
            <li key={w.id}>
              <button onClick={() => open(w.id)}>
                <span className={cx("l-recent-cover")}>
                  {w.cover && !w.progress.blank ? <img src={w.cover} alt="" loading="lazy" /> : <i aria-hidden />}
                </span>
                <b>{w.title}</b>
                <span>{state.text}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------- what people ask */

function Ticker({ words, ask }: { words: Words; ask: (text: string) => void }) {
  const row = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined}>
      {words.questions.map((q) => (
        <li key={q}>
          <button tabIndex={hidden ? -1 : undefined} onClick={() => ask(q)}>
            {q}
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <section className={cx("l-ticker")} aria-label={words.asked}>
      <h2>{words.asked}</h2>
      <div className={cx("l-ticker-track")}>
        {row(false)}
        {row(true)}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- the range of pictures */

/** The story's chapters, from the most orderly picture to the freest: which work each
 * shows, the scene it opens on, and where it stands on the spectrum. */
const chapters: { id: ShowcaseId; scene?: string; band: number }[] = [
  { id: "model", band: 0 },
  { id: "water", band: 0 },
  { id: "space", band: 0 },
  { id: "mansion", band: 1 },
  { id: "heart", band: 2 },
  { id: "solar", scene: "earth", band: 2 },
  { id: "silk", band: 2 },
  { id: "poster", band: 3 },
  { id: "apple", band: 3 },
];

function Story() {
  const l = useT().landing;
  const locale = useLocale();
  const [at, setAt] = useState(0);
  const items = useRef<(HTMLElement | null)[]>([]);
  const near = useRef<HTMLElement>(null);
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) setAt(items.current.indexOf(e.target as HTMLElement));
      },
      { rootMargin: "-48% 0px -48% 0px" },
    );
    items.current.forEach((c) => c && seen.observe(c));
    const coming = new IntersectionObserver(([e]) => e.isIntersecting && setWanted(true), {
      rootMargin: "800px 0px",
    });
    if (near.current) coming.observe(near.current);
    return () => {
      seen.disconnect();
      coming.disconnect();
    };
  }, []);
  // The work in view, and the next, are loaded before the reader gets there.
  const [loaded, setLoaded] = useState<Partial<Record<ShowcaseId, Work>>>({});
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    for (const c of chapters.slice(0, Math.min(chapters.length, at + 2)))
      void loadShowcase(c.id, locale).then((v) => live && setLoaded((m) => ({ ...m, [c.id]: v.at(-1) })));
    return () => {
      live = false;
    };
  }, [wanted, at, locale]);
  const chapter = chapters[at];
  const [scene, setScene] = useState<string>();
  useEffect(() => setScene(chapter.scene), [at]);
  const work = loaded[chapter.id];
  return (
    <section className={cx("l-story")} aria-labelledby="l-story-title" ref={near}>
      <header className={cx("l-section-head")}>
        <p className={cx("l-kicker")}>{l.storyKicker}</p>
        <h2 id="l-story-title" className={cx("l-display")} data-size="section">
          {l.storyTitle}
        </h2>
        <p className={cx("l-lead")}>{l.storyLead}</p>
      </header>
      <div className={cx("l-story-grid")}>
        <ol className={cx("l-chapters")}>
          {l.chapters.map((c, i) => (
            <li
              key={c.kind}
              ref={(el) => {
                items.current[i] = el;
              }}
              data-on={i === at || undefined}
            >
              <span className={cx("l-chapter-n")}>
                {String(i + 1).padStart(2, "0")} · {l.spectrum[chapters[i].band]} · {c.kind}
              </span>
              <h3>{c.title}</h3>
              <p>{c.text}</p>
            </li>
          ))}
        </ol>
        <div className={cx("l-story-stage")}>
          <Board
            work={work}
            scene={scene}
            setScene={setScene}
            foot={<Dock text={l.chapters[at].ask} />}
          >
            <LiveWork work={work} scene={scene} open={setScene} label={work?.title} insets={docked} />
          </Board>
          <Spectrum band={chapter.band} at={at} />
        </div>
      </div>
    </section>
  );
}

/** Where the picture in view stands, from the most orderly to the freest. */
function Spectrum({ band, at }: { band: number; at: number }) {
  const l = useT().landing;
  return (
    <div className={cx("l-spectrum")} aria-hidden>
      <div className={cx("l-spectrum-track")}>
        {chapters.map((c, i) => (
          <i key={i} data-on={i === at || undefined} data-past={i < at || undefined} />
        ))}
      </div>
      <div className={cx("l-spectrum-names")}>
        {l.spectrum.map((name, i) => (
          <span key={name} data-on={i === band || undefined}>
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- how each is drawn */

const processIcons = [NotebookPen, CodeXml, ScanEye, MousePointerClick, SlidersHorizontal, Download];

function Process({ words }: { words: Words }) {
  return (
    <section className={cx("l-process")} aria-labelledby="l-process-title">
      <header className={cx("l-section-head")}>
        <p className={cx("l-kicker")}>{words.processKicker}</p>
        <h2 id="l-process-title" className={cx("l-display")} data-size="section">
          {words.processTitle}
        </h2>
      </header>
      <ul className={cx("l-process-grid")}>
        {words.process.map((p, i) => {
          const Icon = processIcons[i];
          return (
            <li key={p.title}>
              <span className={cx("l-process-icon")}>
                <Icon size={18} />
              </span>
              <b>{p.title}</b>
              <p>{p.text}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------- who for */

function People({ words }: { words: Words }) {
  return (
    <section className={cx("l-people")} aria-labelledby="l-people-title">
      <header className={cx("l-section-head")}>
        <h2 id="l-people-title" className={cx("l-display")} data-size="section">
          {words.peopleTitle}
        </h2>
        <p className={cx("l-lead")}>{words.peopleLead}</p>
      </header>
      <ul className={cx("l-people-list")}>
        {words.people.map((p, i) => (
          <li key={p.who}>
            <span className={cx("l-people-n")}>{String(i + 1).padStart(2, "0")}</span>
            <b>{p.who}</b>
            <p>{p.what}</p>
            <span className={cx("l-tags")}>
              {p.tags.map((tag) => (
                <i key={tag}>{tag}</i>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Belief({ words }: { words: Words }) {
  return (
    <section className={cx("l-belief")}>
      <blockquote>
        {words.belief.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </blockquote>
      <p>— {words.beliefBy}</p>
    </section>
  );
}

function Closing({ words, ask, blank }: { words: Words; ask: () => void; blank: () => void }) {
  const t = useT();
  return (
    <section className={cx("l-closing")}>
      <h2 className={cx("l-display")} data-size="section">
        {words.ctaTitle}
      </h2>
      <p>{words.ctaLead}</p>
      <div>
        <button className={cx("primary", "l-cta")} onClick={ask}>
          {words.ctaStart}
          <ArrowUp size={16} />
        </button>
        <button className={cx("secondary", "l-cta")} onClick={blank}>
          <Plus size={16} />
          {t.landing.blank}
        </button>
      </div>
    </section>
  );
}

function Questions({ words }: { words: Words }) {
  return (
    <section className={cx("l-faq")} aria-labelledby="l-faq-title">
      <header>
        <h2 id="l-faq-title" className={cx("l-display")} data-size="section">
          {words.faqTitle}
        </h2>
        <p>{words.faqLead}</p>
      </header>
      <div>
        {words.faq.map((f) => (
          <details key={f.q}>
            <summary>
              {f.q}
              <Plus size={16} aria-hidden />
            </summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Footer({ words, go }: { words: Words; go: (path: string) => void }) {
  const t = useT();
  return (
    <footer className={cx("l-footer")}>
      <div className={cx("l-footer-brand")}>
        <Brand size={22} />
        <p>{words.footer}</p>
      </div>
      <nav aria-label={words.footerProduct}>
        <b>{words.footerProduct}</b>
        <button onClick={() => go("/new")}>{words.blank}</button>
        <button onClick={() => go("/library")}>{words.footerLibrary}</button>
      </nav>
      <nav aria-label={words.footerWorks}>
        <b>{words.footerWorks}</b>
        {t.home.examples.map((e) => (
          <span key={e}>{e}</span>
        ))}
      </nav>
      <p className={cx("l-footer-line")}>© 2026 DrawY · {words.footer}</p>
    </footer>
  );
}

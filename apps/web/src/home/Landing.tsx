import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import {
  ArrowUp,
  ChevronDown,
  ChevronLeft,
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
import { scroller, turnedUp, useCycledTyping } from "./motion.ts";
import { loadShowcase, useShowcase, type ShowcaseId } from "./showcase.ts";

/* The home page, told the way a drawing tool's site tells it: the box to ask in first,
 * then the range of pictures that one box draws — one lighthouse, asked about from a
 * painting of it to the family who built it — then how each is drawn, who it is for and
 * what people ask. Every picture on it is a work DrawY made (apps/showcase), drawn live by
 * the work page's own canvas, so what it shows is what the product does. */

type Words = ReturnType<typeof useT>["landing"];
/** Room the drawing leaves at the edges of its sheet; inside a scene, more at the top for
 * the way back. */
const margins = (inScene: boolean) => ({ top: inScene ? 52 : 20, bottom: 20 });

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
  // An empty box types out, one after another, what the works further down were asked.
  const [inBox, setInBox] = useState(false);
  const asks = useMemo(() => l.chapters.map((c) => c.ask), [l]);
  const typed = useCycledTyping(asks, inBox || request.text !== "");
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
      <div
        className={cx("l-ask")}
        // Focus alone, which the box may take by itself, does not stop it: a press or a key does.
        onPointerDown={() => setInBox(true)}
        onKeyDown={() => setInBox(true)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setInBox(false)}
      >
        <Composer
          place="home"
          value={request.text}
          set={asking.draft.write}
          attachments={request.attachments}
          detach={asking.draft.detach}
          uploading={request.uploading}
          focus={request.asked}
          placeholder={inBox ? t.home.placeholder : typed}
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
        <Sheet work={latest} scene={scene} setScene={setScene}>
          <LiveWork
            work={latest}
            scene={scene}
            open={setScene}
            label={latest?.title}
            insets={margins(!!latest && !!scene && scene !== latest.rootSceneId)}
          />
        </Sheet>
        <figcaption>
          <i aria-hidden />
          {l.live}
        </figcaption>
      </figure>
    </section>
  );
}

/* ---------------------------------------------------------------- the sheet */

/** A work on a sheet of paper and nothing else: only once one has gone into one of its
 * scenes does a small way back appear along the top. */
function Sheet({
  work,
  scene,
  setScene,
  children,
}: {
  work?: Work;
  scene?: string;
  setScene: (id: string) => void;
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
  const up = path.at(-2);
  return (
    <div className={cx("l-sheet")}>
      <div className={cx("l-sheet-paper")}>{children}</div>
      {up && (
        <nav className={cx("l-sheet-back")} aria-label={l.path}>
          <button onClick={() => setScene(up.id)}>
            <ChevronLeft size={14} aria-hidden />
            {path.length > 2 ? up.title : work!.title}
          </button>
          <b>{path.at(-1)!.title}</b>
        </nav>
      )}
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

/** The story's chapters: one lighthouse, asked about further and further, from a painting
 * of it to the family who built it — the freest picture first, the most orderly last. Which
 * work each shows, the scene it opens on, and where it stands on the spectrum. */
const chapters: { id: ShowcaseId; scene?: string; band: number }[] = [
  { id: "night", band: 0 },
  { id: "styles", band: 0 },
  { id: "inside", band: 1 },
  { id: "lens", band: 1 },
  { id: "rhythm", band: 2 },
  { id: "range", band: 2 },
  { id: "coast", band: 2 },
  { id: "navigate", band: 3 },
  { id: "history", band: 3 },
  { id: "family", band: 3 },
];

/** Where the reading line falls, and how much scrolling one handover takes. */
function reading(page: HTMLElement) {
  const h = page.clientHeight;
  const narrow = matchMedia("(max-width: 820px)").matches;
  return {
    line: page.getBoundingClientRect().top + h * (narrow ? 0.8 : 0.5),
    span: Math.min(420, h * 0.45),
  };
}

function scrollToChapter(item: HTMLElement) {
  const page = scroller(item);
  const { line, span } = reading(page);
  const top = item.getBoundingClientRect().top;
  page.scrollBy({ top: top - (line - span / 2 - 16), behavior: reducedMotion() ? "auto" : "smooth" });
}

/** The range told along a dark drafting band: the chapters scroll past on one side while a
 * pad on the other stays put, a chapter's work to each sheet. As the next chapter comes up to
 * the middle of the screen, the sheet in view is turned up by its bottom right corner, the
 * paper's back curling over with the light on it, and the next lies beneath in its shadow
 * until the sheet has gone over the top. The turn follows the scrolling rather than a timer,
 * so scrolling back lays the sheet down again. The band's grid drifts by a little slower than
 * the page. */
function Story() {
  const l = useT().landing;
  const locale = useLocale();
  const band = useRef<HTMLElement>(null);
  const items = useRef<(HTMLElement | null)[]>([]);
  const slots = useRef<(HTMLDivElement | null)[]>([]);
  const shades = useRef<(HTMLElement | null)[]>([]);
  const flap = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  /** The chapter shown whole when nothing is handing over; the next waits in the other slot. */
  const [from, setFrom] = useState(0);
  /** The chapter being read: whichever of the two is more than half in. */
  const [at, setAt] = useState(0);
  const [wanted, setWanted] = useState(false);

  useEffect(() => {
    const el = band.current!;
    const page = scroller(el);
    let frame = 0;
    /** Lays a sheet on the pad: what of it is left lying flat (`keep`, all of it when not
     * given), the shadow on it (`shade`), whether it lies on top, and whether it shows. */
    const place = (s: number, keep: string, shade: string, over: boolean, shown: boolean) => {
      const slot = slots.current[s];
      if (!slot) return;
      slot.style.clipPath = keep;
      slot.style.zIndex = over ? "2" : "1";
      slot.style.visibility = shown ? "visible" : "hidden";
      const dim = shades.current[s];
      if (dim) dim.style.backgroundImage = shade;
    };
    const measure = () => {
      frame = 0;
      const { line, span } = reading(page);
      const tops = items.current.map((c) => c?.getBoundingClientRect().top ?? Infinity);
      let a = 0;
      for (let k = 1; k < tops.length; k++) if (tops[k] <= line - span / 2) a = k;
      let p = a + 1 < tops.length ? Math.min(1, Math.max(0, 0.5 + (line - tops[a + 1]) / span)) : 0;
      if (reducedMotion()) p = p < 0.5 ? 0 : 1;
      const eased = p * p * (3 - 2 * p);
      const pad = slots.current[0]?.parentElement;
      const sheet = eased > 0.001 && eased < 1 && pad ? turnedUp(eased, pad.clientWidth, pad.clientHeight) : undefined;
      place(a % 2, sheet?.keep ?? "", "", true, eased < 1);
      place((a + 1) % 2, "", sheet?.cast ?? "", false, eased > 0.001 && a + 1 < tops.length);
      const back = flap.current;
      if (back) {
        back.style.visibility = sheet ? "visible" : "hidden";
        if (sheet) {
          back.style.clipPath = sheet.fold;
          back.style.transform = sheet.flip;
          back.style.setProperty("--curl", sheet.back);
        }
      }
      // Each chapter's words light up as its sheet comes up and dim as it is turned away, in
      // step with the turn: --light is how far a chapter is the one being read, 0 to 1.
      const into = (k: number) =>
        k === 0 ? 1 : k >= tops.length ? 0 : Math.min(1, Math.max(0, 0.5 + (line - tops[k]) / span));
      items.current.forEach((item, k) => {
        if (!item) return;
        let light = into(k) * (1 - into(k + 1));
        if (reducedMotion()) light = light < 0.5 ? 0 : 1;
        item.style.setProperty("--light", (light * light * (3 - 2 * light)).toFixed(3));
      });
      track.current?.style.setProperty("--sp", String((a + p) / (chapters.length - 1)));
      if (!reducedMotion())
        el.style.setProperty("--drift", `${-(el.getBoundingClientRect().top - page.getBoundingClientRect().top) * 0.2}px`);
      setFrom(a);
      setAt(p < 0.5 ? a : a + 1);
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(measure);
    };
    measure();
    page.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const coming = new IntersectionObserver(([e]) => e.isIntersecting && setWanted(true), {
      rootMargin: "800px 0px",
    });
    coming.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      page.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      coming.disconnect();
    };
  }, []);

  /** Scrolls the page until chapter `k` is the one in view. */
  const jump = (k: number) => {
    const item = items.current[k];
    if (item) scrollToChapter(item);
  };

  // Every chapter's work is loaded as the band comes near, all at once (they are small), so a
  // jump along the range never waits on one halfway.
  const [loaded, setLoaded] = useState<Partial<Record<ShowcaseId, Work>>>({});
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    for (const c of chapters)
      void loadShowcase(c.id, locale).then((v) => live && setLoaded((m) => ({ ...m, [c.id]: v.at(-1) })));
    return () => {
      live = false;
    };
  }, [wanted, locale]);
  // A scene one went into is left again once its board moves on to another chapter.
  const [scenes, setScenes] = useState<Record<number, string>>({});
  useEffect(() => setScenes((m) => Object.fromEntries(Object.entries(m).filter(([k]) => +k === from || +k === from + 1))), [from]);
  /** Which chapter each board holds: `from` in one, the chapter after it in the other. */
  const held = [0, 1].map((s) => (s === from % 2 ? from : from + 1 < chapters.length ? from + 1 : from - 1));
  return (
    <section className={cx("l-story")} aria-labelledby="l-story-title" ref={band}>
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
              key={chapters[i].id}
              ref={(el) => {
                items.current[i] = el;
              }}
              id={`l-chapter-${chapters[i].id}`}
              data-on={i === at || undefined}
              onClick={() => i !== at && jump(i)}
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
          <div className={cx("l-story-boards")}>
            {held.map((k, s) => {
              const work = loaded[chapters[k].id];
              const scene = scenes[k] ?? chapters[k].scene;
              const go = (id: string) => setScenes((m) => ({ ...m, [k]: id }));
              return (
                <div
                  key={s}
                  className={cx("l-story-slot")}
                  ref={(el) => {
                    slots.current[s] = el;
                  }}
                  inert={k !== at}
                >
                  <Sheet work={work} scene={scene} setScene={go}>
                    <LiveWork
                      work={work}
                      scene={scene}
                      open={go}
                      label={work?.title}
                      insets={margins(!!work && !!scene && scene !== work.rootSceneId)}
                    />
                  </Sheet>
                  {/* The shadow of the sheet being turned, on the one beneath. */}
                  <i
                    className={cx("l-story-shade")}
                    aria-hidden
                    ref={(el) => {
                      shades.current[s] = el;
                    }}
                  />
                </div>
              );
            })}
            {/* The back of the sheet being turned, folded over its face. */}
            <span className={cx("l-story-curl")} aria-hidden>
              <i ref={flap} />
            </span>
          </div>
          <Spectrum band={chapters[at].band} at={at} jump={jump} track={track} />
        </div>
      </div>
    </section>
  );
}

/** Where the picture in view stands, from the most orderly to the freest: a dot per chapter
 * along a line that fills as one reads, and the four kinds under them. Any of them takes the
 * reader there. */
function Spectrum({
  band,
  at,
  jump,
  track,
}: {
  band: number;
  at: number;
  jump: (k: number) => void;
  track: RefObject<HTMLDivElement | null>;
}) {
  const l = useT().landing;
  return (
    <nav className={cx("l-spectrum")} aria-label={l.spectrumNav} style={{ "--chapters": chapters.length } as CSSProperties}>
      <div className={cx("l-spectrum-track")} ref={track}>
        {chapters.map((c, i) => (
          <button
            key={c.id}
            aria-label={l.chapters[i].title}
            aria-current={i === at || undefined}
            data-on={i === at || undefined}
            data-past={i < at || undefined}
            onClick={() => jump(i)}
          >
            <i />
          </button>
        ))}
      </div>
      <div className={cx("l-spectrum-names")}>
        {l.spectrum.map((name, i) => (
          <button
            key={i}
            style={{ gridColumn: `span ${chapters.filter((c) => c.band === i).length}` }}
            data-on={i === band || undefined}
            onClick={() => jump(chapters.findIndex((c) => c.band === i))}
          >
            {name}
          </button>
        ))}
      </div>
    </nav>
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
      <nav aria-label={words.footerWorks} className={cx("l-footer-kinds")}>
        <b>{words.footerWorks}</b>
        {chapters.map((c, i) => (
          <button
            key={c.id}
            onClick={() => {
              const item = document.getElementById(`l-chapter-${c.id}`);
              if (item) scrollToChapter(item);
            }}
          >
            {words.chapters[i].kind.split(" · ")[0]}
          </button>
        ))}
      </nav>
      <p className={cx("l-footer-line")}>© 2026 DrawY · {words.footer}</p>
    </footer>
  );
}

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { ChevronLeft } from "lucide-react";
import type { Work } from "../../../../modules/contracts/index.ts";
import { Composer, Unconnected } from "../Composer.tsx";
import { useAccount } from "../account.tsx";
import type { Feedback } from "../feedback.ts";
import { useT } from "../i18n.tsx";
import type { Asking } from "../shell.ts";
import { useSelect } from "../session/store.ts";
import { Brand } from "../Title.tsx";
import * as Hand from "../ui/brand/icons.tsx";
import { useLocale } from "../ui/locale.tsx";
import { reducedMotion } from "../ui/primitives.tsx";
import { cx } from "./cx.ts";
import { LiveWork } from "./LiveWork.tsx";
import { scroller, turnedUp, useCycledTyping } from "./motion.ts";
import { loadShowcase, type ShowcaseId } from "./showcase.ts";

/* The home page: the box to ask in first, then the pictures that one box draws — one
 * lighthouse, asked about from a painting of it to the family who built it — then what
 * one can do with a picture once drawn, and what people ask. Every picture on it is a work
 * DrawY made (apps/showcase), drawn live by the work page's own canvas, so what it shows
 * is what the product does. */

type Words = ReturnType<typeof useT>["landing"];
/** Room the drawing leaves at the edges of its sheet; inside a scene, more at the top for
 * the way back. */
const margins = (inScene: boolean) => ({ top: inScene ? 52 : 20, bottom: 20 });

export function Landing({
  asking,
  feedback,
  go,
}: {
  asking: Asking;
  feedback: Feedback;
  go: (path: string) => void;
}) {
  const l = useT().landing;
  const page = useRef<HTMLDivElement>(null);
  /** Hands a question to the box at the top and takes the reader there. */
  const ask = (text: string) => {
    asking.draft.hand(text);
    page.current?.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
  };
  const story = useRef<HTMLElement>(null);
  return (
    <div className={cx("l-page")} ref={page}>
      <Hero
        asking={asking}
        feedback={feedback}
        go={go}
        ask={ask}
        more={() => story.current?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth" })}
      />
      {/* What DrawY draws, apart from where one asks it: a sheet laid over the desk below. */}
      <div className={cx("l-intro")}>
        <Story band={story} />
        <Ticker words={l} ask={ask} />
        <Features words={l} />
        <Questions words={l} />
        <Footer words={l} go={go} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- hero */

/** Where one asks: the whole first screen, a desk with nothing on it but the box to write
 * in and a few questions to start from. What DrawY draws waits below, a scroll away. */
function Hero({
  asking,
  feedback,
  go,
  ask,
  more,
}: {
  asking: Asking;
  feedback: Feedback;
  go: (path: string) => void;
  ask: (text: string) => void;
  /** Takes the reader down to what DrawY draws. */
  more: () => void;
}) {
  const t = useT(),
    l = t.landing;
  const user = useAccount();
  const request = useSelect(asking.draft, (r) => r);
  // An empty box types out, one after another, what the works further down were asked.
  const [inBox, setInBox] = useState(false);
  const examples = useMemo(() => {
    const [reference, ...rest] = l.chapters;
    return [...rest.slice(0, 2), reference, ...rest.slice(2)];
  }, [l.chapters]);
  const asks = useMemo(() => examples.map((c) => c.ask), [examples]);
  const occupied = inBox || request.text !== "" || request.attachments.length > 0 || request.uploading > 0;
  const typed = useCycledTyping(asks, occupied);
  const showReference = !occupied && examples[typed.index] === l.chapters[0];
  return (
    <section className={cx("l-hero")} aria-labelledby="l-hero-title">
      <h1 id="l-hero-title" className={cx("l-display")}>
        {l.title.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </h1>
      <p className={cx("l-lead")}>{l.lead}</p>
      <div
        className={cx("l-ask")}
        data-reference={showReference || undefined}
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
          placeholder={t.home.placeholder}
          ghostPlaceholder={occupied ? undefined : typed.text}
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
        {showReference && (
          <img
            className={cx("l-ask-reference")}
            src={referenceImage}
            alt={l.referenceAlt}
          />
        )}
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
          <Hand.Plus size={15} />
          {l.blank}
        </button>
      </div>
      <button className={cx("l-more")} onClick={more}>
        {l.more}
        <Hand.Down size={17} />
      </button>
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

/** The story's chapters, the work each shows: one lighthouse, asked about further and
 * further, from a painting of it to the family who built it — the freest picture first,
 * the most orderly last. */
const referenceImage = "/style-reference-lighthouse.webp";
const chapters: ShowcaseId[] = [
  "reference",
  "night",
  "styles",
  "inside",
  "lens",
  "rhythm",
  "range",
  "coast",
  "navigate",
  "history",
  "family",
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

/** The range told along a light drafting band: the chapters scroll past on one side while a
 * pad on the other stays put, a chapter's work to each sheet. As the next chapter comes up to
 * the middle of the screen, the sheet in view is turned up by its bottom right corner, the
 * paper's back curling over with the light on it, and the next lies beneath in its shadow
 * until the sheet has gone over the top. The turn follows the scrolling rather than a timer,
 * so scrolling back lays the sheet down again. The band's dots drift by a little slower than
 * the page. */
function Story({ band }: { band: RefObject<HTMLElement | null> }) {
  const l = useT().landing;
  const locale = useLocale();
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
      void loadShowcase(c, locale).then((v) => live && setLoaded((m) => ({ ...m, [c]: v.at(-1) })));
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
    <section className={cx("l-drafting-band", "l-story")} aria-labelledby="l-story-title" ref={band}>
      <header className={cx("l-section-head")}>
        <h2 id="l-story-title" className={cx("l-display")} data-size="section">
          {l.storyTitle}
        </h2>
        <p className={cx("l-lead")}>{l.storyLead}</p>
      </header>
      <div className={cx("l-story-grid")}>
        <ol className={cx("l-chapters")}>
          {l.chapters.map((c, i) => (
            <li
              key={chapters[i]}
              ref={(el) => {
                items.current[i] = el;
              }}
              id={`l-chapter-${chapters[i]}`}
              data-on={i === at || undefined}
              onClick={() => i !== at && jump(i)}
            >
              <span className={cx("l-chapter-n")}>
                {String(i + 1).padStart(2, "0")} · {c.kind}
              </span>
              <h3>{c.title}</h3>
              <p>{c.text}</p>
            </li>
          ))}
        </ol>
        <div className={cx("l-story-stage")}>
          <div className={cx("l-story-boards")}>
            {held.map((k, s) => {
              const work = loaded[chapters[k]];
              const scene = scenes[k];
              const isReference = chapters[k] === "reference";
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
                    {isReference ? (
                      <ReferenceSheet work={work} active={k === at} />
                    ) : (
                      <LiveWork
                        work={work}
                        scene={scene}
                        open={go}
                        label={work?.title}
                        insets={margins(!!work && !!scene && scene !== work.rootSceneId)}
                      />
                    )}
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
          <Pager at={at} jump={jump} track={track} />
        </div>
      </div>
    </section>
  );
}

/** Start the drawing when its page is visible, including a turn back to the first page. */
function ReferenceSheet({ work, active }: { work?: Work; active: boolean }) {
  const l = useT().landing;
  const sheet = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.intersectionRatio >= 0.35),
      { threshold: 0.35 },
    );
    observer.observe(sheet.current!);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={sheet} className={cx("l-reference-sheet")} data-drawing={active && visible && !!work || undefined}>
      <p className={cx("l-reference-prompt")}>
        <span>{l.referencePrompt}</span>
        <q>{l.chapters[0].ask}</q>
      </p>
      <figure>
        <figcaption>{l.referenceCaption}</figcaption>
        <img src={referenceImage} alt={l.referenceAlt} loading="lazy" />
      </figure>
      <svg className={cx("l-reference-arrow")} viewBox="0 0 88 42" fill="none" aria-hidden="true">
        <path d="M4 27C30 7 51 33 80 16" stroke="#b34430" strokeWidth="2.5" strokeLinecap="round" pathLength="1" />
        <path d="m64 13 16 3-8 13" stroke="#b34430" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
      </svg>
      <figure>
        <figcaption>{l.referenceResult}</figcaption>
        <div className={cx("l-reference-result")}>
          <LiveWork work={work} label={work?.title} />
        </div>
      </figure>
      <div className={cx("l-reference-notes")}>
        <span>{l.referenceShared}</span>
        <ul>
          {l.referenceTraits.map((trait) => <li key={trait}><i aria-hidden />{trait}</li>)}
        </ul>
      </div>
    </div>
  );
}

/** Which picture is in view: a dot per chapter along a line that fills as one reads, each
 * named by its title and taking the reader there. */
function Pager({ at, jump, track }: { at: number; jump: (k: number) => void; track: RefObject<HTMLDivElement | null> }) {
  const l = useT().landing;
  return (
    <nav className={cx("l-pager")} aria-label={l.chaptersNav} style={{ "--chapters": chapters.length } as CSSProperties}>
      <div className={cx("l-pager-track")} ref={track}>
        {chapters.map((c, i) => (
          <button
            key={c}
            aria-label={l.chapters[i].title}
            aria-current={i === at || undefined}
            data-tip={l.chapters[i].kind}
            data-on={i === at || undefined}
            data-past={i < at || undefined}
            onClick={() => jump(i)}
          >
            <i />
          </button>
        ))}
      </div>
    </nav>
  );
}

/* ---------------------------------------------------------------- once it is drawn */

const featureIcons = [Hand.Loupe, Hand.Pencil, Hand.Talk, Hand.Versions, Hand.Palette, Hand.Export];

function Features({ words }: { words: Words }) {
  return (
    <section className={cx("l-features")} aria-labelledby="l-features-title">
      <h2 id="l-features-title" className={cx("l-display")} data-size="section">
        {words.featuresTitle}
      </h2>
      <ul>
        {words.features.map((p, i) => {
          const Icon = featureIcons[i];
          return (
            <li key={p.title}>
              <Icon size={30} />
              <b>{p.title}</b>
              <p>{p.text}</p>
            </li>
          );
        })}
      </ul>
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
      </header>
      <div>
        {words.faq.map((f) => (
          <details key={f.q}>
            <summary>
              {f.q}
              <Hand.Plus size={17} />
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
            key={c}
            onClick={() => {
              const item = document.getElementById(`l-chapter-${c}`);
              if (item) scrollToChapter(item);
            }}
          >
            {words.chapters[i].kind}
          </button>
        ))}
      </nav>
      <p className={cx("l-footer-line")}>© 2026 DrawY · {words.footer}</p>
    </footer>
  );
}

import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";
import { journeyRequest } from "./journey.ts";

const starts = [0, 3800, 11800, 18800];
const duration = 28000;

/** One continuous demonstration: the same request, drawing and generated detail. */
export function HomeJourney({ playing, onReplay }: {
  playing: boolean;
  onReplay: () => void;
}) {
  const t = useT();
  const canvas = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [visible, setVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const [elapsed, setElapsed] = useState(playing ? 0 : starts[2]);
  const phase = elapsed < starts[1] ? 0 : elapsed < starts[2] ? 1 : elapsed < starts[3] ? 2 : 3;
  const tourStop = Math.min(3, Math.max(0, Math.floor((elapsed - starts[2]) / 1750)));
  const active = playing && visible && ready;
  useEffect(() => {
    const view = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.15 });
    if (canvas.current) view.observe(canvas.current);
    return () => view.disconnect();
  }, []);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow && event.data?.type === "drawy:showcase-ready") setReady(true);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: "drawy:showcase-play", playing: active && phase >= 2 }, "*");
  }, [active, phase, ready]);
  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage({ type: "drawy:journey-stage", detail: phase === 3, automatic: active }, "*");
  }, [phase, ready]);
  useEffect(() => {
    if (!ready || !canvas.current) return;
    const element = canvas.current;
    const layout = () => frame.current?.contentWindow?.postMessage({
      type: "drawy:journey-layout",
      artHeight: parseFloat(getComputedStyle(element, "::before").height),
      stacked: matchMedia("(max-width: 1100px)").matches,
    }, "*");
    const observer = new ResizeObserver(layout);
    observer.observe(element);
    layout();
    return () => observer.disconnect();
  }, [ready]);
  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage({ type: "drawy:journey-timeline", elapsed, playing: active }, "*");
  }, [elapsed, active, ready]);
  useEffect(() => {
    if (!active) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now(), delta = Math.min(now - previous, 250);
      previous = now;
      setElapsed((value) => (value + delta) % duration);
    }, 100);
    return () => clearInterval(timer);
  }, [active]);
  const request = phase === 0 && playing && ready
    ? journeyRequest.slice(0, Math.max(1, Math.ceil(journeyRequest.length * elapsed / 3000)))
    : journeyRequest;
  return (
    <section className={cx("home-film")} data-journey data-phase={phase} data-playing={active} aria-labelledby="home-journey-heading">
      <div className={cx("home-film-copy")}>
        <h2 id="home-journey-heading">{t.home.filmHeadline}<span>{t.home.filmHeadlineEnd}<svg viewBox="0 0 310 20" preserveAspectRatio="none" aria-hidden="true"><path pathLength="100" d="M5 13 Q140 1 304 8 M20 18 Q171 8 285 15" /></svg></span></h2>
        <p className={cx("home-film-description")}>{t.home.filmDescription}</p>
      </div>
      <div className={cx("home-film-desk")}>
        <div className={cx("home-film-sheet")}>
          <header aria-hidden={phase !== 0}>
            <div className={cx("home-film-request")} title={journeyRequest}>
              <span>{t.home.journeyRequestLabel}</span>
              <p>{request}<i aria-hidden="true" data-typing={phase === 0 && active} /></p>
            </div>
            <small>{t.home.filmAutomatic}</small>
          </header>
          <div ref={canvas} className={cx("home-film-canvas")}>
            <div className={cx("home-film-grid")} aria-hidden="true" />
            <img src="/showcase/journey.png" alt={t.home.journeyWorkTitle} data-shown={!ready} />
            <iframe ref={frame} src="/showcase/journey.html" title={t.home.journeyFrameTitle} sandbox="allow-scripts" data-preview="journey" data-shown={ready} aria-hidden={!ready} tabIndex={-1} inert />
            <div className={cx("home-film-opening")} data-shown={phase === 0 && ready} aria-hidden={phase !== 0}>
              <img src="/showcase/journey.png" alt="" aria-hidden="true" />
              <div className={cx("home-film-question")}><span>{t.home.filmOpening}</span><b>{t.home.journeyQuestion}</b><svg viewBox="0 0 180 36" aria-hidden="true"><path pathLength="100" d="M10 10 Q110 2 167 25 M148 10 l20 16 -24 2" /></svg></div>
            </div>
            <div className={cx("home-film-chapter")} key={phase} aria-hidden="true">
              <span>{String(phase + 1).padStart(2, "0")}</span>
              <div><small>{t.home.journeyWorkTitle}</small><b>{t.home.filmStages[phase].short}</b></div>
            </div>
            <div className={cx("home-film-signal")} aria-hidden="true"><i /><span>{t.home.journeyLabel}</span></div>
            <div className={cx("home-film-tour-caption")} data-shown={phase === 2} aria-hidden="true">
              <small>{t.home.filmTourTitle}</small><b key={tourStop}>{t.home.filmTourStops[tourStop]}</b>
            </div>
          </div>
        </div>
        <ol className={cx("home-film-timeline")} aria-label={t.home.filmTimeline}>
          {t.home.filmStages.map((item, index) => <li key={item.title} data-active={phase === index} data-complete={phase > index}>
            <button onClick={() => setElapsed(starts[index])} aria-current={phase === index ? "step" : undefined}><span>{String(index + 1).padStart(2, "0")}</span>{item.short}</button>
            <i aria-hidden="true"><span style={{width: `${phase > index ? 100 : phase < index ? 0 : (elapsed - starts[index]) / ((starts[index + 1] ?? duration) - starts[index]) * 100}%`}} /></i>
          </li>)}
        </ol>
        <footer><span>{phase === 3 ? t.home.filmDetailCaption : t.home.journeyRecorded}</span><button aria-label={t.home.journeyReplay} onClick={() => {setElapsed(0); onReplay();}}><RotateCcw size={14} /></button></footer>
      </div>
    </section>
  );
}

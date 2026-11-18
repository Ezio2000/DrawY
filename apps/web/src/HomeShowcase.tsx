import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownRight, RotateCcw } from "lucide-react";
import { HomeArtwork } from "./HomeArtwork.tsx";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";

const original = { title: "云上画室", recolored: false, offset: 0, selected: "" };
type Draft = typeof original;

/** Public, disposable edits of the real exported work. No account or model call. */
export function HomeShowcase({ playing, onReplay, browse }: {
  playing: boolean;
  onReplay: () => void;
  browse: (chapter: string) => void;
}) {
  const t = useT();
  const element = useRef<HTMLElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [manual, setManual] = useState<Draft | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const pauseRef = useRef(() => {});
  const pauseDemo = useCallback(() => pauseRef.current(), []);
  const phase = Math.floor(elapsed / 4000);
  const centerPhase = Math.min(3, Math.max(0, phase - 1));
  const draft = manual ?? {
    title: centerPhase >= 3 ? t.home.editNewTitle : original.title,
    recolored: centerPhase >= 1,
    offset: centerPhase >= 2 ? 72 : 0,
    selected: ["", "roof", "balloon", "sign"][centerPhase],
  };
  pauseRef.current = () => setManual({...draft});
  const active = playing && visible && ready && !manual;
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .15 });
    if (element.current) observer.observe(element.current);
    const receive = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow && event.data?.type === "drawy:edit-ready") setReady(true);
    };
    window.addEventListener("message", receive);
    return () => { observer.disconnect(); window.removeEventListener("message", receive); };
  }, []);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setElapsed(value => (value + 200) % 24000), 200);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    if (!ready) return;
    frame.current?.contentWindow?.postMessage({ type: "drawy:edit-demo", ...draft }, "*");
  }, [ready, draft.title, draft.recolored, draft.offset, draft.selected]);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: "drawy:showcase-play", playing: playing && visible }, "*");
  }, [ready, playing, visible]);
  const change = (next: Partial<Draft>) => setManual({ ...draft, ...next });
  return <section ref={element} className={cx("home-showcase")} data-home-showcase data-edit-phase={manual ? "manual" : phase} aria-labelledby="home-heading">
    <header className={cx("home-showcase-heading")}>
      <div><span>{t.home.heroKinds}</span><h1 id="home-heading">{t.home.heroTitle}<em>{t.home.heroTitleEnd}</em></h1></div>
      <p>{t.home.heroDescription}</p>
    </header>
    <div className={cx("home-showcase-world")}>
      <svg className={cx("home-world-thread")} viewBox="0 0 1320 540" preserveAspectRatio="none" aria-hidden="true"><path d="M60 290 C160 158 290 180 400 280 S690 445 900 310 S1170 180 1270 290" /></svg>
      <svg className={cx("home-world-clouds")} viewBox="0 0 1320 540" preserveAspectRatio="none" aria-hidden="true">
        <path d="M10 358 Q55 330 90 343 Q98 303 145 320 Q173 273 218 306 Q263 290 278 327 Q318 310 349 344 Q392 341 414 363 M18 378 Q145 396 307 373 M918 392 Q947 365 978 375 Q991 333 1027 350 Q1062 315 1097 350 Q1138 325 1162 361 Q1221 343 1289 397 M993 414 Q1146 437 1304 408" />
        <path d="M144 415 C310 421 360 475 531 478 M834 475 C984 471 1098 460 1183 468" />
      </svg>
      <div className={cx("home-edit-picture")} data-ready={ready}>
        {!ready && <img src="/showcase/atelier.png" alt="" />}
        <iframe ref={frame} src="/showcase/atelier.html?edit-demo=atelier" title={t.home.editFrameTitle} sandbox="allow-scripts" inert tabIndex={-1} data-preview="editable" aria-hidden={!ready} />
      </div>
      <div className={cx("home-edit-caption")} aria-live="off"><span>{t.home.editTry}</span><p key={manual ? "manual" : phase}>{manual ? t.home.editManual : phase===1 ? t.home.editSail : phase===5 ? t.home.editPot : t.home.editSteps[centerPhase]}</p></div>
      <div className={cx("home-showcase-side")}>
        {[{ kind:8, chapter:"nature" }, { kind:7, chapter:"nature" }].map(({kind,chapter}, index) => <div key={kind} className={cx("home-world-companion")} data-companion={index}>
          <div><HomeArtwork kind={kind} playing={playing && visible} mode="tile" editPhase={phase} resetKey={resetKey} onExplore={pauseDemo} /></div>
          <button aria-label={t.home.heroBrowse[index]} onClick={() => browse(chapter)}>{index===0 ? t.home.trySail : t.home.tryPot}<ArrowDownRight size={15} /></button>
        </div>)}
      </div>

    </div>
    <div className={cx("home-edit-bar")}>
      <span className={cx("home-edit-invitation")}>{t.home.editInvitation}</span>
      <div className={cx("home-edit-controls")}>
        <fieldset><legend>{t.home.editColorLabel}</legend><button disabled={!ready} aria-label={t.home.editOriginalColor} aria-pressed={!draft.recolored} data-color="original" onClick={() => change({recolored:false,selected:"roof"})} /><button disabled={!ready} aria-label={t.home.editAlternateColor} aria-pressed={draft.recolored} data-color="alternate" onClick={() => change({recolored:true,selected:"roof"})} /></fieldset>
        <label className={cx("home-edit-position")}><span>{t.home.editPositionLabel}</span><input type="range" aria-label={t.home.editPositionLabel} min="0" max="72" value={draft.offset} disabled={!ready} onChange={event => change({offset:Number(event.target.value),selected:"balloon"})} /></label>
        <label className={cx("home-edit-title")}><span>{t.home.editTitleLabel}</span><input aria-label={t.home.editTitleLabel} maxLength={12} value={draft.title} disabled={!ready} onFocus={() => change({ selected: "sign" })} onChange={event => change({ title: event.target.value, selected: "sign" })} /></label>
        <button className={cx("home-edit-reset")} disabled={!ready} onClick={() => setManual({...original})}>{t.home.editReset}</button>
        <button className={cx("home-edit-replay")} aria-label={t.home.editReplay} onClick={() => { setResetKey(value => value + 1); setManual(null); setElapsed(0); onReplay(); }}><RotateCcw size={15} /></button>
      </div>
      <small>{t.home.editDisclosure}</small>
    </div>
  </section>;
}

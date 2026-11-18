import { useEffect, useRef, useState } from "react";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";
import { showcase } from "./showcase.ts";
const ignore = () => {};

/** Real DrawY exports, isolated from the account and controlled through a small playback bridge. */
export function HomeArtwork({
  kind,
  playing,
  onExplore = ignore,
  onReady = ignore,
  mode = "main",
  editPhase,
  resetKey = 0,
}: {
  kind: number;
  editPhase?: number;
  resetKey?: number;
  playing: boolean;
  onExplore?: () => void;
  onReady?: (ready: boolean) => void;
  mode?: "main" | "tile";
}) {
  const t = useT();
  const frame = useRef<HTMLIFrameElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(mode === "main");
  const [inView, setInView] = useState(mode === "main");
  useEffect(() => {
    const near = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setLoaded(true);
          near.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    const visible = new IntersectionObserver(([entry]) =>
      setInView(entry.isIntersecting),
    );
    if (container.current) {
      near.observe(container.current);
      visible.observe(container.current);
    }
    return () => {
      near.disconnect();
      visible.disconnect();
    };
  }, []);
  const active = playing && inView;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [narrow, setNarrow] = useState(
    () => matchMedia("(max-width: 760px)").matches,
  );
  const source =
    showcase[kind] === "water" && (narrow || mode === "tile") ? "water-detail" : showcase[kind];
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const change = () => setNarrow(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const playingRef = useRef(active);
  playingRef.current = active;
  useEffect(() => {
    setReady(false);
    setFailed(false);
    onReady(false);
    if (!loaded) return;
    const timer = window.setTimeout(() => setFailed(true), 20000);
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "drawy:showcase-ready") {
        clearTimeout(timer);
        setReady(true);
        setFailed(false);
        onReady(true);
        frame.current?.contentWindow?.postMessage(
          { type: "drawy:showcase-play", playing: playingRef.current },
          "*",
        );
      } else if (event.data?.type === "drawy:showcase-explore") onExplore();
    };
    window.addEventListener("message", receive);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
    };
  }, [onExplore, onReady, source, loaded]);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      { type: "drawy:showcase-play", playing: active },
      "*",
    );
  }, [active, ready]);
  useEffect(() => {
    if (editPhase === undefined || !ready) return;
    const boat = source === "sailboat";
    frame.current?.contentWindow?.postMessage({type:"drawy:edit-demo",resetKey,title:"",recolored:boat && editPhase>=1,offset:!boat && editPhase===5?72:0,selected:boat && editPhase===1?"sails":!boat && editPhase===5?"pot":""},"*");
  }, [editPhase,ready,source,resetKey]);
  return (
    <div
      ref={container}
      className={cx("home-artwork")}
      data-mode={mode}
      data-interactive={editPhase !== undefined}
      data-ready={ready}
      data-playing={active}
    >
      <img
        className={cx("home-art-poster")}
        src={`/showcase/${source}.png`}
        alt=""
      />
      {loaded && (
        <iframe
          key={source}
          ref={frame}
          src={`/showcase/${source}.html${editPhase !== undefined ? "?edit-demo="+source : ""}`}
          title={t.home.samples[kind].title}
          sandbox="allow-scripts"
          inert={mode === "tile" && editPhase === undefined}
          data-preview={mode}
          className={cx("home-art-frame")}
          aria-hidden={(mode === "tile" && editPhase === undefined) || !ready}
          tabIndex={(mode === "main" || editPhase !== undefined) && ready ? 0 : -1}
        />
      )}
      {!ready && mode === "main" && (
        <span className={cx("home-art-loading")} role="status">
          {failed ? t.home.previewFallback : t.home.previewLoading}
        </span>
      )}
    </div>
  );
}

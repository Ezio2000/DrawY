import { useEffect, useRef, useState } from "react";
import { Canvas } from "../../../../modules/canvas/index.ts";
import { detailElement } from "../../../../modules/runtime/detail.ts";
import type { Target, Work } from "../../../../modules/contracts/index.ts";
import { reducedMotion } from "../ui/primitives.tsx";
import { cx } from "./cx.ts";

/** A work drawn live on the home page, by the same canvas and runtime as the work page:
 * its drawings run, its scripts answer, and what leads somewhere opens. It is drawn once it
 * first comes near the screen. The page's own scrolling goes past it: the wheel scrolls the
 * page, and only a pinch (or the wheel with Ctrl) zooms the drawing. */
export function LiveWork({
  work,
  scene,
  open,
  movable = false,
  label,
  insets,
}: {
  work?: Work;
  /** The scene shown; the root's when not given. */
  scene?: string;
  /** A module leading to another scene was pressed. */
  open?: (sceneId: string) => void;
  /** Whether its modules can be dragged about (nothing is saved). */
  movable?: boolean;
  label?: string;
  /** Room kept clear at the top and bottom of the sheet, for what lies over it. */
  insets?: { top: number; bottom: number };
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<Canvas | undefined>(undefined);
  const opener = useRef(open);
  opener.current = open;
  const room = useRef(insets);
  room.current = insets;
  const [near, setNear] = useState(false);
  const [shown, setShown] = useState(false);
  /** The work the canvas has drawn. While another has been laid on it and is not yet drawn,
   * the last one is hidden rather than left showing under the new one's title. */
  const [drawnId, setDrawnId] = useState<string>();
  const asked = useRef<string>(undefined);
  asked.current = work?.id;
  const [detail, setDetail] = useState<string>();
  const sceneId = work && (scene && work.scenes[scene] ? scene : work.rootSceneId);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const seen = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), {
      rootMargin: "400px 0px",
    });
    seen.observe(el);
    // The page scrolls on past the drawing; a pinch still zooms it.
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
    };
    el.addEventListener("wheel", wheel, { capture: true });
    return () => {
      seen.disconnect();
      el.removeEventListener("wheel", wheel, { capture: true });
    };
  }, []);

  // Made once, for the first work it is given; later works and scenes are laid on it.
  useEffect(() => {
    if (!near || !work || !sceneId || view.current) return;
    const canvas = new Canvas(host.current!, work, work.scenes[sceneId], {
      movable,
      resizable: false,
      motion: !reducedMotion(),
      marks: true,
      insets: () => room.current ?? { top: 0, bottom: 0 },
      open: (t: Target) => {
        if (t.kind === "scene") opener.current?.(t.id);
        else setDetail(t.id);
      },
      shown: () => setDrawnId(asked.current),
      select: () => {},
      commit: () => {},
      error: (message) => console.warn("showcase:", message),
    });
    // A finger dragging up or down the page scrolls it, as it would anywhere else.
    canvas.element.style.touchAction = "pan-y";
    view.current = canvas;
    let live = true;
    void canvas.ready.finally(() => {
      if (!live) return;
      setShown(true);
      setDrawnId(asked.current);
    });
    const resized = new ResizeObserver(() => canvas.refit());
    resized.observe(host.current!);
    return () => {
      live = false;
      resized.disconnect();
      canvas.dispose();
      view.current = undefined;
    };
  }, [near, !!work]);

  const drawn = useRef<string>(undefined);
  useEffect(() => {
    const canvas = view.current;
    if (!canvas || !work || !sceneId) return;
    const key = work.id + work.revision + sceneId;
    if (drawn.current === undefined) {
      drawn.current = key;
      return;
    }
    if (drawn.current === key) return;
    drawn.current = key;
    setDetail(undefined);
    canvas.update(work, work.scenes[sceneId]);
  }, [work, sceneId, near]);

  useEffect(() => view.current?.setMovable(movable), [movable, near]);
  useEffect(() => view.current?.refit(), [insets?.top, insets?.bottom]);

  return (
    <div className={cx("l-live")} data-shown={(shown && drawnId === work?.id) || undefined} aria-label={label} role="group">
      <div className={cx("canvas", "l-live-canvas")} ref={host} />
      {detail && work?.details[detail] && <Detail work={work} id={detail} close={() => setDetail(undefined)} />}
    </div>
  );
}

/** A detail page the drawing leads to, over the drawing, as the work page shows it. */
function Detail({ work, id, close }: { work: Work; id: string; close: () => void }) {
  const page = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const article = detailElement(work.details[id], close);
    page.current!.replaceChildren(article);
  }, [work, id]);
  return <div className={cx("l-live-detail")} ref={page} />;
}

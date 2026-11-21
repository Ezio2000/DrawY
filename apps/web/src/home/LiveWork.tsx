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
  const [drawn, setDrawn] = useState<{ work: Work; sceneId: string }>();
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

  // Each translated work and scene starts with its own fitted camera.
  useEffect(() => {
    if (!near || !work || !sceneId) return;
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
      shown: () => setDrawn({ work, sceneId }),
      select: () => {},
      commit: () => {},
      error: (message) => console.warn("showcase:", message),
    });
    // A finger dragging up or down the page scrolls it, as it would anywhere else.
    canvas.element.style.touchAction = "pan-y";
    view.current = canvas;
    setDetail(undefined);
    const resized = new ResizeObserver(() => canvas.refit());
    resized.observe(host.current!);
    return () => {
      resized.disconnect();
      canvas.dispose();
      view.current = undefined;
    };
  }, [near, work, sceneId]);

  useEffect(() => view.current?.setMovable(movable), [movable, near]);
  useEffect(() => view.current?.refit(), [insets?.top, insets?.bottom]);

  return (
    <div className={cx("l-live")} data-shown={(drawn && drawn.work === work && drawn.sceneId === sceneId) || undefined} aria-label={label} role="group">
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

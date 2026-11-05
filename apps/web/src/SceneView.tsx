import { detailElement } from "../../../modules/runtime/detail.ts";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ZoomOut, ZoomIn, Scan } from "lucide-react";
import { reducedMotion, Spinner, useLocale } from "@drawy/ui";
import {
  Canvas,
  type CanvasOptions,
  type Pointed,
} from "../../../modules/canvas/index.ts";
import type { Camera } from "../../../modules/contracts/geometry.ts";
import type {
  Work,
  Run,
  Step,
  Sketch,
  Target,
  Selection,
  Bounds,
  Detail,
} from "../../../modules/contracts/index.ts";
import { cx } from "./cx.ts";
import { styleList } from "./Composer.tsx";
import { useT } from "./i18n.tsx";
import type { StyleMaterial } from "@drawy/materials/schema";
type ToolStep = Extract<Step, { kind: "tool" }>;
/** What the canvas shows of a work: its revision and which pictures have developed. */
const drawnAs = (work: Work) =>
  work.revision +
  Object.values(work.materials)
    .map((m) => (m.kind === "picture" ? m.status : ""))
    .join();
const place = (b: Bounds): CSSProperties => ({
  left: b.x,
  top: b.y,
  width: b.width,
  height: b.height,
});
export function SceneView({
  work,
  sceneId,
  run,
  open,
  select,
  commit,
  point,
  connect,
  selectLink,
  reconnect,
  menu,
  place: placeAt,
  disabled,
  editing,
  quiet,
  version = "",
  view,
}: {
  work: Work;
  /** What tells this showing of the work from another of the same revision: a hand edit
   * shown before it is saved. */
  version?: string;
  sceneId: string;
  /** The run drawing or asking right now, whose layout and gaze show on the canvas. */
  run?: Run;
  disabled: boolean;
  /** Whether the person is editing the work by hand. */
  editing: boolean;
  /** Whether a revision is the person's own change, shown at once rather than drawn. */
  quiet: (revision: number) => boolean;
  open: (target: Target) => void;
  select: (value: Selection[]) => void;
  commit: (moves: { id: string; bounds: Bounds }[]) => void;
  point: (pointed: Pointed) => void;
  /** A link drawn while editing, from one module's side to another's. */
  connect?: CanvasOptions["connect"];
  /** A link selected while editing, or none. */
  selectLink?: CanvasOptions["selectLink"];
  /** An end of a link dragged onto a side of a module. */
  reconnect?: CanvasOptions["reconnect"];
  /** A right click while editing, for the menu. */
  menu?: CanvasOptions["menu"];
  /** A press with the placing tool, at a point in the scene. */
  place?: CanvasOptions["place"];
  /** Receives the canvas the scene is drawn on, for the editor to work with. */
  view: (canvas: Canvas | undefined) => void;
}) {
  const t = useT(),
    locale = useLocale();
  const host = useRef<HTMLDivElement>(null),
    cameras = useRef(new Map<string, Camera>()),
    drawn = useRef(drawnAs(work) + version),
    [canvas, setCanvas] = useState<Canvas>(),
    // Until the scene is drawn the page keeps showing that it is loading, so opening a
    // work goes from the spinner straight to the picture, without a blank page between.
    [shown, setShown] = useState(false),
    [error, setError] = useState("");
  const callbacks = useRef({ open, select, commit, point, connect, selectLink, reconnect, menu, place: placeAt, view, quiet });
  const picked = useRef<{ key: string; ids: string[] } | null>(null);
  callbacks.current = { open, select, commit, point, connect, selectLink, reconnect, menu, place: placeAt, view, quiet };
  useEffect(() => {
    setError("");
    setShown(false);
    const key = work.id + ":" + sceneId;
    drawn.current = drawnAs(work) + version;
    const view = new Canvas(host.current!, work, work.scenes[sceneId], {
      camera: cameras.current.get(key),
      movable: !disabled,
      motion: !reducedMotion(),
      // The view keeps clear of the title above and of the composer laid over its foot.
      insets: () => {
        const stage = host.current!.getBoundingClientRect(),
          dock = host
            .current!.parentElement?.querySelector("[data-dock]")
            ?.getBoundingClientRect();
        return {
          top: 56,
          bottom: Math.max(96, dock ? stage.bottom - dock.top + 12 : 0),
        };
      },
      open: (t) => callbacks.current.open(t),
      select: (s) => {
        picked.current = { key, ids: s.map((x) => x.moduleId) };
        callbacks.current.select(s);
      },
      commit: (m) => callbacks.current.commit(m),
      point: (p) => callbacks.current.point(p),
      connect: (from, to) => callbacks.current.connect?.(from, to),
      selectLink: (id) => callbacks.current.selectLink?.(id),
      reconnect: (id, end, to) => callbacks.current.reconnect?.(id, end, to),
      menu: (at) => callbacks.current.menu?.(at),
      place: (at) => callbacks.current.place?.(at),
      cameraChanged: (c) => cameras.current.set(key, c),
      error: setError,
    });
    setCanvas(view);
    callbacks.current.view(view);
    let mounted = true;
    void view.ready
      .then(() => {
        if (!mounted) return;
        view.select(picked.current?.key === key ? picked.current.ids : []);
      })
      .catch((e) => setError(String(e)))
      .finally(() => mounted && setShown(true));
    return () => {
      mounted = false;
      callbacks.current.view(undefined);
      view.dispose();
    };
  }, [work.id, sceneId]);
  useEffect(() => {
    const now = drawnAs(work) + version;
    if (!canvas || drawn.current === now || !work.scenes[sceneId]) return;
    drawn.current = now;
    setError("");
    canvas.update(
      work,
      work.scenes[sceneId],
      callbacks.current.quiet(work.revision),
    );
  }, [canvas, work, version]);
  useEffect(() => canvas?.setMovable(!disabled), [canvas, disabled]);
  useEffect(
    () => canvas?.setEditing(editing && !disabled),
    [canvas, editing, disabled],
  );
  const steps = run?.steps || [];
  const write = steps.findLast(
    (s): s is Extract<ToolStep, { name: "write_work" }> =>
      s.kind === "tool" && s.name === "write_work",
  );
  // The latest layout written for this scene stays pencilled in, even when its write
  // failed, until the author's next attempt streams a new one; the run ending clears it.
  const draft: Sketch[] =
    steps
      .findLast(
        (s): s is Extract<ToolStep, { name: "write_work" }> =>
          s.kind === "tool" &&
          s.name === "write_work" &&
          s.scenes.some((x) => x.id === sceneId),
      )
      ?.scenes.find((s) => s.id === sceneId)?.modules || [];
  const done = write?.drawings || [],
    writing = write?.status === "running" ? write.writing : undefined;
  // Each update of the run gives the sketch its next pass while a drawing is being written.
  useEffect(() => canvas?.sketch(draft, { done, writing }), [canvas, run]);
  const gaze = steps.findLast(
    (s): s is Extract<ToolStep, { name: "view_canvas" }> =>
      s.kind === "tool" &&
      s.name === "view_canvas" &&
      s.status === "running" &&
      (!s.sceneId || s.sceneId === sceneId),
  );
  const empty = !work.scenes[sceneId].modules.length;
  const [styles, setStyles] = useState<StyleMaterial[]>([]);
  useEffect(() => void styleList().then(setStyles, () => {}), []);
  // What is being drawn, noted on the paper before the first stroke: the subject, who it is
  // for and its style. The author's own reasoning (intent, concept) stays in the studio's
  // folded process, not on the page.
  const briefing = steps.findLast(
    (s): s is Extract<ToolStep, { name: "set_brief" }> =>
      s.kind === "tool" && s.name === "set_brief",
  );
  const brief = work.brief ?? undefined;
  const note = brief
    ? {
        subject: brief.subject,
        tags: [
          brief.audience,
          styles.find((s) => s.id === brief.style)?.name[locale],
        ].filter((x): x is string => !!x),
      }
    : briefing?.subject
      ? { subject: briefing.subject, tags: [] as string[] }
      : undefined;
  // Before the first stroke, the references the author gathers are laid out on the paper.
  const references = steps
    .flatMap((s, i) =>
      s.kind !== "tool"
        ? []
        : s.name === "generate_images"
          ? s.images.map((p, j) => ({
              key: `${i}:${j}`,
              picture: p.url && p.status !== "developing" ? p : undefined,
              made: true,
            }))
          : s.name === "find_materials" || s.name === "set_brief"
            ? (s.found || []).flatMap((f, j) =>
                f.candidates
                  .filter((c) => c.url)
                  .slice(0, 1)
                  .map((c) => ({
                    key: `${i}:${j}`,
                    picture: { name: c.name, url: c.url! },
                    made: false,
                  })),
              )
            : [],
    )
    .slice(-7);
  return (
    <>
      <div
        ref={host}
        className={cx("canvas")}
        data-drafting={!!run || undefined}
        data-editing={(editing && !disabled) || undefined}
      />
      {canvas &&
        createPortal(
          <>
            {gaze?.regions?.map((region, i) => (
              <div key={i} className={cx("viewfinder")} style={place(region)} />
            ))}
            {gaze?.focus === "annotate" &&
              work.scenes[sceneId].modules.map((m, i) => (
                <div
                  key={m.id}
                  className={cx("annotation")}
                  style={{ ...place(m.bounds), "--i": i % 16 } as CSSProperties}
                />
              ))}
          </>,
          canvas.layer,
        )}
      {gaze && !gaze.regions?.length && <div className={cx("viewfinder")} data-screen />}
      {!shown && (
        <div className={cx("canvas-loading")} aria-busy>
          <Spinner />
        </div>
      )}
      {empty && !run && shown && (
        <p className={cx("blank")}>{t.work.blank}</p>
      )}
      {empty && run && (!!references.length || note) && (
        <div
          className={cx("references")}
          data-leaving={!!draft.length || undefined}
        >
          {note && (
            <figure className={cx("brief-note")}>
              <b>{note.subject}</b>
              {!!note.tags.length && (
                <span>
                  {note.tags.map((t) => (
                    <i key={t}>{t}</i>
                  ))}
                </span>
              )}
            </figure>
          )}
          {!!references.length && (
            <div className={cx("pinned")}>
              {references.map(({ key, picture, made }, i) => (
                <figure
                  key={key}
                  data-made={made || undefined}
                  style={
                    {
                      "--x": (i - (references.length - 1) / 2) * 150 + "px",
                      "--y": (i % 2 ? 22 : -16) + "px",
                      "--r": [-4, 3, -2, 5, -3, 2, -5][i] + "deg",
                      "--i": i,
                    } as CSSProperties
                  }
                >
                  {picture ? (
                    <img src={picture.url} alt={picture.name} />
                  ) : (
                    <i />
                  )}
                </figure>
              ))}
            </div>
          )}
        </div>
      )}
      <div className={cx("camera")}>
        <button
          aria-label={t.work.zoomOut}
          data-tip={t.work.zoomOut}
          onClick={() => canvas?.zoom(1 / 1.25)}
        >
          <ZoomOut size={15} />
        </button>
        <button
          aria-label={t.work.zoomIn}
          data-tip={t.work.zoomIn}
          onClick={() => canvas?.zoom(1.25)}
        >
          <ZoomIn size={15} />
        </button>
        <button
          aria-label={t.work.fit}
          data-tip={t.work.fit}
          onClick={() => {
            cameras.current.delete(work.id + ":" + sceneId);
            canvas?.fit();
          }}
        >
          <Scan size={15} />
        </button>
      </div>
      {error && !run && (
        <div role="alert" className={cx("render-error")}>
          {error}
        </div>
      )}
    </>
  );
}
export function DetailView({
  detail,
  close,
}: {
  detail: Detail;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onClose = useRef(close);
  onClose.current = close;
  useEffect(() => {
    const article = detailElement(detail, () => onClose.current());
    ref.current!.append(article);
    return () => article.remove();
  }, [detail]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose.current();
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
  return <div className={cx("detail")} ref={ref} />;
}

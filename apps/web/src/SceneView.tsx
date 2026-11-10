import { detailElement } from "../../../modules/runtime/detail.ts";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Lightbulb } from "lucide-react";
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
import { GRID, Rulers, ViewControls, type BoardSettings } from "./EditView.tsx";
import { useT } from "./i18n.tsx";
import { currentOf, thinkingOf } from "./Studio.tsx";
import { live } from "./session/work.ts";
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
  extend,
  duplicate,
  selectLink,
  reconnect,
  menu,
  place: placeAt,
  board,
  setBoard,
  help,
  disabled,
  editing,
  quiet,
  version = "",
  view,
  controls = true,
  resizable = true,
  fill,
  hold,
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
  /** A link drawn while editing, from one module to another. */
  connect?: CanvasOptions["connect"];
  /** A new module wanted beyond a side of one, or where a link from it was let go. */
  extend?: CanvasOptions["extend"];
  /** Copies of modules dragged off them. */
  duplicate?: CanvasOptions["duplicate"];
  /** How the drawing board is set up while editing, and the ways to change it and to
   * see the shortcuts. */
  board?: BoardSettings;
  setBoard?: (change: Partial<BoardSettings>) => void;
  help?: () => void;
  /** A link selected while editing, or none. */
  selectLink?: CanvasOptions["selectLink"];
  /** An end of a link dragged onto a side of a module. */
  reconnect?: CanvasOptions["reconnect"];
  /** A right click while editing, for the menu. */
  menu?: CanvasOptions["menu"];
  /** A press with a drawing tool at a point in the scene, or the box dragged out with it. */
  place?: CanvasOptions["place"];
  /** Receives the canvas the scene is drawn on, for the editor to work with. */
  view: (canvas: Canvas | undefined) => void;
  /** Whether the zoom buttons show: where fingers pinch, they need not. */
  controls?: boolean;
  /** Whether the selection can be resized by its handles. */
  resizable?: boolean;
  /** A finger held still on the canvas, once the selection has followed it. */
  hold?: CanvasOptions["hold"];
  /** How far the automatic view may zoom past the whole drawing to fill the screen. */
  fill?: number;
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
  const callbacks = useRef({ open, select, commit, point, connect, extend, duplicate, selectLink, reconnect, menu, place: placeAt, view, quiet, hold });
  const picked = useRef<{ key: string; ids: string[] } | null>(null);
  callbacks.current = { open, select, commit, point, connect, extend, duplicate, selectLink, reconnect, menu, place: placeAt, view, quiet, hold };
  // While editing, the automatic view also keeps clear of the tools and rulers at its edges.
  const boarded = useRef(false);
  boarded.current = editing && !disabled;
  useEffect(() => {
    setError("");
    setShown(false);
    const key = work.id + ":" + sceneId;
    drawn.current = drawnAs(work) + version;
    const view = new Canvas(host.current!, work, work.scenes[sceneId], {
      camera: cameras.current.get(key),
      movable: !disabled,
      resizable,
      fill,
      motion: !reducedMotion(),
      // The view keeps clear of the title above and of the composer laid over its foot.
      insets: () => {
        if (!host.current) return { top: 56, bottom: 96 };
        const stage = host.current.getBoundingClientRect(),
          dock = host
            .current!.parentElement?.querySelector("[data-dock]")
            ?.getBoundingClientRect();
        return {
          top: boarded.current ? 76 : 56,
          bottom: Math.max(96, dock ? stage.bottom - dock.top + 12 : 0),
          left: boarded.current ? 84 : 0,
          right: boarded.current ? 44 : 0,
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
      extend: (from, at) => callbacks.current.extend?.(from, at),
      duplicate: (ids, by) => callbacks.current.duplicate?.(ids, by),
      selectLink: (id) => callbacks.current.selectLink?.(id),
      reconnect: (id, end, to) => callbacks.current.reconnect?.(id, end, to),
      menu: (at) => callbacks.current.menu?.(at),
      ...(hold ? { hold: (at: { x: number; y: number }) => callbacks.current.hold?.(at) } : {}),
      place: (at, box) => callbacks.current.place?.(at, box),
      cameraChanged: (c) => cameras.current.set(key, c),
      error: setError,
    });
    setCanvas(view);
    callbacks.current.view(view);
    // The view keeps clear of the controls over its foot as they change size: a reply
    // shown or put away, the composer growing with what is typed.
    const dock = host.current!.parentElement?.querySelector("[data-dock]");
    let dockHeight = 0;
    const docked = new ResizeObserver(([entry]) => {
      const h = Math.round(entry.contentRect.height);
      if (dockHeight && Math.abs(h - dockHeight) > 8) view.refit();
      dockHeight = h;
    });
    if (dock) docked.observe(dock);
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
      docked.disconnect();
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
  useEffect(() => {
    canvas?.setEditing(editing && !disabled);
    canvas?.refit();
  }, [canvas, editing, disabled]);
  useEffect(
    () => canvas?.setSnap({ guides: board?.guides ?? true, grid: board?.grid ? GRID : 0 }),
    [canvas, board?.guides, board?.grid],
  );
  const fitAll = () => {
    cameras.current.delete(work.id + ":" + sceneId);
    canvas?.fit(true, 520, "whole");
  };
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
  // A note on the paper while the canvas is still blank, so there is something to watch
  // before the first stroke: at first the request as it was written and what the author is
  // thinking about now, as it thinks; once it settles what to draw, the subject, the ways
  // of drawing it weighed and the idea it chose, with who it is for and the style.
  const briefing = steps.findLast(
    (s): s is Extract<ToolStep, { name: "set_brief" }> =>
      s.kind === "tool" && s.name === "set_brief",
  );
  const request = steps.find(
    (s): s is Extract<Step, { kind: "message" }> => s.kind === "message" && s.role === "user",
  )?.text;
  // What the author is about now: its latest thought, or what it is doing or last noted.
  const thinking = thinkingOf(run),
    now = live(run) ? currentOf(run!, t, locale) : undefined;
  const brief = work.brief ?? undefined;
  const note =
    brief || briefing?.subject
      ? {
          subject: briefing?.subject || brief!.subject,
          ideas: briefing?.ideas ?? [],
          concept: briefing?.concept || brief?.concept || "",
          tags: brief
            ? [
                brief.audience,
                styles.find((s) => s.id === brief.style)?.name[locale],
              ].filter((x): x is string => !!x)
            : [],
        }
      : request
        ? { request, ideas: [] as string[], concept: "", tags: [] as string[] }
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
  // The cards spread up to 150px apart, closer when that would run past the canvas.
  const card = references.some((r) => r.made) ? 212 : 128,
    spread =
      references.length > 1
        ? Math.max(
            0,
            Math.min(150, ((host.current?.clientWidth || 800) - 64 - card) / (references.length - 1)),
          )
        : 0;
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
            <figure className={cx("brief-note")} data-asking={!("subject" in note) || undefined}>
              {"subject" in note ? <b>{note.subject}</b> : <q>{note.request}</q>}
              {!!note.ideas.length && (
                <p data-weighed>
                  {t.now.weighed}
                  {note.ideas.join(" · ")}
                </p>
              )}
              {note.concept && (
                <p data-concept>
                  <Lightbulb size={12} />
                  {note.concept}
                </p>
              )}
              {live(run) && !draft.length && (
                <p data-thought key={now?.line}>
                  {now?.line === thinking && <small>{t.now.thinkingNow}</small>}
                  <span lang={now?.lang}>{now?.line}</span>
                </p>
              )}
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
                      "--x": (i - (references.length - 1) / 2) * spread + "px",
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
      {canvas && editing && !disabled && board?.rulers && <Rulers canvas={canvas} />}
      {controls && (
        <ViewControls
          canvas={canvas}
          fit={fitAll}
          board={editing && !disabled ? board : undefined}
          setBoard={setBoard}
          help={help}
        />
      )}
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

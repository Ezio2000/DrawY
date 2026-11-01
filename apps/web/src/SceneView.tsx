import { detailElement } from "../../../modules/runtime/detail.ts";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ZoomOut, ZoomIn, Scan, Lightbulb } from "lucide-react";
import { reducedMotion, useLocale } from "@drawy/ui";
import { Pen } from "@drawy/ui/brand";
import { Canvas, type Pointed } from "../../../modules/canvas/index.ts";
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
  disabled,
  editing,
  quiet,
  view,
}: {
  work: Work;
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
  /** Receives the canvas the scene is drawn on, for the editor to work with. */
  view: (canvas: Canvas | undefined) => void;
}) {
  const t = useT(),
    locale = useLocale();
  const host = useRef<HTMLDivElement>(null),
    cameras = useRef(new Map<string, Camera>()),
    drawn = useRef(work),
    [canvas, setCanvas] = useState<Canvas>(),
    [error, setError] = useState("");
  const callbacks = useRef({ open, select, commit, point, view, quiet });
  const picked = useRef<{ key: string; ids: string[] } | null>(null);
  callbacks.current = { open, select, commit, point, view, quiet };
  useEffect(() => {
    setError("");
    const key = work.id + ":" + sceneId;
    drawn.current = work;
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
      cameraChanged: (c) => cameras.current.set(key, c),
      error: setError,
    });
    view.pen.className = cx("pen");
    setCanvas(view);
    callbacks.current.view(view);
    let mounted = true;
    void view.ready
      .then(() => {
        if (!mounted) return;
        view.select(picked.current?.key === key ? picked.current.ids : []);
      })
      .catch((e) => setError(String(e)));
    return () => {
      mounted = false;
      callbacks.current.view(undefined);
      view.dispose();
    };
  }, [work.id, sceneId]);
  useEffect(() => {
    if (!canvas || drawnAs(drawn.current) === drawnAs(work)) return;
    drawn.current = work;
    setError("");
    canvas.update(
      work,
      work.scenes[sceneId],
      callbacks.current.quiet(work.revision),
    );
  }, [canvas, work]);
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
  // Each update of the run gives the pen its next pass while a drawing is being written.
  useEffect(() => canvas?.sketch(draft, { done, writing }), [canvas, run]);
  useEffect(() => canvas?.attend(!!run), [canvas, !!run]);
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
  // What the author has understood, noted on the paper before it starts drawing: the
  // subject as it is written, then the settled brief with the idea the picture is built on.
  const briefing = steps.findLast(
    (s): s is Extract<ToolStep, { name: "set_brief" }> =>
      s.kind === "tool" && s.name === "set_brief",
  );
  const brief = work.brief ?? undefined;
  const note = brief
    ? {
        subject: brief.subject,
        intent: brief.intent,
        concept: brief.concept,
        tags: [
          brief.audience,
          styles.find((s) => s.id === brief.style)?.name[locale],
          t.registers[brief.register],
        ].filter(Boolean),
      }
    : briefing?.subject
      ? { subject: briefing.subject, intent: "", concept: "", tags: [] }
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
            {gaze?.region && (
              <div className={cx("viewfinder")} style={place(gaze.region)} />
            )}
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
      {canvas && createPortal(<Pen size={30} />, canvas.pen)}
      {gaze && !gaze.region && <div className={cx("viewfinder")} data-screen />}
      {empty && !run && (
        <p className={cx("blank")}>{editing ? t.edit.blank : t.work.blank}</p>
      )}
      {empty && run && (!!references.length || note) && (
        <div
          className={cx("references")}
          data-leaving={!!draft.length || undefined}
        >
          {note && (
            <figure className={cx("brief-note")}>
              <b>{note.subject}</b>
              {note.intent && <p>{note.intent}</p>}
              {note.concept && (
                <p data-concept>
                  <Lightbulb size={12} />
                  {note.concept}
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

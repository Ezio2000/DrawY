import { detailElement } from "../../../modules/runtime/detail.ts";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, Scan, MousePointer2, Hand } from "lucide-react";
import { reducedMotion } from "@drawy/ui";
import { Pen } from "@drawy/ui/brand";
import { Canvas } from "../../../modules/canvas/index.ts";
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
import { styleList, registers } from "./Composer.tsx";
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
  disabled,
}: {
  work: Work;
  sceneId: string;
  /** The run drawing or asking right now, whose layout and gaze show on the canvas. */
  run?: Run;
  disabled: boolean;
  open: (target: Target) => void;
  select: (value: Selection | null) => void;
  commit: (moves: { id: string; bounds: Bounds }[]) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    cameras = useRef(new Map<string, Camera>()),
    drawn = useRef(work),
    [canvas, setCanvas] = useState<Canvas>(),
    [editing, setEditing] = useState(false),
    [error, setError] = useState("");
  const callbacks = useRef({ open, select, commit });
  const picked = useRef<{ key: string; moduleId: string } | null>(null);
  callbacks.current = { open, select, commit };
  useEffect(() => {
    setError("");
    const key = work.id + ":" + sceneId;
    drawn.current = work;
    const view = new Canvas(host.current!, work, work.scenes[sceneId], {
      camera: cameras.current.get(key),
      editing: editing && !disabled,
      motion: !reducedMotion(),
      insets: { top: 56, bottom: 96 },
      open: (t) => callbacks.current.open(t),
      select: (s) => {
        picked.current = s ? { key, moduleId: s.moduleId } : null;
        callbacks.current.select(s);
      },
      commit: (m) => callbacks.current.commit(m),
      cameraChanged: (c) => cameras.current.set(key, c),
      error: setError,
    });
    view.pen.className = cx("pen");
    setCanvas(view);
    let mounted = true;
    void view.ready
      .then(() => {
        if (!mounted) return;
        const id = picked.current?.key === key ? picked.current.moduleId : null;
        view.select(id && view.renderer.instances.has(id) ? id : null);
      })
      .catch((e) => setError(String(e)));
    return () => {
      mounted = false;
      view.dispose();
    };
  }, [work.id, sceneId]);
  useEffect(() => {
    if (!canvas || drawnAs(drawn.current) === drawnAs(work)) return;
    drawn.current = work;
    setError("");
    canvas.update(work, work.scenes[sceneId]);
  }, [canvas, work]);
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
  // subject as it is written, then the settled brief.
  const briefing = steps.findLast(
    (s): s is Extract<ToolStep, { name: "set_brief" }> =>
      s.kind === "tool" && s.name === "set_brief",
  );
  const brief = work.brief ?? undefined;
  const note = brief
    ? {
        subject: brief.subject,
        intent: brief.intent,
        tags: [
          brief.audience,
          styles.find((s) => s.id === brief.style)?.name.zh,
          registers[brief.register],
        ].filter(Boolean),
      }
    : briefing?.subject
      ? { subject: briefing.subject, intent: "", tags: [] }
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
        data-editing={editing || undefined}
        data-drafting={!!run || undefined}
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
      {empty && !run && <p className={cx("blank")}>这里还空着</p>}
      {empty && run && (!!references.length || note) && (
        <div
          className={cx("references")}
          data-leaving={!!draft.length || undefined}
        >
          {note && (
            <figure className={cx("brief-note")}>
              <b>{note.subject}</b>
              {note.intent && <p>{note.intent}</p>}
              {!!note.tags.length && (
                <span>
                  {note.tags.map((t) => (
                    <i key={t}>{t}</i>
                  ))}
                </span>
              )}
            </figure>
          )}
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
              {picture ? <img src={picture.url} alt={picture.name} /> : <i />}
            </figure>
          ))}
        </div>
      )}
      <div className={cx("camera")}>
        <button
          disabled={disabled}
          aria-label={editing ? "移动模块中，点击回到浏览" : "移动模块"}
          data-tip={editing ? "回到浏览" : "移动模块"}
          data-on={editing || undefined}
          onClick={() => setEditing(!editing)}
        >
          {editing ? <MousePointer2 size={15} /> : <Hand size={15} />}
        </button>
        <button
          aria-label="缩小"
          data-tip="缩小"
          onClick={() => canvas?.zoom(1 / 1.25)}
        >
          <Minus size={15} />
        </button>
        <button
          aria-label="放大"
          data-tip="放大"
          onClick={() => canvas?.zoom(1.25)}
        >
          <Plus size={15} />
        </button>
        <button
          aria-label="适应画布"
          data-tip="适应画布（0）"
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

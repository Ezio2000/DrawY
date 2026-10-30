import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./cx.ts";
import type {
  Run,
  Step,
  Work,
  Picture,
} from "../../../modules/contracts/index.ts";
type ToolStep = Extract<Step, { kind: "tool" }>;
const focusNames = {
  overview: "",
  region: "局部",
  annotate: "标注",
  actions: "交互",
};
const duration = (ms = 0) => {
  const seconds = Math.round(ms / 1000);
  return seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
};
export const live = (run?: Run) =>
  !!run && ["running", "viewing"].includes(run.status);
/** A thought's headline and the reasoning under it. */
function thought(text: string) {
  const closed = text.match(/^\*\*(.+?)\*\*\s*([\s\S]*)$/);
  return closed
    ? [closed[1], closed[2]]
    : text.startsWith("**")
      ? [text.slice(2), ""]
      : [text.split("\n")[0], text.split("\n").slice(1).join("\n").trim()];
}
/** What the author is doing, in a word or two. */
function doing(step: ToolStep) {
  switch (step.name) {
    case "read_work":
      return "翻阅作品";
    case "find_matirial":
      return step.query ? `寻找素材 · ${step.query}` : "寻找素材";
    case "generate_image":
      return "生成图像";
    case "write_work":
      return step.revision ? `落笔 · 第 ${step.revision} 稿` : "落笔";
    case "view_canvas":
      return ["端详画面", focusNames[step.focus]].filter(Boolean).join(" · ");
  }
}
const picturesOf = (step: Step): Picture[] =>
  step.kind !== "tool"
    ? []
    : step.name === "find_matirial"
      ? step.materials || []
      : step.name === "generate_image"
        ? step.images || []
        : [];
/** One line under the canvas: what the author is doing now, the pictures it is weighing,
 * its question, or how the last run ended. */
export function Now({
  run,
  work,
  offline,
  pictures,
  answer,
  reveal,
  dismiss,
}: {
  run?: Run;
  work: Work;
  offline: boolean;
  /** Whether the pictures being weighed show here rather than on the canvas. */
  pictures: boolean;
  answer: (text: string) => void;
  reveal: () => void;
  dismiss: () => void;
}) {
  if (offline)
    return (
      <div className={cx("now")} data-tone="quiet">
        <i className={cx("now-dot")} />
        <span>连接中断，正在重连…</span>
      </div>
    );
  if (!run) return null;
  if (run.status === "waiting" && run.question)
    return (
      <div className={cx("question")}>
        <p>{run.question.text}</p>
        <div>
          {run.question.options.map((o) => (
            <button key={o} onClick={() => answer(o)}>
              {o}
            </button>
          ))}
        </div>
      </div>
    );
  if (!live(run)) {
    const reply = run.steps.at(-1);
    const text =
      run.status === "completed"
        ? reply?.kind === "message" && reply.role === "assistant"
          ? reply.text
          : ""
        : run.status === "failed"
          ? run.error || "这次没有画完"
          : "已停止";
    if (!text) return null;
    return (
      <div className={cx("now")} data-tone={run.status}>
        <button className={cx("now-reply")} onClick={reveal}>
          {text}
        </button>
        <button className={cx("now-close")} aria-label="收起" onClick={dismiss}>
          <X size={13} />
        </button>
      </div>
    );
  }
  const used = new Set(Object.values(work.resources).map((r) => r.url));
  const board = pictures ? run.steps.flatMap(picturesOf).slice(-6) : [];
  // A tool still at work outranks the thoughts and notes that stream alongside it.
  const busy = run.steps.findLast(
      (s): s is ToolStep => s.kind === "tool" && s.status === "running",
    ),
    tail = run.steps.at(-1),
    painting = pictures && busy?.name === "generate_image";
  const line =
    run.status === "viewing"
      ? "端详画面"
      : busy
        ? doing(busy)
        : tail?.kind === "thinking"
          ? thought(tail.text)[0] || "构思"
          : tail?.kind === "message" && tail.role === "assistant"
            ? tail.text
            : "构思";
  const at = run.status === "viewing" ? -1 : run.steps.indexOf((busy ?? tail)!);
  return (
    <div className={cx("now")} data-tone="live">
      {(!!board.length || painting) && (
        <span className={cx("board")}>
          {board.map((p, i) => (
            <img
              key={p.url + i}
              src={p.url}
              alt={p.name}
              data-used={used.has(p.url) || undefined}
            />
          ))}
          {painting && <i className={cx("developing")} />}
        </span>
      )}
      <i className={cx("now-dot")} />
      <span key={at} className={cx("now-line")}>
        {line}
      </span>
    </div>
  );
}
/** Every run of this work: the request, how the author went about it, and its reply. */
export function Activity({ runs, work }: { runs: Run[]; work: Work }) {
  const [zoom, Z] = useState<Picture>();
  const [open, O] = useState<Record<string, boolean>>({});
  const used = new Set(Object.values(work.resources).map((r) => r.url));
  const last = runs.at(-1);
  return (
    <>
      {!runs.length && <p className={cx("journal-empty")}>还没有对话</p>}
      {runs.map((r) => {
        const reply =
          r.status === "completed" && r.steps.at(-1)?.kind === "message"
            ? r.steps.length - 1
            : -1;
        const unfolded = open[r.id] ?? (r === last && live(r));
        const items: ReactNode[] = [];
        let trace: ReactNode[] = [];
        const flush = () => {
          if (!trace.length) return;
          items.push(
            <ol key={"trace" + items.length} className={cx("trace")}>
              {trace}
            </ol>,
          );
          trace = [];
        };
        r.steps.forEach((s, i) => {
          if (i === reply) return;
          if (s.kind === "message" && s.role === "user") {
            flush();
            items.push(
              <p key={i} className={cx("prompt")}>
                {s.text}
              </p>,
            );
          } else if (unfolded)
            trace.push(
              <Trace
                key={i}
                step={s}
                live={live(r) && i === r.steps.length - 1}
                used={used}
                zoom={Z}
              />,
            );
        });
        flush();
        const steps = r.steps.filter(
          (s) => s.kind === "tool" || s.kind === "thinking",
        ).length;
        const saved = r.steps.findLast(
          (s) => s.kind === "tool" && s.name === "write_work" && s.revision,
        ) as Extract<ToolStep, { name: "write_work" }> | undefined;
        const facts = [
          !!steps && `${steps} 步`,
          r.elapsedMs && duration(r.elapsedMs),
          saved && `第 ${saved.revision} 稿`,
        ].filter(Boolean);
        return (
          <article key={r.id} className={cx("run")} data-status={r.status}>
            {items[0]}
            {!!steps && (
              <button
                className={cx("run-fold")}
                aria-expanded={unfolded}
                onClick={() => O({ ...open, [r.id]: !unfolded })}
              >
                <span>{live(r) ? "正在创作" : "过程"}</span>
                <small>{facts.join(" · ")}</small>
              </button>
            )}
            {items.slice(1)}
            {reply >= 0 && (
              <div className={cx("reply")}>
                {(r.steps[reply] as { text: string }).text}
              </div>
            )}
            {r.status === "failed" && (
              <p className={cx("run-error")}>{r.error || "运行失败"}</p>
            )}
            {r.status === "cancelled" && (
              <p className={cx("run-note")}>已停止</p>
            )}
          </article>
        );
      })}
      {zoom && (
        <div className={cx("lightbox")} onClick={() => Z(undefined)}>
          <img src={zoom.url} alt={zoom.name} />
        </div>
      )}
    </>
  );
}
function Trace({
  step,
  live,
  used,
  zoom,
}: {
  step: Step;
  live: boolean;
  used: Set<string>;
  zoom: (p: Picture) => void;
}) {
  if (step.kind === "message")
    return <li className={cx("trace-note")}>{step.text}</li>;
  if (step.kind === "thinking") {
    const [title, body] = thought(step.text);
    return (
      <li data-status={live ? "running" : "done"}>
        <details>
          <summary>{title || "构思"}</summary>
          {body && <p>{body}</p>}
        </details>
      </li>
    );
  }
  const shots = picturesOf(step).concat(
    step.name === "view_canvas" ? step.screenshots || [] : [],
  );
  return (
    <li data-status={step.status}>
      <span>{doing(step)}</span>
      {step.name === "generate_image" && step.status === "running" && (
        <i className={cx("developing")} title={step.prompt} />
      )}
      {!!shots.length && (
        <div className={cx("thumbs")} data-kind={step.name}>
          {shots.map((p, i) => (
            <button
              key={p.url + i}
              title={p.name}
              data-used={used.has(p.url) || undefined}
              onClick={() => zoom(p)}
            >
              <img src={p.url} alt={p.name} loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {step.name === "find_matirial" && step.materials?.length === 0 && (
        <small>没有合适的素材</small>
      )}
      {[
        ...(step.name === "view_canvas" ? step.errors || [] : []),
        ...(step.error ? [step.error] : []),
      ].map((e, i) => (
        <small key={i} className={cx("trace-error")}>
          {e}
        </small>
      ))}
    </li>
  );
}

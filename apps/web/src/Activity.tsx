import { useState, type ReactNode } from "react";
import {
  BookOpen,
  Check,
  CircleAlert,
  CircleCheck,
  CircleStop,
  Eye,
  PenLine,
  Search,
  Sparkles,
  Lightbulb,
} from "lucide-react";
import { Spinner } from "@drawy/ui";
import { cx } from "./cx.ts";
import type {
  Run,
  Step,
  Work,
  Picture,
} from "../../../modules/contracts/index.ts";
type ToolStep = Extract<Step, { kind: "tool" }>;
const focusNames = {
  overview: "全图",
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
export function Activity({
  runs,
  work,
  offline,
}: {
  runs: Run[];
  work: Work;
  offline: boolean;
}) {
  const [zoom, Z] = useState<Picture>();
  const used = new Set(Object.values(work.resources).map((r) => r.url));
  const last = runs.at(-1);
  const working = last && ["running", "viewing"].includes(last.status);
  const tail = last?.steps.at(-1);
  const busy =
    tail?.kind === "thinking" ||
    last?.steps.some((s) => s.kind === "tool" && s.status === "running");
  return (
    <>
      {runs.flatMap((r) => {
        const live = r === last && working;
        const reply =
          r.status === "completed" && r.steps.at(-1)?.kind === "message"
            ? r.steps.length - 1
            : -1;
        return [
          ...r.steps.map((s, i) => {
            const key = r.id + i;
            if (i === reply) return null;
            if (s.kind === "message")
              return (
                <p key={key} data-role={s.role}>
                  {s.text}
                </p>
              );
            if (s.kind === "thinking")
              return (
                <Thinking
                  key={key}
                  text={s.text}
                  live={!!live && i === r.steps.length - 1}
                />
              );
            return <Tool key={key} step={s} used={used} zoom={Z} />;
          }),
          <Ending key={r.id + "end"} run={r} reply={r.steps[reply]} />,
        ];
      })}
      {offline ? (
        <p className={cx("drawy-progress")}>
          <Spinner size={14} />
          连接中断，正在重连…
        </p>
      ) : (
        working &&
        !busy && (
          <p className={cx("drawy-progress")}>
            <Spinner size={14} />
            {last.status === "viewing" ? "正在查看画布…" : "正在思考…"}
          </p>
        )
      )}
      {zoom && (
        <div className={cx("drawy-lightbox")} onClick={() => Z(undefined)}>
          <img src={zoom.url} alt={zoom.name} />
        </div>
      )}
    </>
  );
}
function Ending({ run, reply }: { run: Run; reply?: Step }) {
  if (!["completed", "failed", "cancelled"].includes(run.status)) return null;
  const revision = run.steps.findLast(
    (s) => s.kind === "tool" && s.name === "write_work" && s.revision,
  ) as Extract<ToolStep, { name: "write_work" }> | undefined;
  const facts = [
    run.elapsedMs && `用时 ${duration(run.elapsedMs)}`,
    revision && `版本 ${revision.revision}`,
  ].filter(Boolean);
  const [icon, title] =
    run.status === "completed"
      ? [<CircleCheck size={16} />, "已完成"]
      : run.status === "failed"
        ? [<CircleAlert size={16} />, "运行失败"]
        : [<CircleStop size={16} />, "已停止"];
  return (
    <div className={cx("drawy-ending")} data-status={run.status}>
      <header>
        {icon}
        <strong>{title}</strong>
        {!!facts.length && <small>{facts.join(" · ")}</small>}
      </header>
      {reply?.kind === "message" && <p>{reply.text}</p>}
      {run.status === "failed" && run.error && (
        <p className={cx("drawy-clamp")}>{run.error}</p>
      )}
    </div>
  );
}
function Thinking({ text, live }: { text: string; live: boolean }) {
  const closed = text.match(/^\*\*(.+?)\*\*\s*([\s\S]*)$/);
  const [title, body] = closed
    ? [closed[1], closed[2]]
    : text.startsWith("**")
      ? [text.slice(2), ""]
      : [text.split("\n")[0], text.split("\n").slice(1).join("\n").trim()];
  return (
    <details className={cx("drawy-thinking")} open={live || undefined}>
      <summary>
        {live ? <Spinner size={14} /> : <Lightbulb size={14} />}
        <span>{title || "正在思考…"}</span>
      </summary>
      {body && <p>{body}</p>}
    </details>
  );
}
function Tool({
  step,
  used,
  zoom,
}: {
  step: ToolStep;
  used: Set<string>;
  zoom: (p: Picture) => void;
}) {
  const thumbs = (items: Picture[] | undefined, kind: string) =>
    !!items?.length && (
      <div className={cx("drawy-thumbs")} data-kind={kind}>
        {items.map((p) => (
          <button
            key={p.url}
            title={p.name}
            data-used={(kind === "material" && used.has(p.url)) || undefined}
            onClick={() => zoom(p)}
          >
            <img src={p.url} alt={p.name} loading="lazy" />
          </button>
        ))}
      </div>
    );
  let icon: ReactNode, title: ReactNode, body: ReactNode;
  switch (step.name) {
    case "read_work":
      icon = <BookOpen size={14} />;
      title = "读取作品";
      body = step.revision !== undefined && <small>版本 {step.revision}</small>;
      break;
    case "find_matirial":
      icon = <Search size={14} />;
      title = step.query ? <>搜索素材“{step.query}”</> : "搜索素材";
      body =
        step.materials && !step.materials.length ? (
          <small>没有匹配的素材</small>
        ) : (
          thumbs(step.materials, "material")
        );
      break;
    case "generate_image":
      icon = <Sparkles size={14} />;
      title = "生成图片";
      body = (
        <>
          {step.prompt && (
            <small className={cx("drawy-clamp")}>{step.prompt}</small>
          )}
          {step.status === "running" ? (
            <div className={cx("drawy-painting")} />
          ) : (
            thumbs(step.images, "image")
          )}
        </>
      );
      break;
    case "write_work": {
      icon = <PenLine size={14} />;
      title =
        step.revision !== undefined
          ? `保存为版本 ${step.revision}`
          : "保存修改";
      const chips = [
        ...step.scenes.map((s) => `场景 ${s.title} · ${s.modules} 个模块`),
        ...step.drawings.map((d) => `画法 ${d}`),
        ...step.details.map((d) => `说明 ${d}`),
        ...(step.removed ? [`移除 ${step.removed} 项`] : []),
      ];
      body = (
        <>
          {!!chips.length && (
            <div className={cx("drawy-chips")}>
              {chips.map((c, i) => (
                <span key={i}>{c}</span>
              ))}
            </div>
          )}
          {thumbs(step.resources, "material")}
        </>
      );
      break;
    }
    case "view_canvas":
      icon = <Eye size={14} />;
      title = (
        <>
          查看画布 · {focusNames[step.focus]}
          {step.sceneId && ` · ${step.sceneId}`}
        </>
      );
      body = (
        <>
          {thumbs(step.screenshots, "screenshot")}
          {step.errors?.map((e, i) => (
            <small key={i} className={cx("drawy-step-error")}>
              {e}
            </small>
          ))}
        </>
      );
      break;
  }
  return (
    <div className={cx("drawy-step")} data-status={step.status}>
      <header>
        {icon}
        <span className={cx("drawy-step-title")}>{title}</span>
        {step.status === "running" ? (
          <Spinner size={13} />
        ) : step.status === "done" ? (
          <Check size={13} />
        ) : (
          <CircleAlert size={13} />
        )}
      </header>
      {body}
      {step.error && (
        <small className={cx("drawy-step-error drawy-clamp")}>
          {step.error}
        </small>
      )}
    </div>
  );
}

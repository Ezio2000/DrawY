import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { api } from "./api.ts";
import { cx } from "./cx.ts";
import type { Span, TraceSummary } from "../../../modules/trace/index.ts";

const kindNames: Record<Span["kind"], string> = {
  execution: "执行",
  turn: "模型",
  tool: "工具",
  search: "检索",
  generation: "生图",
  capture: "截图",
  compact: "压缩",
  note: "记录",
};
const seconds = (ms: number) =>
  ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
const live = (status: string) => ["running", "viewing"].includes(status);
const pretty = (v: unknown) => {
  if (typeof v === "string")
    try {
      return JSON.stringify(JSON.parse(v), null, 2);
    } catch {
      return v;
    }
  return JSON.stringify(v, null, 2);
};

/** Every run of the user's works, and for one run each model turn, tool call, search,
 * generation and capture in time order, with what went in and came out. */
export function TraceView({ close }: { close: () => void }) {
  const [list, setList] = useState<TraceSummary[]>([]);
  const [selected, setSelected] = useState<string | undefined>(
    location.pathname.match(/^\/traces\/([^/]+)/)?.[1],
  );
  const [detail, setDetail] = useState<{
    trace: TraceSummary;
    spans: Span[];
  }>();
  const [error, setError] = useState("");
  const refresh = () =>
    api<TraceSummary[]>("/traces")
      .then((l) => {
        setList(l);
        if (!selected && l[0]) setSelected(l[0].id);
      })
      .catch((e) => setError(e.message));
  useEffect(() => void refresh(), []);
  useEffect(() => {
    if (!selected) return;
    history.replaceState(null, "", "/traces/" + selected);
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      api<{ trace: TraceSummary; spans: Span[] }>("/traces/" + selected)
        .then((d) => {
          setDetail(d);
          if (live(d.trace.status)) timer = setTimeout(load, 2500);
        })
        .catch((e) => setError(e.message));
    void load();
    return () => clearTimeout(timer);
  }, [selected]);
  return (
    <div className={cx("traces")}>
      <aside>
        <header>
          <button aria-label="返回" onClick={close}>
            <ArrowLeft size={16} />
          </button>
          <h2>运行记录</h2>
          <button aria-label="刷新" onClick={() => void refresh()}>
            <RefreshCw size={14} />
          </button>
        </header>
        <ol>
          {list.map((t) => (
            <li key={t.id}>
              <button
                aria-current={t.id === selected || undefined}
                onClick={() => setSelected(t.id)}
              >
                <span className={cx("trace-row-top")}>
                  <b>{t.title}</b>
                  <i data-status={t.status}>{t.status}</i>
                </span>
                <span className={cx("trace-prompt")}>{t.prompt}</span>
                <small>
                  {new Date(t.startedAt).toLocaleString("zh-CN")} ·{" "}
                  {seconds(t.durationMs)} · {t.counts.turn} 轮 · {t.counts.tool}{" "}
                  工具
                  {t.counts.generation ? ` · ${t.counts.generation} 生图` : ""}
                  {t.counts.errors ? ` · ${t.counts.errors} 错误` : ""}
                </small>
              </button>
            </li>
          ))}
        </ol>
      </aside>
      <main>
        {error && <p className={cx("error")}>{error}</p>}
        {detail && <Timeline {...detail} />}
      </main>
    </div>
  );
}
function Timeline({ trace, spans }: { trace: TraceSummary; spans: Span[] }) {
  const [open, setOpen] = useState<string>();
  const [kinds, setKinds] = useState<Set<Span["kind"]>>(new Set());
  const rows = useMemo(() => {
    const children = new Map<string | null, Span[]>();
    for (const s of spans) {
      const list = children.get(s.parentId) || [];
      list.push(s);
      children.set(s.parentId, list);
    }
    const out: { span: Span; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const s of children.get(parent) || []) {
        out.push({ span: s, depth });
        walk(s.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [spans]);
  const t0 = Math.min(...spans.map((s) => s.startedAt), trace.startedAt);
  const t1 = Math.max(...spans.map((s) => s.endedAt ?? Date.now()), t0 + 1);
  const shown = rows.filter((r) => !kinds.size || kinds.has(r.span.kind));
  return (
    <>
      <header className={cx("trace-head")}>
        <h1>{trace.title}</h1>
        <p>{trace.prompt}</p>
        <dl>
          <dt>状态</dt>
          <dd data-status={trace.status}>{trace.status}</dd>
          <dt>耗时</dt>
          <dd>{seconds(trace.durationMs)}</dd>
          <dt>Token</dt>
          <dd>
            输入 {trace.tokens.input.toLocaleString()}（缓存{" "}
            {trace.tokens.cached.toLocaleString()}）· 输出{" "}
            {trace.tokens.output.toLocaleString()}（推理{" "}
            {trace.tokens.reasoning.toLocaleString()}）
          </dd>
          <dt>Run</dt>
          <dd>
            <code>{trace.id}</code>
          </dd>
        </dl>
        <nav>
          {(Object.keys(kindNames) as Span["kind"][])
            .filter((k) => trace.counts[k])
            .map((k) => (
              <button
                key={k}
                aria-pressed={kinds.has(k)}
                onClick={() => {
                  const next = new Set(kinds);
                  if (next.has(k)) next.delete(k);
                  else next.add(k);
                  setKinds(next);
                }}
              >
                {kindNames[k]} {trace.counts[k]}
              </button>
            ))}
        </nav>
      </header>
      <ol className={cx("spans")}>
        {shown.map(({ span: s, depth }) => {
          const end = s.endedAt ?? Date.now();
          return (
            <li key={s.id} data-kind={s.kind} data-status={s.status}>
              <button
                aria-expanded={open === s.id}
                onClick={() => setOpen(open === s.id ? undefined : s.id)}
              >
                <span
                  className={cx("span-name")}
                  style={{ paddingLeft: depth * 14 }}
                >
                  <i>{kindNames[s.kind]}</i>
                  {s.name}
                  {s.error && <em>{s.error.slice(0, 80)}</em>}
                </span>
                <span className={cx("span-bar")}>
                  <i
                    style={{
                      left: `${((s.startedAt - t0) / (t1 - t0)) * 100}%`,
                      width: `max(2px, ${((end - s.startedAt) / (t1 - t0)) * 100}%)`,
                    }}
                  />
                </span>
                <small>{s.endedAt ? seconds(end - s.startedAt) : "…"}</small>
              </button>
              {open === s.id && <Attributes span={s} />}
            </li>
          );
        })}
      </ol>
    </>
  );
}
/** A span's inputs and outputs, with pictures shown as pictures. */
function Attributes({ span }: { span: Span }) {
  const a = span.attrs as Record<string, any>;
  const blocks: ReactNode[] = [];
  const block = (title: string, value: unknown) =>
    value !== undefined &&
    blocks.push(
      <section key={title}>
        <h4>{title}</h4>
        <pre>{pretty(value)}</pre>
      </section>,
    );
  const images: { url: string; label: string }[] = [];
  if (span.kind === "capture")
    for (const s of a.shots || []) images.push({ url: s.url, label: s.view });
  if (span.kind === "generation" && a.url)
    images.push({ url: a.url, label: span.name });
  if (span.error) block("错误", span.error);
  switch (span.kind) {
    case "turn": {
      const output = (a.output || []) as Record<string, any>[];
      for (const item of output) {
        if (item.type === "reasoning")
          block(
            "思考摘要",
            (item.summary || []).map((s: any) => s.text).join("\n\n") || "(无)",
          );
        else if (item.type === "message")
          block("回复", (item.content || []).map((c: any) => c.text).join(""));
        else if (item.type === "function_call")
          block(`调用 ${item.name}`, item.arguments);
      }
      block("用量", { ...a.usage, firstOutputMs: a.firstOutputMs });
      block(
        `本轮新增输入（共 ${a.inputItems} 项，约 ${a.estimatedTokens} tokens）`,
        a.input,
      );
      break;
    }
    case "tool":
      block("参数", a.args);
      block("结果", a.output);
      break;
    case "execution": {
      const { instructions, ...rest } = a;
      block("设置", rest);
      if (instructions)
        blocks.push(
          <details key="instructions">
            <summary>系统提示词（{instructions.length} 字符）</summary>
            <pre>{instructions}</pre>
          </details>,
        );
      break;
    }
    default:
      block("属性", a);
  }
  return (
    <div className={cx("span-detail")}>
      {!!images.length && (
        <div className={cx("span-images")}>
          {images.map((i) => (
            <figure key={i.url}>
              <a href={i.url} target="_blank" rel="noreferrer">
                <img src={i.url} alt={i.label} loading="lazy" />
              </a>
              <figcaption>{i.label}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {blocks}
    </div>
  );
}

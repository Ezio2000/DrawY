import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "./api.ts";
import { cx } from "./cx.ts";
import { ago } from "./time.ts";
import { Lettering } from "./Lettering.tsx";
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
const statuses: Record<string, string> = {
  running: "进行中",
  viewing: "进行中",
  waiting: "等待回答",
  completed: "完成",
  failed: "失败",
  cancelled: "已停止",
  ok: "完成",
  error: "出错",
};
const pretty = (v: unknown) => {
  if (typeof v === "string")
    try {
      return JSON.stringify(JSON.parse(v), null, 2);
    } catch {
      return v;
    }
  return JSON.stringify(v, null, 2);
};
const thousands = (n: number) =>
  n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n);
function Status({ value }: { value: string }) {
  return (
    <i className={cx("status")} data-status={value}>
      {statuses[value] || value}
    </i>
  );
}

/** Every run of the user's works, and for one run each model turn, tool call, search,
 * generation and capture in time order, with what went in and came out. */
export function TraceView() {
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
          <h1>
            <Lettering name="traces" height={44} />
          </h1>
          <button
            aria-label="刷新"
            data-tip="刷新"
            onClick={() => void refresh()}
          >
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
                <b>{t.title}</b>
                <span className={cx("trace-prompt")}>{t.prompt}</span>
                <small>
                  <Status value={t.status} />
                  {ago(t.startedAt)} · {seconds(t.durationMs)}
                  {t.counts.generation ? ` · ${t.counts.generation} 张图` : ""}
                  {t.counts.errors ? (
                    <em> · {t.counts.errors} 个错误</em>
                  ) : null}
                </small>
              </button>
            </li>
          ))}
        </ol>
        {!list.length && !error && (
          <p className={cx("traces-empty")}>还没有运行记录</p>
        )}
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
  const contexts = useMemo(() => inputs(spans), [spans]);
  return (
    <>
      <header className={cx("trace-head")}>
        <h2>{trace.title}</h2>
        <p>{trace.prompt}</p>
        <dl>
          <div>
            <dt>状态</dt>
            <dd>
              <Status value={trace.status} />
            </dd>
          </div>
          <div>
            <dt>耗时</dt>
            <dd>{seconds(trace.durationMs)}</dd>
          </div>
          <div>
            <dt>模型轮次</dt>
            <dd>{trace.counts.turn}</dd>
          </div>
          <div>
            <dt>工具调用</dt>
            <dd>{trace.counts.tool}</dd>
          </div>
          <div>
            <dt>输入 Token</dt>
            <dd title={`缓存 ${trace.tokens.cached.toLocaleString()}`}>
              {thousands(trace.tokens.input)}
              <small> 缓存 {thousands(trace.tokens.cached)}</small>
            </dd>
          </div>
          <div>
            <dt>输出 Token</dt>
            <dd title={`推理 ${trace.tokens.reasoning.toLocaleString()}`}>
              {thousands(trace.tokens.output)}
              <small> 推理 {thousands(trace.tokens.reasoning)}</small>
            </dd>
          </div>
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
                  {metric(s) && <small>{metric(s)}</small>}
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
              {open === s.id && (
                <Attributes span={s} context={contexts.get(s.id)} />
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
type Item = Record<string, any>;
const k = (n = 0) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n);
const usageOf = (a: Item) => {
  const u = (a.usage || {}) as Item,
    input = u.input_tokens ?? 0,
    cached = u.input_tokens_details?.cached_tokens ?? 0;
  return {
    input,
    cached,
    hit: input ? Math.round((cached / input) * 100) : 0,
    output: u.output_tokens ?? 0,
    reasoning: u.output_tokens_details?.reasoning_tokens ?? 0,
  };
};
/** A few words on what a span did, shown in its row. */
function metric(s: Span) {
  const a = s.attrs as Item;
  if ((s.kind === "turn" || s.kind === "compact") && a.usage) {
    const u = usageOf(a);
    return `输入 ${k(u.input)} · 缓存 ${u.hit}% · 输出 ${k(u.output)}`;
  }
  if (s.kind === "generation") return a.size;
  if (s.kind === "search")
    return (a.subjects as string[] | undefined)?.join("、");
  if (s.kind === "capture") return `${(a.shots || []).length} 张`;
  if (s.kind === "note" && a.status) return `HTTP ${a.status} · ${a.ms}ms`;
  return "";
}
/** The whole input each model turn was sent: where its execution started, then every
 * turn's additions and outputs in order; a compaction starts it afresh. */
function inputs(spans: Span[]) {
  const out = new Map<string, { items: Item[]; complete: boolean }>();
  for (const e of spans.filter((s) => s.kind === "execution")) {
    const base = (e.attrs as Item).context as Item[] | undefined;
    let items: Item[] = base ?? [],
      complete = !!base,
      pending: Item[] = [],
      fresh = false;
    for (const s of spans.filter((x) => x.parentId === e.id)) {
      if (s.kind === "compact" && (s.attrs as Item).replaced) {
        fresh = true;
        complete = true;
      }
      if (s.kind !== "turn") continue;
      const a = s.attrs as Item,
        added = (a.input || []) as Item[];
      items = fresh ? [...added] : [...items, ...pending, ...added];
      fresh = false;
      out.set(s.id, { items, complete });
      pending = (a.output || []) as Item[];
    }
  }
  return out;
}
function Copy({ value }: { value: unknown }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={cx("copy")}
      onClick={() => {
        void navigator.clipboard.writeText(
          typeof value === "string" ? value : JSON.stringify(value, null, 2),
        );
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? "已复制" : "复制"}
    </button>
  );
}
/** A titled part of a span, with its content copyable. */
function Part({
  title,
  value,
  children,
  open = true,
}: {
  title: string;
  value?: unknown;
  children?: ReactNode;
  open?: boolean;
}) {
  return (
    <details className={cx("part")} open={open}>
      <summary>
        <h4>{title}</h4>
        {value !== undefined && <Copy value={value} />}
      </summary>
      {children ?? <pre>{pretty(value)}</pre>}
    </details>
  );
}
/** Long text shows its beginning until asked for the rest. */
function Text({ text }: { text: string }) {
  const [all, setAll] = useState(false);
  const long = text.length > 1600;
  return (
    <div className={cx("text")}>
      <pre>{long && !all ? text.slice(0, 1200) + "…" : text}</pre>
      {long && (
        <button onClick={() => setAll(!all)}>
          {all ? "收起" : `展开全部 ${text.length.toLocaleString()} 字符`}
        </button>
      )}
    </div>
  );
}
function Shot({ url, label }: { url: string; label?: string }) {
  return url.startsWith("/") ? (
    <figure className={cx("shot")}>
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={label || ""} loading="lazy" />
      </a>
      {label && <figcaption>{label}</figcaption>}
    </figure>
  ) : (
    <span className={cx("shot-missing")}>{url}</span>
  );
}
/** One part of a message: text, an image or anything else. */
function Content({ part }: { part: Item | string }) {
  if (typeof part === "string") return <Text text={part} />;
  if (part.type === "input_image")
    return <Shot url={part.image_url} label={part.detail} />;
  if (typeof part.text === "string") return <Text text={part.text} />;
  return <pre>{pretty(part)}</pre>;
}
/** Model input or output items as a conversation: messages with their text and images,
 * tool calls with their arguments, tool results, and reasoning summaries. */
function Conversation({ items }: { items: Item[] }) {
  return (
    <ol className={cx("conversation")}>
      {items.map((item, i) => {
        if (item.type === "function_call")
          return (
            <li key={i} data-role="call">
              <b>调用 {item.name}</b>
              <Text text={pretty(item.arguments)} />
            </li>
          );
        if (item.type === "function_call_output")
          return (
            <li key={i} data-role="result">
              <b>工具结果</b>
              <Text text={pretty(item.output)} />
            </li>
          );
        if (item.type === "reasoning")
          return (
            <li key={i} data-role="reasoning">
              <b>思考摘要</b>
              <Text
                text={
                  (item.summary || []).map((s: Item) => s.text).join("\n\n") ||
                  "（无）"
                }
              />
            </li>
          );
        const role = item.role || item.type;
        const parts: (Item | string)[] =
          typeof item.content === "string" ? [item.content] : item.content || [];
        return (
          <li key={i} data-role={role}>
            <b>{{ user: "用户", assistant: "模型", developer: "开发者", system: "系统" }[role as string] || role}</b>
            {parts.map((p, j) => (
              <Content key={j} part={p} />
            ))}
          </li>
        );
      })}
    </ol>
  );
}
/** What a span took in and gave out, laid out for its kind; the raw record is always one
 * click away. */
function Attributes({
  span,
  context,
}: {
  span: Span;
  context?: { items: Item[]; complete: boolean };
}) {
  const a = span.attrs as Item;
  const [view, setView] = useState(context?.complete ? "whole" : "added");
  const parts: ReactNode[] = [];
  if (span.error) parts.push(<Part key="error" title="错误" value={span.error} />);
  switch (span.kind) {
    case "turn": {
      const u = usageOf(a);
      parts.push(
        <Part key="usage" title="用量与请求">
          <dl className={cx("facts")}>
            <dt>输入</dt>
            <dd>{u.input.toLocaleString()} tokens</dd>
            <dt>缓存命中</dt>
            <dd>
              {u.cached.toLocaleString()}（{u.hit}%），未命中{" "}
              {(u.input - u.cached).toLocaleString()}
            </dd>
            <dt>输出</dt>
            <dd>
              {u.output.toLocaleString()}，其中推理 {u.reasoning.toLocaleString()}
            </dd>
            <dt>首个输出</dt>
            <dd>{a.firstOutputMs !== undefined ? seconds(a.firstOutputMs) : "—"}</dd>
            <dt>总耗时</dt>
            <dd>{span.endedAt ? seconds(span.endedAt - span.startedAt) : "进行中"}</dd>
            <dt>上下文</dt>
            <dd>
              {a.inputItems} 项，估算 {k(a.estimatedTokens)} tokens
            </dd>
            {a.request && (
              <>
                <dt>请求</dt>
                <dd>
                  {a.request.model} · 思考 {a.request.effort} ·{" "}
                  {a.request.serviceTier} · 系统提示词{" "}
                  {k(a.request.instructionsChars)} 字符 · {a.request.tools} 个工具
                </dd>
              </>
            )}
            {a.response?.id && (
              <>
                <dt>响应</dt>
                <dd>
                  <code>{a.response.id}</code> · {a.response.model} ·{" "}
                  {a.response.service_tier}
                </dd>
              </>
            )}
          </dl>
        </Part>,
      );
      const whole = context?.items;
      parts.push(
        <Part
          key="input"
          title={
            view === "whole" && whole
              ? `输入 · 完整 ${whole.length} 项`
              : `输入 · 本轮新增 ${(a.input || []).length} 项`
          }
          value={view === "whole" && whole ? whole : a.input}
        >
          <nav className={cx("views")}>
            {whole && (
              <button aria-pressed={view === "whole"} onClick={() => setView("whole")}>
                完整输入
              </button>
            )}
            <button aria-pressed={view === "added"} onClick={() => setView("added")}>
              本轮新增
            </button>
            <button aria-pressed={view === "raw"} onClick={() => setView("raw")}>
              原始 JSON
            </button>
          </nav>
          {view === "whole" && whole && !context.complete && (
            <p className={cx("hint")}>
              这次执行没有记录起始上下文，这里只包含执行中逐轮新增的部分。
            </p>
          )}
          {view === "raw" ? (
            <pre>{pretty(a.input)}</pre>
          ) : (
            <Conversation items={view === "whole" && whole ? whole : a.input || []} />
          )}
        </Part>,
        <Part key="output" title={`输出 · ${(a.output || []).length} 项`} value={a.output}>
          <Conversation items={a.output || []} />
        </Part>,
      );
      break;
    }
    case "tool":
      parts.push(
        <Part key="args" title="参数" value={a.args} />,
        <Part key="out" title="结果" value={a.output} />,
      );
      if (Array.isArray(a.images) && a.images.length)
        parts.push(
          <Part key="images" title={`返回给模型的图片 · ${a.images.length}`}>
            <div className={cx("shots")}>
              {a.images.map((url: string, i: number) => (
                <Shot key={i} url={url} />
              ))}
            </div>
          </Part>,
        );
      break;
    case "generation":
      parts.push(
        <Part key="result" title="结果">
          <dl className={cx("facts")}>
            <dt>尺寸</dt>
            <dd>{a.size}</dd>
            <dt>模型</dt>
            <dd>{a.model}</dd>
            {a.bytes && (
              <>
                <dt>大小</dt>
                <dd>{k(a.bytes)}B</dd>
              </>
            )}
            {!!a.references?.length && (
              <>
                <dt>参考</dt>
                <dd>{a.references.join("、")}</dd>
              </>
            )}
          </dl>
          <div className={cx("shots")}>
            {(a.referenceImages || []).map((url: string, i: number) => (
              <Shot key={i} url={url} label={`参考 ${a.references?.[i] ?? ""}`} />
            ))}
            {a.url && <Shot url={a.url} label="生成结果" />}
          </div>
        </Part>,
        <Part key="prompt" title="提示词" value={a.prompt}>
          <Text text={a.prompt || ""} />
        </Part>,
      );
      break;
    case "search":
      parts.push(
        <Part key="request" title="请求" value={{ subjects: a.subjects, style: a.style, kinds: a.kinds, roles: a.roles, limit: a.limit }} />,
        <Part key="results" title="结果" value={a.results}>
          {(a.results || []).map((r: Item) => (
            <section key={r.subject} className={cx("hits")}>
              <h5>{r.subject}</h5>
              {!r.hits.length && <p className={cx("hint")}>没有命中</p>}
              <ol>
                {r.hits.map((h: Item | string, i: number) =>
                  typeof h === "string" ? (
                    <li key={i}>{h}</li>
                  ) : (
                    <li key={h.id}>
                      {h.url ? <img src={h.url} alt="" loading="lazy" /> : <span />}
                      <b>{h.name}</b>
                      <code>{h.id}</code>
                      <i data-match={h.match}>{h.match}</i>
                      <small>{h.style ?? "—"}</small>
                      <small>{Number(h.score).toFixed(2)}</small>
                    </li>
                  ),
                )}
              </ol>
            </section>
          ))}
        </Part>,
      );
      break;
    case "capture":
      parts.push(
        <Part key="request" title="请求" value={{ revision: a.revision, sceneId: a.sceneId, region: a.region, annotate: a.annotate, actions: a.actions }} />,
        ...(a.shots || []).map((shot: Item, i: number) => (
          <Part key={"shot" + i} title={shot.view} value={shot}>
            <div className={cx("shots")}>
              <Shot url={shot.url} />
            </div>
            {!!shot.errors?.length && <Text text={shot.errors.join("\n")} />}
            {shot.modules && (
              <Part title={`交给模型的几何 · ${shot.modules.length} 个模块`} value={shot.modules} open={false} />
            )}
          </Part>
        )),
      );
      break;
    case "compact":
      parts.push(
        <Part key="summary" title="压缩后的摘要" value={a.summary}>
          <Text text={a.summary || ""} />
        </Part>,
        <Part key="usage" title="用量" value={{ size: a.size, usage: a.usage, response: a.response }} />,
      );
      break;
    case "execution": {
      const { instructions, context: start, tools, ...rest } = a;
      parts.push(<Part key="settings" title="设置" value={rest} />);
      if (tools)
        parts.push(
          <Part key="tools" title={`工具 · ${tools.length}`} value={tools}>
            <p className={cx("hint")}>{tools.join("、")}</p>
          </Part>,
        );
      if (instructions)
        parts.push(
          <Part key="instructions" title={`系统提示词 · ${instructions.length.toLocaleString()} 字符`} value={instructions} open={false}>
            <Text text={instructions} />
          </Part>,
        );
      if (start)
        parts.push(
          <Part key="context" title={`起始上下文 · ${start.length} 项`} value={start} open={false}>
            <Conversation items={start} />
          </Part>,
        );
      break;
    }
    default:
      parts.push(<Part key="attrs" title="属性" value={a} />);
  }
  return (
    <div className={cx("span-detail")}>
      {parts}
      <Part title="原始记录" value={span} open={false} />
    </div>
  );
}

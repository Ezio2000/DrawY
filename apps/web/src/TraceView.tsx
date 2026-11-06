import type { Citation, RunCost, RunServices } from "../../../modules/contracts/index.ts";
import { money } from "./money.ts";
import { CitedText } from "./CitedText.tsx";
import { citationsOf } from "../../../modules/models/index.ts";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "./api.ts";
import { cx } from "./cx.ts";
import { ago } from "./time.ts";
import { Title } from "./Title.tsx";
import { pageLocale, Spinner } from "@drawy/ui";
import { dictionaries } from "./i18n.tsx";
import type { Meter, Span, TraceSummary } from "../../../modules/trace/index.ts";

/** The trace page's words in the page's language. */
const w = () => dictionaries[pageLocale()].traces;
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
const thousands = (n: number) =>
  n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n);
/** What a meter counts, in words: a known kind of work, or the tool's own name. */
const meterName = (key: string) =>
  w().meters[key] ?? (w().kinds as Record<string, string>)[key] ?? key.replace(/[_-]+/g, " ");
/** Tool calls and pictures before model turns and the rest. */
const order = (m: Meter) =>
  m.kind === "tool" ? 0 : m.kind === "generation" ? 1 : m.kind === "turn" ? 2 : 3;
function Status({ value }: { value: string }) {
  return (
    <i className={cx("status")} data-status={value}>
      {w().statuses[value] || value}
    </i>
  );
}
/** A trace with what its run cost and was made with, as the server adds them. */
type Costed = TraceSummary & { cost?: RunCost; services?: RunServices };

/** Every run of the user's works, and for one run each model turn, tool call, search,
 * generation and capture in time order, with what went in and came out. */
export function TraceView() {
  // Undefined until the first list arrives, so an empty list is never shown while loading.
  const [list, setList] = useState<Costed[]>();
  const [selected, setSelected] = useState<string | undefined>(
    location.pathname.match(/^\/traces\/([^/]+)/)?.[1],
  );
  const [detail, setDetail] = useState<{
    trace: Costed;
    spans: Span[];
  }>();
  const [error, setError] = useState("");
  const refresh = () =>
    api<Costed[]>("/traces")
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
      api<{ trace: Costed; spans: Span[] }>("/traces/" + selected)
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
            <Title name="traces" size="section" />
          </h1>
          <button
            aria-label={w().refresh}
            data-tip={w().refresh}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} />
          </button>
        </header>
        <ol>
          {list?.map((t) => (
            <li key={t.id}>
              <button
                aria-current={t.id === selected || undefined}
                onClick={() => setSelected(t.id)}
              >
                <span className={cx("trace-row")}>
                  <b>{t.title}</b>
                  {t.cost && <em className={cx("trace-cost")}>{money(t.cost.total)}</em>}
                </span>
                <span className={cx("trace-prompt")}>{t.prompt}</span>
                <small>
                  <Status value={t.status} />
                  <span>{ago(t.startedAt)}</span>
                  <span>{seconds(t.durationMs)}</span>
                  {!!t.counts.errors && <em>{w().errorCount(t.counts.errors)}</em>}
                </small>
              </button>
            </li>
          ))}
        </ol>
        {!list && !error && <Spinner />}
        {list && !list.length && !error && (
          <p className={cx("traces-empty")}>{w().empty}</p>
        )}
      </aside>
      <main>
        {error && <p className={cx("error")}>{error}</p>}
        {detail && <Timeline {...detail} />}
      </main>
    </div>
  );
}
/** One figure at the top of a run: what it measures, the number, and what makes it up. */
function Stat({ label, value, parts }: { label: string; value: ReactNode; parts?: ReactNode[] }) {
  const shown = (parts ?? []).filter(Boolean);
  return (
    <div className={cx("stat")}>
      <dt>{label}</dt>
      <dd>
        <b>{value}</b>
        {!!shown.length && (
          <span>
            {shown.map((p, i) => (
              <small key={i}>{p}</small>
            ))}
          </span>
        )}
      </dd>
    </div>
  );
}
function Timeline({ trace, spans }: { trace: Costed; spans: Span[] }) {
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
  const c = trace.cost,
    v = trace.services,
    tk = trace.tokens;
  const made = (
    v
      ? [
          v.author,
          v.effort && `${w().thinkingEffort} ${v.effort}`,
          v.speed && v.speed !== "default" && v.speed,
          v.search === "off" ? w().noSearch : v.search === "builtin" ? w().builtinSearch : v.searchBy,
          v.image,
        ]
      : []
  ).filter(Boolean) as string[];
  return (
    <>
      <header className={cx("trace-head")}>
        <div className={cx("trace-title")}>
          <h2>{trace.title}</h2>
          <Status value={trace.status} />
        </div>
        {trace.prompt && <blockquote>{trace.prompt}</blockquote>}
        {!!made.length && (
          <ul className={cx("trace-made")}>
            {made.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        )}
        <dl className={cx("stats")}>
          <Stat
            label={w().cost}
            value={c ? money(c.total) : "—"}
            parts={
              c
                ? [
                    `${w().costAuthor} ${money(c.author)}`,
                    `${w().costSearch} ${money(c.search)}`,
                    `${w().costImage} ${money(c.image)}`,
                    ...(c.failed ? [`${w().costFailed} ${money(c.failed)}`] : []),
                  ]
                : [w().unpriced]
            }
          />
          <Stat
            label={w().duration}
            value={seconds(trace.durationMs)}
            parts={[w().turnsCount(trace.counts.turn), w().toolsCount(trace.counts.tool)]}
          />
          <Stat
            label={w().inputTokens}
            value={thousands(tk.input)}
            parts={[
              `${w().cached} ${thousands(tk.cached)}`,
              tk.input ? `${w().hit} ${Math.round((tk.cached / tk.input) * 100)}%` : "",
            ]}
          />
          <Stat
            label={w().outputTokens}
            value={thousands(tk.output)}
            parts={[`${w().reasoning} ${thousands(tk.reasoning)}`]}
          />
          {!!trace.counts.errors && (
            <Stat
              label={w().error}
              value={<span className={cx("stat-bad")}>{trace.counts.errors}</span>}
            />
          )}
        </dl>
      </header>
      {!!trace.meters?.length && <Meters meters={trace.meters} />}
      <section className={cx("trace-card")}>
        <header>
          <h3>{w().timeline}</h3>
          <nav className={cx("trace-filter")}>
            {(Object.keys(w().kinds) as Span["kind"][])
              .filter((k) => trace.counts[k])
              .map((k) => (
                <button
                  key={k}
                  data-kind={k}
                  aria-pressed={kinds.has(k)}
                  onClick={() => {
                    const next = new Set(kinds);
                    if (next.has(k)) next.delete(k);
                    else next.add(k);
                    setKinds(next);
                  }}
                >
                  {w().kinds[k]}
                  <small>{trace.counts[k]}</small>
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
                  <span className={cx("span-name")} style={{ paddingLeft: depth * 16 }}>
                    <i className={cx("span-kind")}>{w().kinds[s.kind]}</i>
                    <b>{s.name}</b>
                    {metric(s) && <small>{metric(s)}</small>}
                    {s.error && <em>{s.error.slice(0, 80)}</em>}
                  </span>
                  <span className={cx("span-bar")}>
                    <i
                      style={{
                        left: `${((s.startedAt - t0) / (t1 - t0)) * 100}%`,
                        width: `max(3px, ${((end - s.startedAt) / (t1 - t0)) * 100}%)`,
                      }}
                    />
                  </span>
                  <small>{s.endedAt ? seconds(end - s.startedAt) : "…"}</small>
                </button>
                {open === s.id && <Opened traceId={trace.id} brief={s} />}
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}
/** What each kind of work in the run used: calls, time, tokens and failures, one row per
 * tool, model or picture model, whatever tools the run had. */
function Meters({ meters }: { meters: Meter[] }) {
  const rows = [...meters].sort((a, b) => order(a) - order(b) || b.calls - a.calls);
  return (
    <section className={cx("trace-card")}>
      <header>
        <h3>{w().meterTitle}</h3>
      </header>
      <table className={cx("meters")}>
        <thead>
          <tr>
            <th>{w().meterName}</th>
            <th>{w().meterCalls}</th>
            <th>{w().meterTime}</th>
            <th>{w().input}</th>
            <th>{w().output}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.key} data-kind={m.kind}>
              <td>
                <i className={cx("span-kind")}>{w().kinds[m.kind]}</i>
                {meterName(m.key)}
              </td>
              <td>
                {m.calls}
                {!!m.errors && <em> {w().errorCount(m.errors)}</em>}
              </td>
              <td>{seconds(m.ms)}</td>
              <td title={m.cached ? `${w().cached} ${m.cached.toLocaleString()}` : undefined}>
                {m.input ? thousands(m.input) : "—"}
                {!!m.cached && (
                  <small>
                    {" "}
                    {w().cached} {thousands(m.cached)}
                  </small>
                )}
              </td>
              <td>{m.output ? thousands(m.output) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
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
    return w().metric(k(u.input), u.hit, k(u.output));
  }
  if (s.kind === "generation")
    return [a.size, a.usage && w().tokensShort(k(a.usage.input_tokens ?? 0), k(a.usage.output_tokens ?? 0))]
      .filter(Boolean)
      .join(" · ");
  // A tool call shows what it was asked: a query, a URL, a subject.
  if (s.kind === "tool") return a.asked ?? "";
  if (s.kind === "search")
    return (a.subjects as string[] | undefined)?.join(", ");
  if (s.kind === "capture") return w().shots(a.shots ?? 0);
  if (s.kind === "note" && a.status) return `HTTP ${a.status} · ${a.ms}ms`;
  return "";
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
      {done ? w().copied : w().copy}
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
function Text({ text, citations }: { text: string; citations?: Citation[] }) {
  const [all, setAll] = useState(false);
  const long = text.length > 1600;
  return (
    <div className={cx("text")}>
      <pre><CitedText text={long && !all ? text.slice(0, 1200) + "…" : text} citations={citations} /></pre>
      {long && (
        <button onClick={() => setAll(!all)}>
          {all ? w().fold : w().unfold(text.length.toLocaleString())}
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
  if (typeof part.text === "string") return <Text text={part.text} citations={citationsOf([{ type: "message", content: [part] }])} />;
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
              <b>{w().call(item.name)}</b>
              <Text text={pretty(item.arguments)} />
            </li>
          );
        if (item.type === "function_call_output")
          return (
            <li key={i} data-role="result">
              <b>{w().toolResult}</b>
              <Text text={pretty(item.output)} />
            </li>
          );
        // A call the provider ran itself, such as its web search: what it did, as recorded.
        if (typeof item.type === "string" && item.type.endsWith("_call"))
          return (
            <li key={i} data-role="call">
              <b>{w().call(item.type.replace(/_call$/, ""))}</b>
              <Text text={pretty(item.action ?? item)} />
            </li>
          );
        if (item.type === "configuration_update")
          return (
            <li key={i} data-role="reasoning">
              <b>{w().thinkingEffort}</b>
              <Text text={item.reasoning?.effort ?? pretty(item)} />
            </li>
          );
        if (item.type === "reasoning")
          return (
            <li key={i} data-role="reasoning">
              <b>{w().thoughts}</b>
              <Text
                text={
                  (item.summary || []).map((s: Item) => s.text).join("\n\n") ||
                  w().nothing
                }
              />
            </li>
          );
        const role = item.role || item.type;
        const parts: (Item | string)[] =
          typeof item.content === "string" ? [item.content] : item.content || [];
        return (
          <li key={i} data-role={role}>
            <b>{w().roles[role as string] || role}</b>
            {parts.map((p, j) => (
              <Content key={j} part={p} />
            ))}
          </li>
        );
      })}
    </ol>
  );
}
type Whole = { span: Span; context?: { items: Item[]; complete: boolean } };
/** A span opened in the timeline: the timeline has only its brief, so the whole record
 * is fetched when it is opened, and again while it is still running when it changes. */
function Opened({ traceId, brief }: { traceId: string; brief: Span }) {
  const [whole, setWhole] = useState<Whole>();
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    api<Whole>(`/traces/${traceId}/spans/${brief.id}`)
      .then((d) => current && setWhole(d))
      .catch((e) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [traceId, brief.id, brief.status, brief.endedAt]);
  if (error) return <p className={cx("error")}>{error}</p>;
  if (!whole) return <Spinner />;
  return <Attributes key={whole.span.id} span={whole.span} context={whole.context} />;
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
  if (span.error) parts.push(<Part key="error" title={w().error} value={span.error} />);
  switch (span.kind) {
    case "turn": {
      const u = usageOf(a);
      parts.push(
        <Part key="usage" title={w().usage}>
          <dl className={cx("facts")}>
            <dt>{w().input}</dt>
            <dd>{u.input.toLocaleString()} tokens</dd>
            <dt>{w().hit}</dt>
            <dd>
              {u.cached.toLocaleString()} ({u.hit}%) · {w().missed}{" "}
              {(u.input - u.cached).toLocaleString()}
            </dd>
            <dt>{w().output}</dt>
            <dd>
              {u.output.toLocaleString()} · {w().ofWhichReasoning} {u.reasoning.toLocaleString()}
            </dd>
            <dt>{w().firstOutput}</dt>
            <dd>{a.firstOutputMs !== undefined ? seconds(a.firstOutputMs) : "—"}</dd>
            <dt>{w().total}</dt>
            <dd>{span.endedAt ? seconds(span.endedAt - span.startedAt) : w().inProgress}</dd>
            <dt>{w().context}</dt>
            <dd>
              {w().items(a.inputItems, k(a.estimatedTokens))}
            </dd>
            {a.request && (
              <>
                <dt>{w().request}</dt>
                <dd>
                  {a.request.model} · {w().thinkingEffort} {a.request.effort} ·{" "}
                  {a.request.serviceTier} · {w().instructionsChars(k(a.request.instructionsChars))} ·{" "}
                  {w().toolCount(a.request.tools)}
                  {a.request.steer?.max_tool_calls !== undefined &&
                    ` · ${w().searchLeft(a.request.steer.max_tool_calls)}`}
                  {a.request.steer?.tool_choice && ` · ${w().searchClosed}`}
                </dd>
              </>
            )}
            {a.response?.id && (
              <>
                <dt>{w().response}</dt>
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
              ? w().inputWhole(whole.length)
              : w().inputAdded((a.input || []).length)
          }
          value={view === "whole" && whole ? whole : a.input}
        >
          <nav className={cx("views")}>
            {whole && (
              <button aria-pressed={view === "whole"} onClick={() => setView("whole")}>
                {w().whole}
              </button>
            )}
            <button aria-pressed={view === "added"} onClick={() => setView("added")}>
              {w().added}
            </button>
            <button aria-pressed={view === "raw"} onClick={() => setView("raw")}>
              {w().raw}
            </button>
          </nav>
          {view === "whole" && whole && !context.complete && (
            <p className={cx("hint")}>
              {w().noContext}
            </p>
          )}
          {view === "raw" ? (
            <pre>{pretty(a.input)}</pre>
          ) : (
            <Conversation items={view === "whole" && whole ? whole : a.input || []} />
          )}
        </Part>,
        <Part key="output" title={w().outputItems((a.output || []).length)} value={a.output}>
          <Conversation items={a.output || []} />
        </Part>,
      );
      break;
    }
    case "tool":
      parts.push(
        <Part key="args" title={w().args} value={a.args} />,
        <Part key="out" title={w().result} value={a.output} />,
      );
      if (Array.isArray(a.images) && a.images.length)
        parts.push(
          <Part key="images" title={w().images2(a.images.length)}>
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
        <Part key="result" title={w().result}>
          <dl className={cx("facts")}>
            <dt>{w().size}</dt>
            <dd>{a.size}</dd>
            <dt>{w().model}</dt>
            <dd>{a.model}</dd>
            {a.bytes && (
              <>
                <dt>{w().bytes}</dt>
                <dd>{k(a.bytes)}B</dd>
              </>
            )}
            {!!a.references?.length && (
              <>
                <dt>{w().references}</dt>
                <dd>{a.references.join(", ")}</dd>
              </>
            )}
            {!!a.styleReferences?.length && (
              <>
                <dt>{w().styleReferences}</dt>
                <dd>{a.styleReferences.join(", ")}</dd>
              </>
            )}
          </dl>
          <div className={cx("shots")}>
            {(a.referenceImages || []).map((url: string, i: number) => {
              const given = a.references?.length ?? 0;
              const label =
                i < given
                  ? w().reference(a.references[i])
                  : w().styleReference(a.styleReferences?.[i - given] ?? "");
              return <Shot key={i} url={url} label={label} />;
            })}
            {a.url && <Shot url={a.url} label={w().generated} />}
          </div>
        </Part>,
        <Part key="prompt" title={w().prompt} value={a.prompt}>
          <Text text={a.prompt || ""} />
        </Part>,
      );
      break;
    case "search":
      parts.push(
        <Part key="request" title={w().request} value={{ subjects: a.subjects, style: a.style, kinds: a.kinds, roles: a.roles, limit: a.limit }} />,
        <Part key="results" title={w().result} value={a.results}>
          {(a.results || []).map((r: Item) => (
            <section key={r.subject} className={cx("hits")}>
              <h5>{r.subject}</h5>
              {!r.hits.length && <p className={cx("hint")}>{w().noHits}</p>}
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
        <Part key="request" title={w().request} value={{ revision: a.revision, sceneId: a.sceneId, regions: a.regions, claims: a.claims, annotate: a.annotate, actions: a.actions }} />,
        ...(a.shots || []).map((shot: Item, i: number) => (
          <Part key={"shot" + i} title={shot.view} value={shot}>
            {shot.url ? (
              <div className={cx("shots")}>
                <Shot url={shot.url} />
              </div>
            ) : (
              shot.opened && <Text text={w().openedDetail(shot.opened.detail, shot.opened.byTarget)} />
            )}
            {!!shot.errors?.length && <Text text={shot.errors.join("\n")} />}
            {shot.modules && (
              <Part title={w().geometry(shot.modules.length)} value={shot.modules} open={false} />
            )}
          </Part>
        )),
      );
      break;
    case "compact":
      parts.push(
        <Part key="summary" title={w().summary} value={a.summary}>
          <Text text={a.summary || ""} />
        </Part>,
        <Part key="usage" title={w().usageOnly} value={{ size: a.size, usage: a.usage, response: a.response }} />,
      );
      break;
    case "execution": {
      const { instructions, context: start, tools, ...rest } = a;
      parts.push(<Part key="settings" title={w().settings} value={rest} />);
      if (tools)
        parts.push(
          <Part key="tools" title={w().toolList(tools.length)} value={tools}>
            <p className={cx("hint")}>{tools.join(", ")}</p>
          </Part>,
        );
      if (instructions)
        parts.push(
          <Part key="instructions" title={w().instructions(instructions.length.toLocaleString())} value={instructions} open={false}>
            <Text text={instructions} />
          </Part>,
        );
      if (start)
        parts.push(
          <Part key="context" title={w().start(start.length)} value={start} open={false}>
            <Conversation items={start} />
          </Part>,
        );
      break;
    }
    default:
      parts.push(<Part key="attrs" title={w().attrs} value={a} />);
  }
  return (
    <div className={cx("span-detail")}>
      {parts}
      <Part title={w().record} value={span} open={false} />
    </div>
  );
}

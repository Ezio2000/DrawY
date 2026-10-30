import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** One timed piece of a run: a model turn, a tool call, a search, a generation, a capture. */
export interface Span {
  id: string;
  traceId: string;
  parentId: string | null;
  kind:
    | "execution"
    | "turn"
    | "tool"
    | "search"
    | "generation"
    | "capture"
    | "compact"
    | "note";
  name: string;
  startedAt: number;
  endedAt?: number;
  status: "running" | "ok" | "error";
  error?: string;
  attrs: Record<string, unknown>;
}
/** A run as the trace sees it. */
export interface Trace {
  id: string;
  userId: string;
  workId: string;
  title: string;
  prompt: string;
  status: string;
  startedAt: number;
  updatedAt: number;
}
export interface TraceSummary extends Trace {
  durationMs: number;
  tokens: { input: number; output: number; reasoning: number; cached: number };
  counts: Record<Span["kind"] | "errors", number>;
}
interface Scope {
  traceId: string;
  spanId: string | null;
}
const scope = new AsyncLocalStorage<Scope>();
const id = () => crypto.randomUUID();

/** Images inside traced values become a short note; everything else is kept. */
export function sanitize(value: unknown): unknown {
  if (typeof value === "string")
    return value.startsWith("data:image/")
      ? `[${value.slice(5, value.indexOf(";"))} ${Math.round((value.length * 3) / 4 / 1024)}KB]`
      : value;
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sanitize(v)]),
    );
  return value;
}

/** A span being recorded; attributes added before it ends are kept with it. */
export class ActiveSpan {
  constructor(
    private tracer: Tracer,
    readonly span: Span,
  ) {}
  set(attrs: Record<string, unknown>) {
    Object.assign(this.span.attrs, sanitize(attrs));
    this.tracer.persist(this.span);
  }
}
const idle = new ActiveSpan(
  {
    persist() {},
  } as unknown as Tracer,
  {
    id: "",
    traceId: "",
    parentId: null,
    kind: "note",
    name: "",
    startedAt: 0,
    status: "ok",
    attrs: {},
  },
);

/** Records what happens in each run, in its own database, for looking into later. Spans
 * nest by async context, so any module can record without being handed a trace. */
export class Tracer {
  private db?: DatabaseSync;
  open(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(join(dir, "trace.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS traces(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,data TEXT NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS spans(id TEXT PRIMARY KEY,trace_id TEXT NOT NULL,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS spans_trace ON spans(trace_id);
 CREATE INDEX IF NOT EXISTS traces_user ON traces(user_id,updated_at);`);
    return this;
  }
  close() {
    this.db?.close();
    this.db = undefined;
  }
  /** Creates or updates the record of a run. */
  begin(t: Omit<Trace, "updatedAt" | "startedAt"> & { startedAt?: number }) {
    if (!this.db) return;
    const old = this.db
      .prepare("SELECT data FROM traces WHERE id=?")
      .get(t.id) as { data: string } | undefined;
    const trace: Trace = {
      ...(old
        ? JSON.parse(old.data)
        : { startedAt: t.startedAt ?? Date.now() }),
      ...t,
      updatedAt: Date.now(),
    };
    this.db
      .prepare(
        "INSERT INTO traces VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
      )
      .run(trace.id, trace.userId, JSON.stringify(trace), trace.updatedAt);
  }
  status(traceId: string, status: string) {
    if (!this.db) return;
    const row = this.db
      .prepare("SELECT data FROM traces WHERE id=?")
      .get(traceId) as { data: string } | undefined;
    if (!row) return;
    const trace = { ...JSON.parse(row.data), status, updatedAt: Date.now() };
    this.db
      .prepare("UPDATE traces SET data=?,updated_at=? WHERE id=?")
      .run(JSON.stringify(trace), trace.updatedAt, traceId);
  }
  persist(span: Span) {
    this.db
      ?.prepare(
        "INSERT INTO spans VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(span.id, span.traceId, JSON.stringify(span));
  }
  /** Runs `fn` as the root of one execution of a trace. */
  within<T>(traceId: string, fn: () => Promise<T>): Promise<T> {
    return scope.run({ traceId, spanId: null }, fn);
  }
  /** Records `fn` as a span under the current one. Outside a trace it just runs `fn`. */
  async span<T>(
    kind: Span["kind"],
    name: string,
    attrs: Record<string, unknown>,
    fn: (span: ActiveSpan) => Promise<T>,
  ): Promise<T> {
    const parent = scope.getStore();
    if (!this.db || !parent) return fn(idle);
    const span: Span = {
      id: id(),
      traceId: parent.traceId,
      parentId: parent.spanId,
      kind,
      name,
      startedAt: Date.now(),
      status: "running",
      attrs: sanitize(attrs) as Record<string, unknown>,
    };
    const active = new ActiveSpan(this, span);
    this.persist(span);
    try {
      const result = await scope.run(
        { traceId: span.traceId, spanId: span.id },
        () => fn(active),
      );
      span.status = "ok";
      return result;
    } catch (e) {
      span.status = "error";
      span.error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      span.endedAt = Date.now();
      this.persist(span);
    }
  }
  /** Records something that happened at one moment. */
  note(name: string, attrs: Record<string, unknown>, error?: string) {
    const parent = scope.getStore();
    if (!this.db || !parent) return;
    const now = Date.now();
    this.persist({
      id: id(),
      traceId: parent.traceId,
      parentId: parent.spanId,
      kind: "note",
      name,
      startedAt: now,
      endedAt: now,
      status: error ? "error" : "ok",
      ...(error ? { error } : {}),
      attrs: sanitize(attrs) as Record<string, unknown>,
    });
  }
  spans(traceId: string): Span[] {
    return (
      this.db
        ?.prepare("SELECT data FROM spans WHERE trace_id=?")
        .all(traceId) ?? []
    )
      .map((r) => JSON.parse(r.data as string) as Span)
      .sort((a, b) => a.startedAt - b.startedAt);
  }
  private summarize(trace: Trace, spans: Span[]): TraceSummary {
    const tokens = { input: 0, output: 0, reasoning: 0, cached: 0 };
    const counts = {
      execution: 0,
      turn: 0,
      tool: 0,
      search: 0,
      generation: 0,
      capture: 0,
      compact: 0,
      note: 0,
      errors: 0,
    };
    for (const s of spans) {
      counts[s.kind]++;
      if (s.status === "error") counts.errors++;
      const u = s.attrs.usage as Record<string, any> | undefined;
      if (s.kind === "turn" && u) {
        tokens.input += u.input_tokens ?? 0;
        tokens.output += u.output_tokens ?? 0;
        tokens.reasoning += u.output_tokens_details?.reasoning_tokens ?? 0;
        tokens.cached += u.input_tokens_details?.cached_tokens ?? 0;
      }
    }
    const executions = spans.filter((s) => s.kind === "execution");
    const durationMs = executions.reduce(
      (n, s) => n + ((s.endedAt ?? Date.now()) - s.startedAt),
      0,
    );
    return { ...trace, durationMs, tokens, counts };
  }
  list(userId: string, limit = 60): TraceSummary[] {
    return (
      this.db
        ?.prepare(
          "SELECT data FROM traces WHERE user_id=? ORDER BY updated_at DESC LIMIT ?",
        )
        .all(userId, limit) ?? []
    ).map((r) => {
      const trace = JSON.parse(r.data as string) as Trace;
      return this.summarize(trace, this.spans(trace.id));
    });
  }
  get(userId: string, traceId: string) {
    const row = this.db
      ?.prepare("SELECT data FROM traces WHERE id=? AND user_id=?")
      .get(traceId, userId) as { data: string } | undefined;
    if (!row) return undefined;
    const spans = this.spans(traceId);
    return { trace: this.summarize(JSON.parse(row.data), spans), spans };
  }
}
/** The process's tracer; it records once opened. */
export const tracer = new Tracer();

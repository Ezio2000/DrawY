import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

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
/** What one kind of work in a run used: how often it ran, how long it took and the tokens
 * it spent. Spans are metered by `attrs.meter` when they name one, otherwise a tool call
 * by its tool's name and anything else by its kind, so a new tool shows up on its own. */
export interface Meter {
  key: string;
  kind: Span["kind"];
  calls: number;
  errors: number;
  ms: number;
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
}
export interface TraceSummary extends Trace {
  durationMs: number;
  tokens: { input: number; output: number; reasoning: number; cached: number; cacheWrite: number };
  counts: Record<Span["kind"] | "errors", number>;
  meters: Meter[];
}
/** The meter a span counts towards; executions and notes are not work of their own. */
export const meterOf = (s: Span) =>
  s.kind === "execution" || s.kind === "note"
    ? undefined
    : typeof s.attrs.meter === "string"
      ? s.attrs.meter
      : s.kind === "tool"
        ? s.name
        : s.kind === "turn"
          ? "model"
          : s.kind;
/** Token counts in the shape every OpenAI endpoint reports them. */
export function tokensOf(usage: unknown) {
  const u = (usage || {}) as Record<string, any>;
  return {
    input: u.input_tokens ?? 0,
    cached: u.input_tokens_details?.cached_tokens ?? 0,
    cacheWrite: u.input_tokens_details?.cache_write_tokens ?? 0,
    output: u.output_tokens ?? 0,
    reasoning: u.output_tokens_details?.reasoning_tokens ?? 0,
  };
}
interface Scope {
  traceId: string;
  spanId: string | null;
}
const scope = new AsyncLocalStorage<Scope>();
const id = () => crypto.randomUUID();

/** A traced value with every embedded image handed to `keep`, which returns what stands
 * in its place; everything else is kept as it is. */
export function sanitize(
  value: unknown,
  keep: (dataUrl: string) => string = (v) =>
    `[${v.slice(5, v.indexOf(";"))} ${Math.round((v.length * 3) / 4 / 1024)}KB]`,
): unknown {
  if (typeof value === "string")
    return value.startsWith("data:image/") ? keep(value) : value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, keep));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sanitize(v, keep)]),
    );
  return value;
}
const FILE = /^[0-9a-f]{24}\.(png|jpeg|webp|gif)$/;

/** A span being recorded; attributes added before it ends are kept with it. */
export class ActiveSpan {
  constructor(
    private tracer: Tracer,
    readonly span: Span,
  ) {}
  set(attrs: Record<string, unknown>) {
    Object.assign(this.span.attrs, this.tracer.clean(attrs));
    this.tracer.persist(this.span);
  }
}
const idle = new ActiveSpan(
  {
    persist() {},
    clean: (attrs: Record<string, unknown>) => attrs,
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
  private files = "";
  open(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.files = join(dir, "trace-files");
    mkdirSync(this.files, { recursive: true });
    this.db = new DatabaseSync(join(dir, "trace.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS traces(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,data TEXT NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS spans(id TEXT PRIMARY KEY,trace_id TEXT NOT NULL,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS spans_trace ON spans(trace_id);
 CREATE INDEX IF NOT EXISTS traces_user ON traces(user_id,updated_at);`);
    // Each span also keeps its brief, so lists and timelines never read whole
    // conversations; spans recorded before it existed get theirs when first read.
    const columns = this.db.prepare("PRAGMA table_info(spans)").all() as { name: string }[];
    if (!columns.some((c) => c.name === "brief"))
      this.db.exec("ALTER TABLE spans ADD COLUMN brief TEXT");
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
  /** Attributes as stored: each image is kept once, by its content, and referred to by
   * the address it is served at. */
  clean(attrs: Record<string, unknown>) {
    return sanitize(attrs, (url) => {
      const comma = url.indexOf(","),
        type = url.slice(11, url.indexOf(";")),
        bytes = Buffer.from(url.slice(comma + 1), "base64"),
        name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}.${type}`;
      if (!FILE.test(name)) return `[${type} ${Math.round(bytes.length / 1024)}KB]`;
      const path = join(this.files, name);
      if (!existsSync(path)) writeFileSync(path, bytes);
      return `/api/traces/files/${name}`;
    }) as Record<string, unknown>;
  }
  /** An image a span refers to. */
  file(name: string) {
    if (!FILE.test(name)) return undefined;
    const path = join(this.files, name);
    return existsSync(path)
      ? { bytes: readFileSync(path), type: "image/" + name.split(".")[1] }
      : undefined;
  }
  persist(span: Span) {
    this.db
      ?.prepare(
        "INSERT INTO spans(id,trace_id,data,brief) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,brief=excluded.brief",
      )
      .run(span.id, span.traceId, JSON.stringify(span), JSON.stringify(brief(span)));
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
      attrs: this.clean(attrs),
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
  /** Records a span that already happened, or is happening elsewhere, under the current
   * one: work the model provider did itself, timed by when its output arrived. */
  record(
    kind: Span["kind"],
    name: string,
    attrs: Record<string, unknown>,
    time: { startedAt: number; endedAt?: number; error?: string },
  ) {
    const parent = scope.getStore();
    if (!this.db || !parent) return;
    this.persist({
      id: id(),
      traceId: parent.traceId,
      parentId: parent.spanId,
      kind,
      name,
      startedAt: time.startedAt,
      endedAt: time.endedAt ?? Date.now(),
      status: time.error ? "error" : "ok",
      ...(time.error ? { error: time.error } : {}),
      attrs: this.clean(attrs),
    });
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
      attrs: this.clean(attrs),
    });
  }
  /** Every span of a trace as its brief, in time order. */
  spans(traceId: string): Span[] {
    const db = this.db;
    if (!db) return [];
    const rows = db
      .prepare(
        "SELECT id,brief,CASE WHEN brief IS NULL THEN data END AS data FROM spans WHERE trace_id=?",
      )
      .all(traceId) as { id: string; brief: string | null; data: string | null }[];
    const update = db.prepare("UPDATE spans SET brief=? WHERE id=?");
    return rows
      .map((r) => {
        if (r.brief) return JSON.parse(r.brief) as Span;
        const short = brief(JSON.parse(r.data!) as Span);
        update.run(JSON.stringify(short), r.id);
        return short;
      })
      .sort((a, b) => a.startedAt - b.startedAt);
  }
  /** Whole spans, as recorded. */
  private full(ids: string[]): Span[] {
    if (!this.db || !ids.length) return [];
    return (
      this.db
        .prepare(`SELECT data FROM spans WHERE id IN (${ids.map(() => "?").join(",")})`)
        .all(...ids) as { data: string }[]
    ).map((r) => JSON.parse(r.data) as Span);
  }
  private summarize(trace: Trace, spans: Span[]): TraceSummary {
    const tokens = { input: 0, output: 0, reasoning: 0, cached: 0, cacheWrite: 0 };
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
    const meters = new Map<string, Meter>();
    for (const s of spans) {
      counts[s.kind]++;
      if (s.status === "error") counts.errors++;
      const used = tokensOf(s.attrs.usage);
      if (s.kind === "turn")
        for (const k of ["input", "output", "reasoning", "cached", "cacheWrite"] as const)
          tokens[k] += used[k];
      const key = meterOf(s);
      if (!key) continue;
      const m = meters.get(key) ?? {
        key,
        kind: s.kind,
        calls: 0,
        errors: 0,
        ms: 0,
        input: 0,
        cached: 0,
        cacheWrite: 0,
        output: 0,
        reasoning: 0,
      };
      m.calls++;
      if (s.status === "error") m.errors++;
      m.ms += (s.endedAt ?? Date.now()) - s.startedAt;
      for (const k of ["input", "output", "reasoning", "cached", "cacheWrite"] as const)
        m[k] += used[k];
      meters.set(key, m);
    }
    const executions = spans.filter((s) => s.kind === "execution");
    const durationMs = executions.reduce(
      (n, s) => n + ((s.endedAt ?? Date.now()) - s.startedAt),
      0,
    );
    return { ...trace, durationMs, tokens, counts, meters: [...meters.values()] };
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
  /** One span of a user's trace in full and, for a model turn, the whole input it was
   * sent: where its execution started, then every earlier turn's additions and outputs in
   * order; a compaction starts it afresh. */
  whole(userId: string, traceId: string, spanId: string) {
    if (!this.db?.prepare("SELECT 1 FROM traces WHERE id=? AND user_id=?").get(traceId, userId))
      return undefined;
    const [span] = this.full([spanId]).filter((s) => s.traceId === traceId);
    if (!span) return undefined;
    if (span.kind !== "turn" || !span.parentId || span.attrs.failed) return { span };
    const earlier = this.spans(traceId).filter(
      (s) =>
        s.parentId === span.parentId &&
        (s.kind === "turn" || s.kind === "compact") &&
        s.startedAt <= span.startedAt &&
        s.id !== span.id,
    );
    const whole = new Map(
      this.full([span.parentId, ...earlier.map((s) => s.id)]).map((s) => [s.id, s]),
    );
    const execution = whole.get(span.parentId);
    const base = execution?.attrs.context as unknown[] | undefined;
    let items: unknown[] = base ?? [],
      complete = !!base,
      pending: unknown[] = [];
    for (const s of [...earlier.map((e) => whole.get(e.id)!), span]) {
      const a = s.attrs as { input?: unknown[]; output?: unknown[]; replaced?: unknown };
      if (s.kind === "compact") {
        if (a.replaced) {
          items = [];
          pending = [];
          complete = true;
        }
        continue;
      }
      items = [...items, ...pending, ...(a.input || [])];
      pending = a.output || [];
    }
    return { span, context: { items, complete } };
  }
}
/** The words in a tool's arguments, however they are nested or encoded. */
function words(v: unknown, depth = 0): string[] {
  if (typeof v === "string") {
    if (!depth && /^[\[{]/.test(v.trim()))
      try {
        return words(JSON.parse(v), 1);
      } catch {}
    return v && v.length < 200 ? [v] : [];
  }
  if (depth > 3 || !v || typeof v !== "object") return [];
  return (
    Array.isArray(v)
      ? v
      : Object.entries(v)
          .filter(([k]) => k !== "type")
          .map(([, x]) => x)
  ).flatMap((x) => words(x, depth + 1));
}
/** What a span's row in a timeline needs and what summaries count: its timing, status and
 * meter, its usage, and a few words on what it did, without what went in and came out. */
export function brief(span: Span): Span {
  const a = span.attrs as Record<string, any>;
  const keep: Record<string, unknown> = {};
  for (const k of ["usage", "meter", "size", "hosted", "status", "ms"])
    if (a[k] !== undefined) keep[k] = a[k];
  if (Array.isArray(a.subjects)) keep.subjects = a.subjects.slice(0, 12);
  if (Array.isArray(a.shots)) keep.shots = a.shots.length;
  if (span.kind === "tool")
    keep.asked = [a.hosted && a.args?.type, ...words(a.args)]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 90);
  return {
    ...span,
    ...(span.error ? { error: span.error.slice(0, 300) } : {}),
    attrs: keep,
  };
}
/** The process's tracer; it records once opened. */
export const tracer = new Tracer();

import {
  id,
  DomainError,
  boundsSchema,
  type Run,
  type Step,
  type ToolActivity,
  type Work,
  type Picture,
  type Question,
} from "../contracts/index.ts";
import type { UserStore } from "../storage/index.ts";
import { writeWork, setBrief } from "../workspace/index.ts";
import {
  attached,
  candidate,
  find,
  kit,
  library,
  look,
  styleList,
  useOf,
  freshen,
} from "../materials/index.ts";
import { develop, type Development } from "../images/index.ts";
import { observe, requireObserved, Unavailable } from "../observation/index.ts";
import { AUTHOR, catalogue } from "./prompts.ts";
import { generate, textOf, type Item } from "../models/index.ts";
import { tools, askSchema, findSchema, generateSchema } from "./tools.ts";
import { partialJson } from "./partial.ts";
import { tracer } from "../trace/index.ts";
type ToolStep = Extract<Step, { kind: "tool" }>;
const pictures = (shots: { name: string; url: string }[]) =>
  shots.map(({ name, url }) => ({ name, url }));
/** Tools that run alone and are not shown as steps of their own. */
const silent = new Set(["ask_user", "finish"]);
function activity(name: string, args: any): ToolActivity {
  switch (name) {
    case "read_work":
      return { name };
    case "set_brief":
      return {
        name,
        subject: args.subject ?? "",
        ...(args.register ? { register: args.register } : {}),
        ...(args.style ? { style: args.style } : {}),
      };
    case "find_materials":
      return {
        name,
        subjects: (args.subjects || []).filter(
          (s: unknown) => typeof s === "string",
        ),
      };
    case "generate_images":
      return {
        name,
        images: (args.images || [])
          .filter((i: any) => i?.name?.zh)
          .map((i: any) => ({ name: i.name.zh, url: "" })),
      };
    case "write_work":
      return {
        name,
        drawings: (args.drawings || [])
          .filter((d: any) => d?.id && typeof d.source === "string")
          .map((d: any) => d.id),
        writing: (args.drawings || []).findLast(
          (d: any) => d?.id && typeof d.source !== "string",
        )?.id,
        scenes: (args.scenes || [])
          .filter((s: any) => s?.id)
          .map((s: any) => ({
            id: s.id,
            title: s.title ?? "",
            modules: (s.modules || []).flatMap((m: any) =>
              m?.id && boundsSchema.safeParse(m.bounds).success
                ? [
                    {
                      id: m.id,
                      label: m.label ?? "",
                      bounds: m.bounds,
                      ...(m.drawingId ? { drawingId: m.drawingId } : {}),
                    },
                  ]
                : [],
            ),
          })),
        details: (args.details || []).map((d: any) => d.title),
        materials: [],
        removed: Object.values(args.remove || {}).flat().length,
      };
    case "view_canvas":
      return {
        name,
        sceneId: args.sceneId,
        region: boundsSchema.safeParse(args.region).data,
        focus: args.actions?.length
          ? "actions"
          : args.region
            ? "region"
            : args.annotate
              ? "annotate"
              : "overview",
      };
    default:
      throw Error("Unknown tool " + name);
  }
}
/** The work as the author reads it: library code and effect definitions are named, not
 * repeated. */
function forAuthor(work: Work) {
  return {
    ...work,
    materials: Object.fromEntries(
      Object.values(work.materials).map((m) => [
        m.id,
        m.kind === "picture"
          ? {
              kind: m.kind,
              name: m.name,
              role: m.role,
              style: m.style,
              size: `${m.width}×${m.height}`,
              anchors: Object.keys(m.anchors),
              ...(m.recolor ? { recolor: true } : {}),
            }
          : { kind: m.kind, name: m.name },
      ]),
    ),
  };
}
interface Context {
  input: Item[];
  generations: number;
}
async function userMessage(
  store: UserStore,
  text: string,
  materials: string[],
): Promise<Item> {
  return {
    role: "user",
    content: [
      { type: "input_text", text },
      ...(await attached(materials, store.userId)),
    ],
  };
}
const workMessage = (sceneId: string, work: Work): Item => ({
  role: "user",
  content: `Current scene: ${sceneId}\nCurrent work: ${JSON.stringify(forAuthor(work))}`,
});

// Estimate conservatively without counting base64 bytes as text tokens.
function contextSize(input: Item[]): number {
  return Math.ceil(
    JSON.stringify(input, (key, value) =>
      key === "image_url" ? " ".repeat(6400) : value,
    ).length / 3,
  );
}
async function compact(
  store: UserStore,
  run: Run,
  ctx: Context,
  signal: AbortSignal,
) {
  const size = contextSize(ctx.input);
  if (size < 128000) return;
  await tracer.span("compact", "context", { size }, async (span) => {
    const result = await generate(
      store.settings().author,
      "Summarize this drawing conversation for continuation. Preserve user requirements, the brief and its basis, reference-image intent, chosen and generated material ids, decisions, unfinished work and tool failures. Do not execute the task. The latest saved work and original reference images will be supplied separately.",
      ctx.input,
      [],
      signal,
      undefined,
      4096,
    );
    const references = [
      ...new Set(
        store
          .runs(run.workId)
          .flatMap((r) =>
            r.steps.flatMap((s) =>
              s.kind === "message" && s.role === "user"
                ? s.materials || []
                : [],
            ),
          ),
      ),
    ];
    ctx.input = [
      await userMessage(
        store,
        "Conversation summary:\n" + textOf(result.items),
        references,
      ),
      workMessage(run.sceneId, store.work(run.workId)),
    ];
    store.context(run.id, ctx);
    // The next turn starts from this summary alone.
    span.set({
      summary: textOf(result.items),
      usage: result.usage,
      response: result.response,
      replaced: true,
    });
  });
}
/** A model request that failed on the way rather than on its content. */
const transient = (e: unknown) =>
  e instanceof TypeError ||
  (e instanceof Error &&
    /^模型请求 (429|5\d\d)|模型连接在完成前中断|terminated|ECONNRESET|socket/.test(
      e.message,
    ));
/** Everything the user has said about this work, for checking a brief's quotes. */
function said(store: UserStore, workId: string) {
  return [
    store.settings().preferences,
    ...store
      .runs(workId)
      .flatMap((r) =>
        r.steps.flatMap((s) =>
          s.kind === "message" && s.role === "user" ? [s.text] : [],
        ),
      ),
  ];
}
/** Option pictures for a question: pictures as themselves, styles by their samples. */
async function questions(
  store: UserStore,
  input: unknown,
): Promise<Question[]> {
  const { questions } = askSchema.parse(input);
  const ids = [
    ...new Set(
      questions.flatMap((q) => q.options.flatMap((o) => o.materials || [])),
    ),
  ];
  // A picture shows itself; a style shows a few of its samples.
  const found = new Map(
    (ids.length ? await library.get(ids, store.userId, true) : []).map((m) => [
      m.id,
      m.kind === "style"
        ? m.samples.slice(0, 3).map((s) => ({
            id: s,
            name: m.name.zh,
            url: `/materials/files/${s}`,
          }))
        : m.kind === "picture"
          ? [{ id: m.id, name: m.name.zh, url: m.file.url }]
          : [],
    ]),
  );
  return questions.map((q) => ({
    id: q.id,
    text: q.text,
    ...(q.multiple ? { multiple: true } : {}),
    options: q.options.map((o) => {
      const shown: Picture[] = (o.materials || []).flatMap(
        (id) => found.get(id) ?? [],
      );
      return {
        label: o.label,
        ...(o.detail ? { detail: o.detail } : {}),
        ...(shown.length ? { pictures: shown } : {}),
      };
    }),
  }));
}
export class Agent {
  active = new Map<string, AbortController>();
  /** Pictures each run has asked for, developing in the background. */
  developments = new Map<string, (Development & { reported?: boolean })[]>();
  constructor(public publish: (user: string, event: object) => void) {}
  emit(store: UserStore, run: Run) {
    store.saveRun(run);
    this.publish(store.userId, { type: "run", run });
  }
  async start(
    store: UserStore,
    workId: string,
    sceneId: string,
    prompt: string,
    materials: string[] = [],
  ) {
    const work = store.work(workId);
    if (
      store
        .runs(workId)
        .some((r) => ["running", "viewing", "waiting"].includes(r.status))
    )
      throw new DomainError("请先完成或取消当前任务", 409);
    if (!work.scenes[sceneId]) throw new DomainError("场景不存在", 404);
    const message = await userMessage(store, prompt, materials);
    const run: Run = {
      id: id(),
      workId,
      sceneId,
      status: "running",
      steps: [{ kind: "message", role: "user", text: prompt, materials }],
      observations: [],
      startedAt: Date.now(),
    };
    const previous = store.runs(workId).at(-1);
    const ctx: Context = {
      input: previous ? store.context(previous.id).input : [],
      generations: 0,
    };
    ctx.input.push(message, workMessage(sceneId, work));
    this.emit(store, run);
    store.context(run.id, ctx);
    tracer.begin({
      id: run.id,
      userId: store.userId,
      workId,
      title: work.title,
      prompt,
      status: run.status,
      startedAt: run.startedAt,
    });
    void this.execute(store, run, ctx, "request");
    return run;
  }
  async resume(
    store: UserStore,
    runId: string,
    answer: string,
    materials: string[] = [],
  ) {
    const run = store.run(runId);
    if (run.status !== "waiting") throw new DomainError("当前任务没有等待回答");
    const ctx = store.context(runId) as Context;
    ctx.input.push(await userMessage(store, answer, materials));
    run.steps.push({ kind: "message", role: "user", text: answer, materials });
    run.questions = undefined;
    run.status = "running";
    ctx.generations = 0;
    this.emit(store, run);
    store.context(run.id, ctx);
    tracer.status(run.id, run.status);
    void this.execute(store, run, ctx, "answer");
    return run;
  }
  cancel(store: UserStore, runId: string) {
    const run = store.run(runId);
    const active = this.active.get(runId);
    if (active) {
      active.abort();
      return run;
    }
    run.status = "cancelled";
    this.emit(store, run);
    tracer.status(run.id, run.status);
    return run;
  }
  /** Tells the author about pictures that finished developing since it last heard, and
   * shows it the ones that came out. */
  private async developed(store: UserStore, run: Run): Promise<Item[]> {
    const fresh = (this.developments.get(run.id) || []).filter(
      (d) => d.settled && !d.reported,
    );
    if (!fresh.length) return [];
    for (const d of fresh) d.reported = true;
    const ready = fresh.filter((d) => d.settled!.status === "ready");
    // The measured visible content, so modules can take the picture's real proportions.
    const sizes = new Map(
      (ready.length
        ? await library.get(
            ready.map((d) => d.id),
            store.userId,
            true,
          )
        : []
      ).flatMap((m) => {
        const use = useOf(m);
        return use?.kind === "picture"
          ? [[m.id, `${use.width}×${use.height}`] as const]
          : [];
      }),
    );
    const lines = fresh.map((d) =>
      d.settled!.status === "ready"
        ? `${d.id} (${d.name}) developed; visible content ${sizes.get(d.id) ?? "unknown"}.`
        : `${d.id} (${d.name}) failed: ${d.settled!.error}. Generate it again or draw another way.`,
    );
    return [
      {
        role: "user",
        content: [
          { type: "input_text", text: "Pictures:\n" + lines.join("\n") },
          ...(await look(
            ready.map((d) => d.id),
            store.userId,
            384,
          )),
        ],
      },
    ];
  }
  async execute(
    store: UserStore,
    run: Run,
    ctx: Context,
    trigger: "request" | "answer",
  ) {
    const abort = new AbortController();
    this.active.set(run.id, abort);
    const timeout = setTimeout(
      () => abort.abort(new Error("运行超过 15 分钟")),
      15 * 60 * 1000,
    );
    const start = Date.now();
    let flush: ReturnType<typeof setTimeout> | undefined;
    const settings = store.settings();
    await tracer.within(run.id, () =>
      tracer
        .span(
          "execution",
          trigger,
          {
            message: run.steps.findLast(
              (s): s is Extract<Step, { kind: "message" }> =>
                s.kind === "message" && s.role === "user",
            )?.text,
            model: settings.author.model,
            effort: settings.author.effort,
            fast: settings.author.fast,
            imageModel: settings.image.model,
          },
          async (execution) => {
            try {
              const instructions = [
                AUTHOR,
                catalogue(await styleList(), await kit()),
                "User preferences: " + (settings.preferences || "none"),
              ].join("\n\n");
              // Where this execution starts from; each turn records what it adds.
              execution.set({
                instructions,
                context: ctx.input,
                tools: tools.map((t) => t.name),
              });
              await this.loop(
                store,
                run,
                ctx,
                abort,
                instructions,
                start,
                (f) => {
                  flush = f;
                },
              );
            } catch (e) {
              console.error("DrawY run failed", run.id, e);
              run.status = abort.signal.aborted ? "cancelled" : "failed";
              run.error = String(abort.signal.reason || e);
              if (run.status === "failed") throw e;
            } finally {
              // A cancelled batch still needs a result for every emitted tool call.
              const answered = new Set(
                ctx.input
                  .filter((item) => item.type === "function_call_output")
                  .map((item) => item.call_id),
              );
              for (const item of ctx.input.filter(
                (item) => item.type === "function_call",
              ))
                if (!answered.has(item.call_id))
                  ctx.input.push({
                    type: "function_call_output",
                    call_id: item.call_id,
                    output:
                      "Execution interrupted. Read the current work before continuing.",
                  });
              store.context(run.id, ctx);
              clearTimeout(timeout);
              clearTimeout(flush);
              this.active.delete(run.id);
              run.elapsedMs = (run.elapsedMs || 0) + Date.now() - start;
              this.emit(store, run);
              execution.set({ status: run.status });
              tracer.status(run.id, run.status);
            }
          },
        )
        .catch(() => {}),
    );
  }
  private async loop(
    store: UserStore,
    run: Run,
    ctx: Context,
    abort: AbortController,
    instructions: string,
    start: number,
    flushing: (f: ReturnType<typeof setTimeout> | undefined) => void,
  ) {
    const settings = store.settings();
    // Tool arguments stream in; each flush shows what has been laid out so far.
    const drafts = new Map<
      string,
      { step: ToolStep; name: string; text: string }
    >();
    let flush: ReturnType<typeof setTimeout> | undefined;
    const emitSoon = () => {
      flush ??= setTimeout(() => {
        flush = undefined;
        flushing(undefined);
        for (const d of drafts.values())
          Object.assign(d.step, activity(d.name, partialJson(d.text) ?? {}));
        this.emit(store, run);
      }, 250);
      flushing(flush);
    };
    let seen = ctx.input.length;
    while (ctx.generations++ < 24) {
      let thinking: Extract<Step, { kind: "thinking" }> | undefined;
      // Progress the author writes takes its place among the steps as it streams.
      let said: Extract<Step, { kind: "message" }> | undefined;
      abort.signal.throwIfAborted();
      ctx.input.push(...(await this.developed(store, run)));
      await compact(store, run, ctx, abort.signal);
      if (seen > ctx.input.length) seen = 0;
      const turnStart = Date.now();
      let firstOutput: number | undefined;
      const result = await tracer.span(
        "turn",
        `turn ${ctx.generations}`,
        {
          input: ctx.input.slice(seen),
          inputItems: ctx.input.length,
          estimatedTokens: contextSize(ctx.input),
          request: {
            model: settings.author.model,
            effort: settings.author.effort,
            serviceTier: settings.author.fast ? "priority" : "default",
            instructionsChars: instructions.length,
            tools: tools.length,
          },
        },
        async (span) => {
          // A dropped stream, a rate limit or a server error is tried again from the
          // same input; what the broken attempt had shown is taken back first.
          const mark = run.steps.length;
          let result!: Awaited<ReturnType<typeof generate>>;
          for (const wait of [2000, 8000, 0]) {
            try {
              result = await generate(
                settings.author,
                instructions,
                ctx.input,
                tools,
                abort.signal,
                (event) => {
                  if (
                    firstOutput === undefined &&
                    event.type.endsWith(".delta")
                  )
                    firstOutput = Date.now() - turnStart;
                  if (
                    run.firstOutputMs === undefined &&
                    event.type.endsWith(".delta")
                  ) {
                    run.firstOutputMs = Date.now() - start;
                    this.emit(store, run);
                  }
                  switch (event.type) {
                    case "response.reasoning_summary_part.added":
                      thinking = { kind: "thinking", text: "" };
                      run.steps.push(thinking);
                      emitSoon();
                      break;
                    case "response.reasoning_summary_text.delta":
                      if (thinking) thinking.text += event.delta;
                      emitSoon();
                      break;
                    case "response.reasoning_summary_text.done":
                      if (thinking) thinking.text = event.text;
                      emitSoon();
                      break;
                    case "response.output_text.delta":
                      if (said) said.text += event.delta;
                      emitSoon();
                      break;
                    case "response.output_item.added": {
                      const { type, name, call_id, id: item } = event.item;
                      if (type === "message" && !said) {
                        said = { kind: "message", role: "assistant", text: "" };
                        run.steps.push(said);
                      }
                      if (type === "function_call" && !silent.has(name)) {
                        const step: ToolStep = {
                          kind: "tool",
                          id: call_id,
                          status: "running",
                          ...activity(name, {}),
                        };
                        run.steps.push(step);
                        drafts.set(item, { step, name, text: "" });
                        this.emit(store, run);
                      }
                      break;
                    }
                    case "response.function_call_arguments.delta": {
                      const draft = drafts.get(event.item_id);
                      if (draft) {
                        draft.text += event.delta;
                        emitSoon();
                      }
                      break;
                    }
                    case "response.output_item.done":
                      drafts.delete(event.item.id);
                  }
                },
              );
              break;
            } catch (e) {
              if (abort.signal.aborted || !transient(e)) throw e;
              if (!wait)
                throw Error(
                  `与模型的连接中断了（${e instanceof Error ? e.message : e}），已保存的内容仍可继续修改`,
                );
              tracer.note("retry", { wait }, String(e));
              run.steps.splice(mark);
              thinking = said = undefined;
              firstOutput = undefined;
              drafts.clear();
              this.emit(store, run);
              await new Promise((resolve) => setTimeout(resolve, wait));
            }
          }
          span.set({
            output: result.items,
            usage: result.usage,
            response: result.response,
            firstOutputMs: firstOutput,
          });
          return result;
        },
      );
      drafts.clear();
      ctx.input.push(...result.items);
      seen = ctx.input.length;
      const text = textOf(result.items);
      if (said) {
        said.text = text;
        if (!text) run.steps.splice(run.steps.indexOf(said), 1);
      } else if (text)
        run.steps.push({ kind: "message", role: "assistant", text });
      this.emit(store, run);
      const calls = result.items.filter((i) => i.type === "function_call");
      if (!calls.length) {
        ctx.input.push({
          role: "user",
          content:
            "Continue the requested work using tools. Call ask_user if you need the user, or finish when the saved drawing is ready.",
        });
        continue;
      }
      for (const call of calls) {
        abort.signal.throwIfAborted();
        const outcome = await tracer.span(
          "tool",
          call.name,
          { args: call.arguments },
          async (span) => {
            const r = await this.call(
              store,
              run,
              ctx,
              call,
              calls.length,
              abort,
              start,
            );
            span.set({
              output: r.output,
              images: r.images.map((i) => i.image_url).filter(Boolean),
              ...(r.error ? { error: r.error } : {}),
            });
            if (r.error)
              tracer.note("tool error", { tool: call.name }, r.error);
            return r;
          },
        );
        if (outcome.done) return;
        ctx.input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(outcome.output),
        });
        if (outcome.images.length)
          ctx.input.push({ role: "user", content: outcome.images });
        store.context(run.id, ctx);
        this.emit(store, run);
      }
    }
    throw Error("已达到本轮 24 次生成上限");
  }
  /** Runs one tool call. `done` ends this execution: the run finished or waits for the user. */
  private async call(
    store: UserStore,
    run: Run,
    ctx: Context,
    call: Item,
    batch: number,
    abort: AbortController,
    start: number,
  ): Promise<{
    done: boolean;
    output: unknown;
    images: Item[];
    error?: string;
  }> {
    let output: unknown;
    let images: Item[] = [];
    let step: ToolStep | undefined;
    try {
      const args = JSON.parse(call.arguments);
      if (!silent.has(call.name)) {
        step = run.steps.find(
          (s): s is ToolStep => s.kind === "tool" && s.id === call.call_id,
        );
        if (step) Object.assign(step, activity(call.name, args));
        else {
          step = {
            kind: "tool",
            id: call.call_id,
            status: "running",
            ...activity(call.name, args),
          };
          run.steps.push(step);
        }
        this.emit(store, run);
      }
      if (
        ["ask_user", "view_canvas", "finish"].includes(call.name) &&
        batch !== 1
      )
        throw Error(`${call.name} must be the only tool call`);
      switch (call.name) {
        case "read_work": {
          const work = store.work(run.workId);
          output = forAuthor(work);
          Object.assign(step!, { revision: work.revision });
          break;
        }
        case "ask_user": {
          run.questions = await questions(store, args);
          run.status = "waiting";
          ctx.input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: "Questions shown. Waiting for the user.",
          });
          store.context(run.id, ctx);
          this.emit(store, run);
          return { done: true, output: null, images: [] };
        }
        case "set_brief": {
          const { work, style } = await setBrief(
            store,
            run.workId,
            args,
            said(store, run.workId),
          );
          this.publish(store.userId, { type: "work", work });
          const effects = await library.get(style.effects, store.userId, true);
          const cast = work.brief!.cast.length
            ? await find(
                {
                  subjects: work.brief!.cast,
                  style: style.id,
                  kinds: ["picture"],
                },
                store.userId,
              )
            : undefined;
          output = {
            revision: work.revision,
            style: {
              id: style.id,
              name: style.name.zh,
              register: style.register,
              tokens: style.tokens,
              guide: style.guide,
              effects: effects.map((e) => ({ id: e.id, about: e.about })),
            },
            ...(cast ? { cast: cast.output } : {}),
          };
          images = cast?.images ?? [];
          Object.assign(step!, {
            revision: work.revision,
            ...(cast ? { found: cast.found } : {}),
          });
          break;
        }
        case "find_materials": {
          const request = findSchema.parse(args);
          const style = store.work(run.workId).brief?.style;
          const found = await find(
            { ...request, style: request.style ?? style, limit: 5 },
            store.userId,
          );
          output = found.output;
          images = found.images;
          Object.assign(step!, { found: found.found });
          break;
        }
        case "generate_images": {
          const { images: requests } = generateSchema.parse(args);
          const made = await develop(store, store.work(run.workId), requests);
          const list = this.developments.get(run.id) || [];
          list.push(...made);
          this.developments.set(run.id, list);
          const shown: Picture[] = made.map((d) => ({
            id: d.id,
            name: d.name,
            url: `/materials/files/${d.id}`,
            status: "developing",
          }));
          Object.assign(step!, { images: shown });
          for (const [i, d] of made.entries())
            void d.done.then(async (r) => {
              shown[i].status = r.status;
              this.emit(store, run);
              // An open canvas redraws the picture with its measured content.
              const work = store.works().find((w) => w.id === run.workId);
              if (r.status === "ready" && work?.materials[d.id])
                this.publish(store.userId, {
                  type: "work",
                  work: await freshen(work, store.userId),
                });
            });
          output = {
            developing: made.map((d, i) => ({
              id: d.id,
              name: d.name,
              aspect: requests[i].aspect ?? "square",
            })),
            note: "Use these ids now. view_canvas waits for them; each is shown to you when it arrives.",
          };
          break;
        }
        case "write_work": {
          const { work, added } = await writeWork(store, run.workId, args);
          run.firstSceneMs ??= Date.now() - start;
          this.publish(store.userId, { type: "work", work });
          output = {
            revision: work.revision,
            ...(added.length ? { materialsAdded: added } : {}),
          };
          Object.assign(step!, { revision: work.revision, materials: added });
          break;
        }
        case "view_canvas": {
          const pending = (this.developments.get(run.id) || []).filter(
            (d) => !d.settled,
          );
          run.status = "viewing";
          if (pending.length) Object.assign(step!, { waiting: pending.length });
          this.emit(store, run);
          try {
            await Promise.race([
              Promise.all(pending.map((d) => d.done)),
              new Promise((_, reject) =>
                abort.signal.addEventListener("abort", () =>
                  reject(abort.signal.reason),
                ),
              ),
            ]);
            images.push(
              ...(await this.developed(store, run)).flatMap((m) => m.content),
            );
            // The service may be restarting; after a few tries the run stops instead of
            // spending the author's turns on a look it cannot get.
            let result: Awaited<ReturnType<typeof observe>> | undefined;
            for (const wait of [2000, 6000, 0]) {
              try {
                result = await observe(store, run.workId, args, abort.signal);
                break;
              } catch (e) {
                if (!(e instanceof Unavailable) || !wait) throw e;
                await new Promise((r) => setTimeout(r, wait));
              }
            }
            if (!result) throw new Unavailable("画布查看服务不可用");
            run.observations.push(result.observation);
            output = result.observation;
            images.push(...result.content);
            Object.assign(step!, {
              waiting: undefined,
              screenshots: pictures(result.observation.screenshots),
              errors: result.observation.errors,
            });
          } finally {
            run.status = "running";
          }
          break;
        }
        case "finish": {
          const work = store.work(run.workId);
          const developments = this.developments.get(run.id) || [];
          const pending = developments.filter((d) => !d.settled);
          if (pending.length)
            throw new DomainError(
              `图片仍在生成：${pending.map((d) => d.id).join(", ")}。用 view_canvas 等它们显影后再看一次`,
            );
          requireObserved(work, run.observations);
          const looked = Math.max(
            ...run.observations
              .filter((o) => o.revision === work.revision)
              .map((o) => o.at),
          );
          const unseen = developments.filter(
            (d) => work.materials[d.id] && d.settled!.at > looked,
          );
          if (unseen.length)
            throw new DomainError(
              `图片 ${unseen.map((d) => d.id).join(", ")} 在最后一次查看之后才显影，请再看一次画布`,
            );
          run.status = "completed";
          run.steps.push({
            kind: "message",
            role: "assistant",
            text: args.message,
          });
          ctx.input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: "Completed",
          });
          store.context(run.id, ctx);
          this.developments.delete(run.id);
          return { done: true, output: null, images: [] };
        }
        default:
          throw Error("Unknown tool " + call.name);
      }
      if (step) step.status = "done";
      return { done: false, output, images };
    } catch (e) {
      abort.signal.throwIfAborted();
      const error = e instanceof Error ? e.message : String(e);
      if (step) Object.assign(step, { status: "failed", error });
      if (e instanceof Unavailable) throw e;
      return { done: false, output: { error }, images: [], error };
    }
  }
}

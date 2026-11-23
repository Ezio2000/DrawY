import { DomainError, id, type Run, type Settings, type Step } from "../contracts/index.ts";
import { MIN_TEXT } from "../contracts/geometry.ts";
import type { UserStore } from "../storage/index.ts";
import { bindings, library, look, useOf } from "../materials/index.ts";
import { requireObserved, sceneObservations, Unavailable } from "../observation/index.ts";
import {
  citationsOf,
  CutOff,
  generate,
  requestOf,
  textOf,
  type Answer,
  type Item,
} from "../models/index.ts";
import { tracer } from "../trace/index.ts";
import { author } from "./prompts.ts";
import { tools, searchTools } from "./tools.ts";
import {
  compact,
  contextSize,
  holdEffort,
  opened,
  reopened,
  requestRole,
  userMessage,
  withLessThought,
  type Context,
} from "./conversation.ts";
import { failedOf, spend, spendFailed, steering } from "./spending.ts";
import { activity, LiveSteps, silent, type ToolStep } from "./steps.ts";
import { handlers, parsedArguments, Refusal, type Call, type Execution, type Outcome } from "./handlers.ts";

/** The tools a run offers: the drawing tools, and the one way it searches, if any. A run
 * never has both the model's own search and the search service. */
const toolsFor = (settings: Pick<Settings, "search">): Item[] =>
  settings.search.mode === "builtin"
    ? [...tools, { type: "web_search", search_context_size: "low" }]
    : settings.search.mode === "service"
      ? [...tools, ...searchTools]
      : tools;
/** A model request that failed on the way rather than on its content. */
const transient = (e: unknown) =>
  e instanceof TypeError ||
  (e instanceof Error &&
    /^模型请求 (429|5\d\d)|模型连接在完成前中断|terminated|ECONNRESET|socket/.test(
      e.message,
    ));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Turns one execution may take before it stops. */
const TURNS = 24;

export class Agent {
  active = new Map<string, AbortController>();
  /** Runs already held once for text too small to read. */
  private heldForText = new Set<string>();
  /** Pictures each run has asked for, developing in the background. */
  private developments = new Map<string, Execution["developments"]>();
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
    if (store.busy(workId)) throw new DomainError("请先完成或取消当前任务", 409);
    if (!work.scenes[sceneId]) throw new DomainError("场景不存在", 404);
    const settings = store.settings();
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
    const ctx = opened(store, sceneId, work, settings, message);
    this.emit(store, run);
    store.saveContext(run.id, ctx);
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
    const ctx = reopened(store, run, store.context(runId) as Context);
    ctx.input.push(await userMessage(store, answer, materials));
    run.steps.push({ kind: "message", role: "user", text: answer, materials });
    run.questions = undefined;
    run.status = "running";
    ctx.generations = 0;
    this.emit(store, run);
    store.saveContext(run.id, ctx);
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
  /** Runs the author's turns from a request or an answer until the run ends, waits for the
   * user or fails. The run is billed at the settings and prices it started with. */
  async execute(store: UserStore, run: Run, ctx: Context, trigger: "request" | "answer") {
    const abort = new AbortController();
    this.active.set(run.id, abort);
    const timeout = setTimeout(() => abort.abort(new Error("运行超过 15 分钟")), 15 * 60 * 1000);
    const settings = ctx.settings;
    const developments = this.developments.get(run.id) ?? [];
    this.developments.set(run.id, developments);
    const x: Execution = {
      store,
      run,
      ctx,
      signal: abort.signal,
      start: Date.now(),
      emit: () => this.emit(store, run),
      showWork: (work) => this.publish(store.userId, { type: "work", work }),
      developments,
      developed: () => developed(store, developments),
    };
    run.services = {
      label: settings.label,
      author: settings.authorName,
      model: settings.author.model,
      effort: settings.author.effort,
      speed: settings.author.speed,
      search: settings.search.mode,
      ...(settings.search.service ? { searchBy: settings.search.service.name } : {}),
      image: settings.imageName,
    };
    run.prices = settings.prices;
    await tracer.within(run.id, () =>
      tracer
        .span(
          "execution",
          trigger,
          {
            message: run.steps.findLast(
              (s): s is Extract<Step, { kind: "message" }> => s.kind === "message" && s.role === "user",
            )?.text,
            model: settings.author.model,
            protocol: settings.author.protocol,
            effort: settings.author.effort,
            search: settings.search.mode,
            ...(settings.search.service ? { searchService: settings.search.service.provider } : {}),
            speed: settings.author.speed,
            imageModel: settings.image.model,
          },
          async (execution) => {
            try {
              const instructions = author(await bindings());
              // Where this execution starts from; each turn records what it adds.
              execution.set({
                instructions,
                context: ctx.input,
                tools: toolsFor(settings).map((t) => ("name" in t ? t.name : t.type)),
              });
              await this.loop(x, instructions);
            } catch (e) {
              console.error("DrawY run failed", run.id, e);
              run.status = abort.signal.aborted ? "cancelled" : "failed";
              run.error = String(abort.signal.reason || e);
              if (run.status === "failed") throw e;
            } finally {
              // A cancelled batch still needs a result for every emitted tool call.
              const answered = new Set(
                ctx.input.filter((item) => item.type === "function_call_output").map((item) => item.call_id),
              );
              for (const item of ctx.input.filter((item) => item.type === "function_call"))
                if (!answered.has(item.call_id))
                  ctx.input.push({
                    type: "function_call_output",
                    call_id: item.call_id,
                    output: "Execution interrupted. Read the current work before continuing.",
                  });
              store.saveContext(run.id, ctx);
              clearTimeout(timeout);
              this.active.delete(run.id);
              // Only a waiting run goes on, with the pictures it asked for.
              if (run.status !== "waiting") {
                this.developments.delete(run.id);
                this.heldForText.delete(run.id);
              }
              run.elapsedMs = (run.elapsedMs || 0) + Date.now() - x.start;
              this.emit(store, run);
              execution.set({ status: run.status });
              tracer.status(run.id, run.status);
            }
          },
        )
        .catch(() => {}),
    );
  }
  private async loop(x: Execution, instructions: string) {
    const { store, run, ctx, signal } = x;
    const tools = toolsFor(ctx.settings);
    // What the trace has of the conversation; each turn records what was added since.
    let seen = ctx.input.length;
    while (ctx.generations++ < TURNS) {
      signal.throwIfAborted();
      ctx.input.push(...(await x.developed()));
      await compact(store, run, ctx, signal, instructions, tools);
      if (seen > ctx.input.length) seen = 0;
      holdEffort(ctx.input, ctx.settings.author, ctx.baseEffort);
      const { result, said } = await this.turn(x, instructions, tools, ctx.input.slice(seen));
      spend(run, result.usage);
      ctx.input.push(...result.items);
      seen = ctx.input.length;
      if (result.usage.input_tokens)
        ctx.measured = {
          tokens: result.usage.input_tokens + (result.usage.output_tokens ?? 0),
          items: ctx.input.length,
        };
      const text = textOf(result.items);
      const citations = citationsOf(result.items);
      if (said) {
        said.text = text;
        if (citations.length) said.citations = citations;
        if (!text) run.steps.splice(run.steps.indexOf(said), 1);
      } else if (text)
        run.steps.push({ kind: "message", role: "assistant", text, ...(citations.length ? { citations } : {}) });
      x.emit();
      const calls = result.items.filter((i) => i.type === "function_call");
      if (!calls.length) {
        // Words with no call end the run once the work is done: they are its closing words.
        const blocked = this.done(x);
        if (text && blocked === undefined) {
          run.status = "completed";
          store.saveContext(run.id, ctx);
          return;
        }
        ctx.input.push({
          role: "user",
          content: blocked
            ? `The work is not done yet: ${blocked}. Take the next step with a tool, keeping any note to the user in the same message.`
            : "Your last message had neither closing words nor a tool call. Write your closing words if the work is done, or take the next step with a tool.",
        });
        continue;
      }
      let writeError: string | undefined;
      // Every call's result comes before any picture: a service that checks a batch's
      // results in order takes a message between them for a call left unanswered.
      const shown: Item[] = [];
      for (const item of calls) {
        signal.throwIfAborted();
        const outcome = await this.call(x, { item, batch: calls, writeError });
        if (outcome === "waiting") return;
        if (item.name === "write_work" && outcome.error) writeError = outcome.error;
        ctx.input.push({
          type: "function_call_output",
          call_id: item.call_id,
          output: typeof outcome.output === "string" ? outcome.output : JSON.stringify(outcome.output),
        });
        if (outcome.images?.length) shown.push({ role: "user", content: outcome.images });
        store.saveContext(run.id, ctx);
        x.emit();
      }
      ctx.input.push(...shown);
      store.saveContext(run.id, ctx);
    }
    throw Error(`已达到本轮 ${TURNS} 次生成上限`);
  }
  /** Asks the model for one turn, showing its steps as they stream. A dropped stream, a
   * rate limit or a server error is asked again from the same input, after what the broken
   * attempt had shown is taken back; a turn that thought away its whole budget is asked
   * once more with the least thought. Every failed attempt is billed and recorded. */
  private async turn(x: Execution, instructions: string, tools: Item[], added: Item[]) {
    const { store, run, ctx, signal } = x;
    const author = ctx.settings.author;
    const steer = steering(run, tools, author);
    const live = new LiveSteps(run, x.emit, x.start);
    try {
      const result = await tracer.span(
        "turn",
        `turn ${ctx.generations}`,
        {
          input: added,
          inputItems: ctx.input.length,
          estimatedTokens: contextSize(ctx),
          request: {
            ...requestOf(author),
            effort: author.effort,
            instructionsChars: instructions.length,
            tools: tools.length,
            ...(Object.keys(steer).length ? { steer } : {}),
          },
        },
        async (span) => {
          let asked = { role: requestRole(ctx), effort: author.effort };
          let lessened = false;
          for (let attempt = 0, waits = [2000, 8000, 0]; attempt < waits.length; attempt++) {
            const wait = waits[attempt];
            const tried = Date.now();
            let reported: Item | undefined,
              chars = 0;
            try {
              const result: Answer = await generate(asked.role, {
                instructions,
                input: ctx.input,
                tools,
                signal,
                // One key for all of a user's works: every request begins with the same
                // instructions and tools, and a work's turns extend its earlier ones.
                cacheKey: store.userId,
                steer,
                effort: asked.effort,
                onEvent: (event) => {
                  if (event.type === "response.usage") reported = event.usage;
                  else {
                    if (event.type.endsWith(".delta") && typeof event.delta === "string")
                      chars += event.delta.length;
                    live.event(event);
                  }
                },
              });
              span.set({
                output: result.items,
                usage: result.usage,
                response: result.response,
                firstOutputMs: live.firstOutput,
              });
              return result;
            } catch (e) {
              // Spent whatever becomes of the run, and told apart from what it paid for.
              const spent = spendFailed(run, {
                usage: e instanceof CutOff ? e.usage : reported,
                ms: Date.now() - tried,
                chars,
              });
              tracer.record(
                "turn",
                `turn ${ctx.generations} failed attempt`,
                {
                  failed: true,
                  inputItems: ctx.input.length,
                  estimatedTokens: contextSize(ctx),
                  usage: { ...spent.usage, output_tokens: spent.output },
                  ...(spent.estimated ? { estimatedOutput: spent.estimated } : {}),
                },
                { startedAt: tried, error: e instanceof Error ? e.message : String(e) },
              );
              if (e instanceof CutOff) {
                span.set({ incomplete: e.reason ?? "unknown" });
                const less =
                  e.thoughtOnly && !lessened && !signal.aborted
                    ? withLessThought(ctx.input, asked.role, asked.effort)
                    : undefined;
                if (less) {
                  // A turn that thinks away its budget would do so again as it is, and
                  // this attempt is not one the connection's retries should count.
                  asked = less;
                  lessened = true;
                  attempt--;
                  tracer.note("less thought", { effort: less.effort }, e.message);
                  live.rewind();
                  x.emit();
                  continue;
                }
              }
              if (signal.aborted || !transient(e)) throw e;
              if (!wait)
                throw Error(
                  `与模型的连接中断了（${e instanceof Error ? e.message : e}），已保存的内容仍可继续修改`,
                );
              tracer.note("retry", { wait }, String(e));
              live.rewind();
              failedOf(run).ms += wait;
              x.emit();
              await pause(wait);
            }
          }
          throw Error("unreachable");
        },
      );
      return { result, said: live.said };
    } finally {
      live.close();
    }
  }
  /** Answers one tool call under its own trace record. Its step, if it streamed one, ends
   * however the call does. */
  private call(x: Execution, call: Call): Promise<"waiting" | (Outcome & { error?: string })> {
    const { run, signal } = x;
    const { item } = call;
    return tracer.span("tool", item.name, { args: item.arguments }, async (span) => {
      call.step = run.steps.find((s): s is ToolStep => s.kind === "tool" && s.id === item.call_id);
      let outcome: Outcome & { error?: string };
      try {
        const args = parsedArguments(x, item);
        if (!silent.has(item.name)) {
          const doing = activity(item.name, args, run.sceneId);
          if (call.step) Object.assign(call.step, doing);
          else run.steps.push((call.step = { kind: "tool", id: item.call_id, status: "running", ...doing }));
          x.emit();
        }
        const handler = handlers[item.name];
        if (!handler)
          throw Error(`没有 ${item.name} 这个工具：请直接调用工具列表里的工具，同一轮可以并列调用多个`);
        const answered = await handler(x, args, call);
        if (answered === "waiting") {
          span.set({ output: null, images: [] });
          return answered;
        }
        outcome = answered;
        if (call.step) call.step.status = "done";
      } catch (e) {
        signal.throwIfAborted();
        const error = e instanceof Error ? e.message : String(e);
        // A write that saved before its embedded view failed stays saved.
        if (call.step && call.step.status !== "done") Object.assign(call.step, { status: "failed", error });
        if (e instanceof Unavailable) throw e;
        outcome = { output: e instanceof Refusal ? e.output : { error }, error };
        tracer.note("tool error", { tool: item.name }, error);
      }
      span.set({
        output: outcome.output,
        images: (outcome.images ?? []).map((i) => i.image_url).filter(Boolean),
        ...(outcome.error ? { error: outcome.error } : {}),
      });
      return outcome;
    });
  }
  /** What still stands in the way of finishing: every picture developed and the latest
   * revision seen since, whole and without errors. */
  private done({ store, run, developments }: Execution): string | undefined {
    const work = store.work(run.workId);
    const pending = developments.filter((d) => !d.settled);
    if (pending.length)
      return `图片仍在生成：${pending.map((d) => d.id).join(", ")}。用 view_canvas 等它们显影后再看一次`;
    const observed = [
      ...store.runs(run.workId).flatMap((r) => (r.id === run.id ? [] : r.observations)),
      ...run.observations,
    ];
    try {
      requireObserved(work, observed);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    const populated = Object.values(work.scenes).filter((s) => s.modules.length);
    const matching = populated.flatMap((s) => sceneObservations(work, s.id, run.observations));
    const looked = matching.length ? Math.max(...matching.map((o) => o.at)) : 0;
    const unseen = developments.filter((d) => work.materials[d.id] && d.settled!.at > looked);
    if (unseen.length)
      return `图片 ${unseen.map((d) => d.id).join(", ")} 在最后一次查看之后才显影，请再看一次画布`;
    // Text too small to read holds the end once: some of it, such as the names a map
    // draws, is not the author's to change, and it can say so and end.
    if (this.heldForText.has(run.id)) return undefined;
    const small = populated.flatMap((scene) => {
      const px = sceneObservations(work, scene.id, run.observations)
        .filter((o) => o.overview && o.smallestText?.[scene.id] !== undefined)
        .at(-1)?.smallestText?.[scene.id];
      return px !== undefined && px < MIN_TEXT ? [`${scene.id} ${px}px`] : [];
    });
    if (!small.length) return undefined;
    this.heldForText.add(run.id);
    return `最小的字小于 ${MIN_TEXT} 像素（${small.join("，")}），读者看不清：放大或删减这些字再看一次；如果这些字不由你决定（比如地图自带的地名），说明原因后结束`;
  }
}
/** Tells the author about pictures that finished developing since it last heard, and
 * shows it the ones that came out. */
async function developed(store: UserStore, developments: Execution["developments"]): Promise<Item[]> {
  const fresh = developments.filter((d) => d.settled && !d.reported);
  if (!fresh.length) return [];
  for (const d of fresh) d.reported = true;
  const ready = fresh.filter((d) => d.settled!.status === "ready");
  // The measured visible content, so modules can take the picture's real proportions.
  const sizes = new Map(
    (ready.length ? await library.get(ready.map((d) => d.id), store.userId, true) : []).flatMap((m) => {
      const use = useOf(m);
      return use?.kind === "picture" ? [[m.id, `${use.width}×${use.height}`] as const] : [];
    }),
  );
  const lines = fresh.map((d) =>
    d.settled!.status === "ready"
      ? `${d.id} (${d.name}) developed; visible content ${sizes.get(d.id) ?? "unknown"}.${
          d.settled!.opaque
            ? " It came out with a background around it, painted twice, so it shows as a box: use it as a scene, or generate it again."
            : ""
        }`
      : `${d.id} (${d.name}) failed: ${d.settled!.error}. Generate it again or draw another way.`,
  );
  return [
    {
      role: "user",
      content: [
        { type: "input_text", text: "Pictures:\n" + lines.join("\n") },
        ...(await look(ready.map((d) => d.id), store.userId, 384)),
      ],
    },
  ];
}

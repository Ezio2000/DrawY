import {
  id,
  DomainError,
  boundsSchema,
  type Run,
  type Step,
  type ToolActivity,
  type Asset,
} from "../contracts/index.ts";
import type { UserStore } from "../storage/index.ts";
import { writeWork } from "../workspace/index.ts";
import { findMaterials } from "../materials/index.ts";
import { generateImage } from "../images/index.ts";
import { observe, requireObserved } from "../observation/index.ts";
import { AUTHOR } from "./prompts.ts";
import { generate, textOf, type Item } from "../models/index.ts";
import { tools } from "./tools.ts";
import { partialJson } from "./partial.ts";
type ToolStep = Extract<Step, { kind: "tool" }>;
const pictures = (assets: Asset[]) =>
  assets.map(({ name, url }) => ({ name, url }));
function activity(name: string, args: any): ToolActivity {
  switch (name) {
    case "read_work":
      return { name };
    case "find_matirial":
      return { name, query: args.query ?? "" };
    case "generate_image":
      return { name, prompt: args.prompt ?? "" };
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
        resources: (args.resources || [])
          .filter((r: any) => r?.url)
          .map((r: any) => ({ name: r.name ?? "", url: r.url })),
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
interface Context {
  input: Item[];
  generations: number;
}
function userMessage(store: UserStore, text: string, assets: string[]): Item {
  return {
    role: "user",
    content: [
      { type: "input_text", text },
      ...assets.map((id) => ({
        type: "input_image",
        image_url: `data:${store.asset(id).mediaType};base64,${store.bytes(id).toString("base64")}`,
      })),
    ],
  };
}

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
  if (contextSize(ctx.input) < 128000) return;
  const result = await generate(
    store.settings().author,
    "Summarize this drawing conversation for continuation. Preserve user requirements, reference-image intent, decisions, unfinished work and tool failures. Do not execute the task. The latest saved work and original reference images will be supplied separately.",
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
            s.kind === "message" && s.role === "user" ? s.assets || [] : [],
          ),
        ),
    ),
  ];
  ctx.input = [
    userMessage(
      store,
      "Conversation summary:\n" + textOf(result.items),
      references,
    ),
    {
      role: "user",
      content: `Current scene: ${run.sceneId}\nCurrent work: ${JSON.stringify(store.work(run.workId))}`,
    },
  ];
  store.context(run.id, ctx);
}
export class Agent {
  active = new Map<string, AbortController>();
  constructor(public publish: (user: string, event: object) => void) {}
  emit(store: UserStore, run: Run) {
    store.saveRun(run);
    this.publish(store.userId, { type: "run", run });
  }
  start(
    store: UserStore,
    workId: string,
    sceneId: string,
    prompt: string,
    assets: string[] = [],
  ) {
    const work = store.work(workId);
    if (
      store
        .runs(workId)
        .some((r) => ["running", "viewing", "waiting"].includes(r.status))
    )
      throw new DomainError("请先完成或取消当前任务", 409);
    for (const a of assets) store.asset(a);
    if (!work.scenes[sceneId]) throw new DomainError("场景不存在", 404);
    const run: Run = {
      id: id(),
      workId,
      sceneId,
      status: "running",
      steps: [{ kind: "message", role: "user", text: prompt, assets }],
      observations: [],
      startedAt: Date.now(),
    };
    const previous = store.runs(workId).at(-1);
    const ctx: Context = {
      input: previous ? store.context(previous.id).input : [],
      generations: 0,
    };
    ctx.input.push(userMessage(store, prompt, assets), {
      role: "user",
      content: `Current scene: ${sceneId}\nCurrent work: ${JSON.stringify(work)}`,
    });
    this.emit(store, run);
    store.context(run.id, ctx);
    void this.execute(store, run, ctx);
    return run;
  }
  resume(
    store: UserStore,
    runId: string,
    answer: string,
    assets: string[] = [],
  ) {
    const run = store.run(runId);
    if (run.status !== "waiting") throw new DomainError("当前任务没有等待回答");
    const ctx = store.context(runId) as Context;
    const message = userMessage(store, answer, assets);
    run.steps.push({ kind: "message", role: "user", text: answer, assets });
    run.question = undefined;
    run.status = "running";
    ctx.input.push(message);
    ctx.generations = 0;
    this.emit(store, run);
    store.context(run.id, ctx);
    void this.execute(store, run, ctx);
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
    return run;
  }
  async execute(store: UserStore, run: Run, ctx: Context) {
    const abort = new AbortController();
    this.active.set(run.id, abort);
    const timeout = setTimeout(
      () => abort.abort(new Error("运行超过 15 分钟")),
      15 * 60 * 1000,
    );
    const start = Date.now();
    let flush: ReturnType<typeof setTimeout> | undefined;
    try {
      const settings = store.settings();
      // Tool arguments stream in; each flush shows what has been laid out so far.
      const drafts = new Map<
        string,
        { step: ToolStep; name: string; text: string }
      >();
      const emitSoon = () => {
        flush ??= setTimeout(() => {
          flush = undefined;
          for (const d of drafts.values())
            Object.assign(d.step, activity(d.name, partialJson(d.text) ?? {}));
          this.emit(store, run);
        }, 250);
      };
      while (ctx.generations++ < 24) {
        let thinking: Extract<Step, { kind: "thinking" }> | undefined;
        // Progress the author writes takes its place among the steps as it streams.
        let said: Extract<Step, { kind: "message" }> | undefined;
        abort.signal.throwIfAborted();
        await compact(store, run, ctx, abort.signal);
        const result = await generate(
          settings.author,
          AUTHOR + "\nUser preferences: " + settings.preferences,
          ctx.input,
          tools,
          abort.signal,
          (event) => {
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
                if (
                  type === "function_call" &&
                  name !== "ask_question" &&
                  name !== "finish"
                ) {
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
        drafts.clear();
        ctx.input.push(...result.items);
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
              "Continue the requested work using tools. Call finish when the saved drawing is ready.",
          });
          continue;
        }
        for (const call of calls) {
          abort.signal.throwIfAborted();
          let output: unknown;
          let images: Item[] = [];
          let step: ToolStep | undefined;
          try {
            const args = JSON.parse(call.arguments);
            if (call.name !== "ask_question" && call.name !== "finish") {
              step = run.steps.find(
                (s): s is ToolStep =>
                  s.kind === "tool" && s.id === call.call_id,
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
            switch (call.name) {
              case "read_work": {
                const work = store.work(run.workId);
                output = work;
                Object.assign(step!, { revision: work.revision });
                break;
              }
              case "find_matirial": {
                const materials = await findMaterials(store, args.query);
                output = materials;
                Object.assign(step!, { materials: materials.slice(0, 12) });
                break;
              }
              case "generate_image": {
                const assets = await generateImage(store, args, abort.signal);
                output = assets;
                Object.assign(step!, { images: pictures(assets) });
                break;
              }
              case "write_work": {
                const work = writeWork(store, run.workId, args);
                run.firstSceneMs ??= Date.now() - start;
                this.publish(store.userId, { type: "work", work });
                output = { revision: work.revision };
                Object.assign(step!, { revision: work.revision });
                break;
              }
              case "ask_question": {
                if (calls.length !== 1)
                  throw Error("ask_question must be the only tool call");
                run.question = args;
                run.status = "waiting";
                ctx.input.push({
                  type: "function_call_output",
                  call_id: call.call_id,
                  output: "Question shown. Waiting for user.",
                });
                store.context(run.id, ctx);
                this.emit(store, run);
                return;
              }
              case "view_canvas": {
                if (calls.length !== 1)
                  throw Error("view_canvas must be the only tool call");
                run.status = "viewing";
                this.emit(store, run);
                try {
                  const result = await observe(
                    store,
                    run.workId,
                    args,
                    abort.signal,
                  );
                  run.observations.push(result.observation);
                  output = result.observation;
                  images = result.content;
                  Object.assign(step!, {
                    screenshots: pictures(result.observation.screenshots),
                    errors: result.observation.errors,
                  });
                } finally {
                  run.status = "running";
                }
                break;
              }
              case "finish": {
                if (calls.length !== 1)
                  throw Error("finish must be the only tool call");
                requireObserved(store.work(run.workId), run.observations);
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
                return;
              }
              default:
                throw Error("Unknown tool " + call.name);
            }
            if (step) step.status = "done";
          } catch (e) {
            abort.signal.throwIfAborted();
            const error = e instanceof Error ? e.message : String(e);
            output = { error };
            if (step) Object.assign(step, { status: "failed", error });
          }
          ctx.input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(output),
          });
          if (images.length) ctx.input.push({ role: "user", content: images });
          store.context(run.id, ctx);
          this.emit(store, run);
        }
      }
      throw Error("已达到本轮 24 次生成上限");
    } catch (e) {
      console.error("DrawY run failed", run.id, e);
      run.status = abort.signal.aborted ? "cancelled" : "failed";
      run.error = String(abort.signal.reason || e);
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
    }
  }
}

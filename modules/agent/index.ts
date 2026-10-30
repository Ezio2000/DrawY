import { id, DomainError, type Run, type Message } from "../contracts/index.ts";
import type { UserStore } from "../storage/index.ts";
import { writeWork } from "../workspace/index.ts";
import { findMaterials } from "../materials/index.ts";
import { generateImage } from "../images/index.ts";
import { observe, requireObserved } from "../observation/index.ts";
import { AUTHOR } from "./prompts.ts";
import { generate, textOf, type Item } from "../models/index.ts";
import { tools } from "./tools.ts";
interface Context {
  input: Item[];
  generations: number;
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
      messages: [{ role: "user", text: prompt, assets }],
      observations: [],
      startedAt: Date.now(),
    };
    const history = store
      .runs(workId)
      .flatMap((r) => r.messages)
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.text }));
    const content: Item[] = [
      {
        type: "input_text",
        text: `${prompt}\nCurrent scene: ${sceneId}\nCurrent work: ${JSON.stringify(work)}`,
      },
    ];
    for (const a of assets) {
      const asset = store.asset(a);
      content.push({
        type: "input_image",
        image_url: `data:${asset.mediaType};base64,${store.bytes(a).toString("base64")}`,
      });
    }
    const ctx: Context = {
      input: [...history, { role: "user", content }],
      generations: 0,
    };
    this.emit(store, run);
    void this.execute(store, run, ctx);
    return run;
  }
  resume(store: UserStore, runId: string, answer: string) {
    const run = store.run(runId);
    if (run.status !== "waiting") throw new DomainError("当前任务没有等待回答");
    const ctx = store.context(runId) as Context;
    run.messages.push({ role: "user", text: answer });
    run.question = undefined;
    run.status = "running";
    ctx.input.push({ role: "user", content: answer });
    this.emit(store, run);
    void this.execute(store, run, ctx);
    return run;
  }
  cancel(store: UserStore, runId: string) {
    const run = store.run(runId);
    this.active.get(runId)?.abort();
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
    try {
      const settings = store.settings();
      while (ctx.generations++ < 24) {
        abort.signal.throwIfAborted();
        const result = await generate(
          settings.author,
          AUTHOR + "\nUser preferences: " + settings.preferences,
          ctx.input,
          tools,
          abort.signal,
          () => {
            if (run.firstOutputMs === undefined) {
              run.firstOutputMs = Date.now() - start;
              this.emit(store, run);
            }
          },
        );
        ctx.input.push(...result.items);
        const text = textOf(result.items);
        if (text) {
          run.messages.push({ role: "assistant", text });
          this.emit(store, run);
        }
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
          try {
            const args = JSON.parse(call.arguments);
            switch (call.name) {
              case "read_work":
                output = store.work(run.workId);
                break;
              case "find_matirial":
                output = await findMaterials(store, args.query);
                break;
              case "generate_image": {
                this.publish(store.userId, {
                  type: "progress",
                  workId: run.workId,
                  text: "正在绘制图片…",
                });
                output = await generateImage(store, args, abort.signal);
                break;
              }
              case "write_work": {
                const work = writeWork(store, run.workId, args);
                run.firstSceneMs ??= Date.now() - start;
                this.publish(store.userId, { type: "work", work });
                output = { revision: work.revision };
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
                run.messages.push({ role: "assistant", text: args.message });
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
          } catch (e) {
            abort.signal.throwIfAborted();
            output = { error: e instanceof Error ? e.message : String(e) };
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
      clearTimeout(timeout);
      this.active.delete(run.id);
      run.elapsedMs = (run.elapsedMs || 0) + Date.now() - start;
      this.emit(store, run);
    }
  }
}

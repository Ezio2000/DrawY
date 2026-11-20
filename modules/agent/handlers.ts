import {
  DomainError,
  EditRejected,
  type Cause,
  type Picture,
  type Problem,
  type Question,
  type Run,
  type Step,
  type Work,
} from "../contracts/index.ts";
import { composed } from "../editing/index.ts";
import type { Development } from "../images/index.ts";
import { develop } from "../images/index.ts";
import { find, freshen, kit, library } from "../materials/index.ts";
import type { Item } from "../models/index.ts";
import { observe, Unavailable } from "../observation/index.ts";
import { readPage, searchWeb } from "../search/index.ts";
import type { UserStore } from "../storage/index.ts";
import { forAuthor, setBrief, writeWork } from "../workspace/index.ts";
import { said, type Context } from "./conversation.ts";
import { guidesRead, readGuides } from "./guides.ts";
import { completedRecords } from "./partial.ts";
import { counted, failedOf, research, searchesLeft, spendImages } from "./spending.ts";
import { activity, type ToolStep } from "./steps.ts";
import {
  askSchema,
  findSchema,
  generateSchema,
  guideSchema,
  openSchema,
  searchSchema,
  settleSchema,
} from "./tools.ts";

/** What each of the author's tools does when it is called. */

/** One execution of a run, from a request or an answer until it ends, waits for the user
 * or fails: what every turn and tool call works with. */
export interface Execution {
  store: UserStore;
  run: Run;
  ctx: Context;
  signal: AbortSignal;
  /** When this execution started. */
  start: number;
  /** Saves the run and shows it on the user's pages. */
  emit(): void;
  /** Shows the user's pages a saved work. */
  showWork(work: Work): void;
  /** The pictures this run has asked for, developing in the background. */
  developments: (Development & { reported?: boolean })[];
  /** Tells the author about pictures that finished since it last heard, showing those that came out. */
  developed(): Promise<Item[]>;
}
/** A tool call being answered: the batch it came in, its step, and the error of a write
 * earlier in the batch. */
export interface Call {
  item: Item;
  batch: Item[];
  step?: ToolStep;
  writeError?: string;
}
/** What a call answers: its output to the author, and pictures shown after the batch. */
export interface Outcome {
  output: unknown;
  images?: Item[];
}
/** A call's failure that answers with an output of its own rather than just the error. */
export class Refusal extends Error {
  constructor(
    message: string,
    public output: object,
  ) {
    super(message);
  }
}

/** Every revision a run saves belongs to the request that started it. */
const causeOf = (run: Run): Cause => ({
  kind: "run",
  runId: run.id,
  prompt: (run.steps[0] as Extract<Step, { kind: "message" }>).text,
});
const idsIn = (list: unknown) =>
  Array.isArray(list) ? list.flatMap((r) => (typeof r?.id === "string" ? [r.id] : [])) : [];
/** What is held of a write that was not saved, and how to finish it. */
function heldNote(held: Record<string, unknown>) {
  const parts = (["scenes", "modules", "links", "drawings", "details"] as const)
    .map((k) => [k, idsIn(held[k])] as const)
    .filter(([, ids]) => ids.length)
    .map(([k, ids]) => `${k}: ${ids.join(", ")}`);
  return `Nothing was saved, and this write is held as it stands. To finish it, call write_work with amend: true and only what corrects it: a record with a held id changes only the fields you give, and remove drops a held record. Held: ${parts.join("; ") || "(no records)"}.`;
}
/** A tool call's arguments. Input the model wrote broken is its to correct, as it can see
 * what it wrote: the call fails like any other, without another pass over the whole turn.
 * Of a broken write, the records that arrived whole are held, so a correction need only
 * carry the rest. */
export function parsedArguments(x: Execution, call: Item) {
  try {
    return JSON.parse(call.arguments);
  } catch (e) {
    failedOf(x.run).invalidCalls++;
    const why = e instanceof Error ? e.message : e;
    const kept = call.name === "write_work" ? completedRecords(call.arguments) : undefined;
    if (kept && Object.keys(kept).length) {
      const error = `工具参数不是有效的 JSON（${why}），没有保存`;
      const { amend, view: _view, ...records } = kept;
      x.ctx.held = amend && x.ctx.held ? composed(x.ctx.held, records) : records;
      throw new Refusal(error, { error, note: heldNote(x.ctx.held) });
    }
    throw Error(`工具参数不是有效的 JSON（${why}），没有保存。请改正后把完整参数重发`);
  }
}
/** Library drawings the work uses whose cards the author has not read: parameters it
 * guessed draw something other than it meant, or nothing. */
function cardsUnread(work: Work, input: Item[], batch: Item[] = []) {
  const { drawings } = guidesRead(input, batch);
  // Each drawing is pointed out once: an author that went on without its card had a reason.
  const told = new Set(
    input.flatMap((i) => {
      if (i.type !== "function_call_output" || typeof i.output !== "string" || !i.output.includes('"cardsUnread"'))
        return [];
      try {
        return (JSON.parse(i.output).cardsUnread ?? []) as string[];
      } catch {
        return [];
      }
    }),
  );
  const unread = Object.values(work.materials)
    .filter((m) => m.kind === "drawing" && !drawings.has(m.id) && !told.has(m.id))
    .map((m) => m.id);
  return unread.length
    ? {
        cardsUnread: unread,
        note: "Read these drawings' cards with draw_guide before judging them: their parameters cannot be guessed.",
      }
    : {};
}
/** Option pictures for a question: pictures as themselves, styles by their samples. */
async function questions(store: UserStore, input: unknown): Promise<Question[]> {
  const { questions } = askSchema.parse(input);
  const ids = [...new Set(questions.flatMap((q) => q.options.flatMap((o) => o.materials || [])))];
  // A picture shows itself; a style shows a few of its samples.
  const found = new Map(
    (ids.length ? await library.get(ids, store.viewer, true) : []).map((m) => [
      m.id,
      m.kind === "style"
        ? m.samples.slice(0, 3).map((s) => ({
            id: s,
            name: m.name.zh,
            url: `/materials/thumbs/${s}?size=256`,
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
      const shown: Picture[] = (o.materials || []).flatMap((id) => found.get(id) ?? []);
      return {
        label: o.label,
        ...(o.detail ? { detail: o.detail } : {}),
        ...(shown.length ? { pictures: shown } : {}),
      };
    }),
  }));
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Each tool's handler. "waiting" ends the execution: the run waits for the user. */
export const handlers: Record<
  string,
  (x: Execution, args: any, call: Call) => Promise<Outcome | "waiting">
> = {
  async ask_user(x, args, call) {
    if (call.batch.length !== 1) throw Error(`${call.item.name} must be the only tool call`);
    const { run, ctx } = x;
    run.questions = await questions(x.store, args);
    run.status = "waiting";
    run.steps.push({
      kind: "message",
      role: "assistant",
      asked: true,
      text: run.questions
        .map((q) => q.text + "\n" + q.options.map((o, i) => `${i + 1}. ${o.label}`).join("\n"))
        .join("\n\n"),
    });
    ctx.input.push({
      type: "function_call_output",
      call_id: call.item.call_id,
      output: "Questions shown. Waiting for the user.",
    });
    x.store.saveContext(run.id, ctx);
    x.emit();
    return "waiting";
  },

  async set_brief(x, args, call) {
    const { store, run, ctx } = x;
    // The ideas weighed stay on the step; the work keeps the brief.
    const { ideas: _, ...brief } = settleSchema.parse(args);
    const { work, style } = await setBrief(
      store,
      run.workId,
      brief,
      said(store, run.workId, ctx.settings.preferences),
      causeOf(run),
    );
    ctx.known = work.revision;
    x.showWork(work);
    const effects = await library.get(style.effects, store.userId, true);
    const cast = work.brief!.cast.length
      ? await find({ subjects: work.brief!.cast, style: style.id, kinds: ["picture"] }, store.userId)
      : undefined;
    Object.assign(call.step!, { revision: work.revision, ...(cast ? { found: cast.found } : {}) });
    return {
      output: {
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
        ...research(run),
        ...(guidesRead(ctx.input, call.batch).topics.size
          ? {}
          : { guides: "Read what this work needs with draw_guide before drawing: see # Guides." }),
      },
      images: cast?.images ?? [],
    };
  },

  async find_materials(x, args, call) {
    const request = findSchema.parse(args);
    const style = x.store.work(x.run.workId).brief?.style;
    const found = await find({ ...request, style: request.style ?? style, limit: 5 }, x.store.userId);
    Object.assign(call.step!, { found: found.found });
    return { output: found.output, images: found.images };
  },

  async draw_guide(x, args) {
    return { output: readGuides(guideSchema.parse(args), await kit(), guidesRead(x.ctx.input)) };
  },

  async generate_images(x, args, call) {
    const { store, run } = x;
    const { images: requests } = generateSchema.parse(args);
    const made = await develop(store, x.ctx.settings.image, store.work(run.workId), requests);
    x.developments.push(...made);
    const shown: Picture[] = made.map((d) => ({
      id: d.id,
      name: d.name,
      url: `/materials/files/${d.id}`,
      status: "developing",
    }));
    Object.assign(call.step!, { images: shown });
    for (const [i, d] of made.entries())
      void d.done.then(async (r) => {
        shown[i].status = r.status;
        spendImages(run, r);
        x.emit();
        // An open canvas redraws the picture with its measured content.
        const work = store.works().find((w) => w.id === run.workId);
        if (r.status === "ready" && work?.materials[d.id]) x.showWork(await freshen(work, store.viewer));
      });
    return {
      output: {
        developing: made.map((d, i) => ({ id: d.id, name: d.name, aspect: requests[i].aspect ?? "square" })),
        note: "Use these ids now. view_canvas waits for them; each is shown to you when it arrives.",
      },
    };
  },

  async read_work(x, _args, call) {
    const work = x.store.work(x.run.workId);
    x.ctx.known = work.revision;
    Object.assign(call.step!, { revision: work.revision });
    return { output: forAuthor(work) };
  },

  async write_work(x, args, call) {
    const { store, run, ctx } = x;
    const { amend, view, ...written } = args;
    if (amend && !ctx.held)
      throw new DomainError("没有等待修正的写入：amend 只用在一次写入被拒绝之后；这次把要改的内容直接写出来");
    // A correction lays over the write it corrects, and the two save as one revision.
    const edit = amend ? composed(ctx.held, written) : written;
    ctx.held = edit;
    let saved;
    try {
      saved = await writeWork(store, run.workId, edit, { cause: causeOf(run), scene: run.sceneId });
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      const problems: Problem[] = e instanceof EditRejected ? e.problems : [{ at: "", problem: e.message }];
      throw new Refusal(e.message, {
        error: `${problems.length} problem${problems.length > 1 ? "s" : ""} in this write`,
        problems,
        note: heldNote(edit),
      });
    }
    const { work, added, keptTitle, absent } = saved;
    ctx.held = undefined;
    ctx.known = work.revision;
    run.firstSceneMs ??= Date.now() - x.start;
    x.showWork(work);
    Object.assign(call.step!, { revision: work.revision, materials: added, writing: undefined });
    const output: Record<string, unknown> = {
      revision: work.revision,
      ...(added.length ? { materialsAdded: added } : {}),
      ...(keptTitle ? { title: `Kept the user's title "${work.title}".` } : {}),
      ...(absent.length
        ? { notThere: `Asked to remove what the work does not have: ${absent.join(", ")}.` }
        : {}),
      ...cardsUnread(work, ctx.input, call.batch),
    };
    if (!view || call.batch.some((c) => c.name === "view_canvas")) return { output };
    // Mark the write step done before the embedded view step starts waiting/capturing.
    if (call.step) call.step.status = "done";
    const viewArgs = typeof view === "object" && view ? view : {};
    const viewStep: ToolStep = {
      kind: "tool",
      id: `${call.item.call_id}:view`,
      status: "running",
      ...activity("view_canvas", viewArgs, run.sceneId),
    };
    run.steps.push(viewStep);
    x.emit();
    try {
      const viewed = await performView(x, viewArgs, viewStep);
      viewStep.status = "done";
      x.emit();
      return { output: { ...output, view: viewed.output }, images: viewed.images };
    } catch (e) {
      x.signal.throwIfAborted();
      const error = e instanceof Error ? e.message : String(e);
      Object.assign(viewStep, { status: "failed", error });
      x.emit();
      if (e instanceof Unavailable) throw e;
      return { output: { ...output, viewError: error } };
    }
  },

  async view_canvas(x, args, call) {
    const { batch, item } = call;
    if (
      batch.length !== 1 &&
      !(batch.at(-1) === item && batch.slice(0, -1).every((c) => c.name === "write_work"))
    )
      throw Error("view_canvas must be called alone or after write_work calls");
    if (call.writeError) throw Error(`view_canvas was skipped because write_work failed: ${call.writeError}`);
    return performView(x, args, call.step!);
  },

  async web_search(x, args, call) {
    const { run, signal } = x;
    const left = takeSearch(x, call);
    if (!left) return closed(x, call);
    const asked = searchSchema.parse(args).queries;
    // Past what is left, the later queries are not asked.
    const queries = asked.slice(0, left);
    const skipped = asked.slice(left);
    if (skipped.length && call.step?.kind === "tool" && call.step.name === "web_search") {
      call.step.queries = queries;
      x.emit();
    }
    counted(run, "search", queries.length);
    const service = x.ctx.settings.search.service!;
    const results = await Promise.all(
      queries.map(async (query) => {
        try {
          return { query, results: await searchWeb(service, query, signal) };
        } catch (e) {
          signal.throwIfAborted();
          return { query, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
    if (results.every((r) => "error" in r)) throw Error((results[0] as { error: string }).error);
    return {
      output: {
        results,
        ...(skipped.length
          ? {
              notAsked: skipped,
              note: "These queries were not asked: the request's search budget ran out. Work from what you found, and leave out what stays unconfirmed.",
            }
          : {}),
      },
    };
  },

  async open_page(x, args, call) {
    if (!takeSearch(x, call)) return closed(x, call);
    counted(x.run, "open_page");
    const { url } = openSchema.parse(args);
    return { output: { url, text: await readPage(x.ctx.settings.search.service!, url, x.signal) } };
  },
};
/** Waits for developing pictures, captures the canvas, and records the observation on `step`. */
async function performView(x: Execution, args: any, step: ToolStep): Promise<Outcome> {
  const { run, signal } = x;
  const pending = x.developments.filter((d) => !d.settled);
  run.status = "viewing";
  // The pictures still to come, shortened as each arrives, so the wait shows going.
  const left = () => {
    const names = pending.filter((d) => !d.settled).map((d) => d.name);
    return names.length ? names : undefined;
  };
  if (pending.length) {
    Object.assign(step, { waiting: left() });
    for (const d of pending)
      void d.done.then(() => {
        if (!("waiting" in step) || !step.waiting) return;
        Object.assign(step, { waiting: left() });
        x.emit();
      });
  }
  x.emit();
  try {
    await Promise.race([
      Promise.all(pending.map((d) => d.done)),
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    ]);
    const images = (await x.developed()).flatMap((m) => m.content);
    // The service may be restarting; after a few tries the run stops instead of
    // spending the author's turns on a look it cannot get.
    let result: Awaited<ReturnType<typeof observe>> | undefined;
    for (const wait of process.env.VITEST ? [1, 1, 0] : [2000, 6000, 0]) {
      try {
        result = await observe(x.store, run.workId, args, signal, {
          observations: run.observations,
          reported: (x.ctx.reported ??= {}),
        });
        break;
      } catch (e) {
        if (!(e instanceof Unavailable) || !wait) throw e;
        await pause(wait);
      }
    }
    if (!result) throw new Unavailable("画布查看服务不可用");
    run.observations.push(result.observation);
    Object.assign(step, {
      waiting: undefined,
      screenshots: result.observation.screenshots.map(({ name, url }) => ({ name, url })),
      errors: result.observation.errors,
    });
    return {
      output: { ...result.observation, ...research(run) },
      images: [...images, ...result.content],
    };
  } finally {
    run.status = "running";
  }
}
/** What the search budget had left before this call, which is already among the steps. */
function takeSearch(x: Execution, call: Call) {
  if (!x.ctx.settings.search.service) throw Error("This request has no search service.");
  return searchesLeft(x.run, call.step);
}
/** A search past the budget: it is taken off the steps and told search is closed. */
function closed(x: Execution, call: Call): Outcome {
  x.run.steps.splice(x.run.steps.indexOf(call.step!), 1);
  call.step = undefined;
  x.emit();
  return {
    output: {
      error:
        "Web search is closed for the rest of this request. Work from what you already found, and leave out what stays unconfirmed.",
    },
  };
}

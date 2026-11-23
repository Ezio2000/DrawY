import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage, type UserStore } from "../storage/index.ts";
import { register } from "../identity/index.ts";
import { fixture } from "../runtime/fixture.ts";
import { Agent } from "./index.ts";
import { SEARCH_LIMIT, steering } from "./spending.ts";
import { CONTEXT_FORMAT, withLessThought } from "./conversation.ts";
import { guidesRead, guides } from "./guides.ts";

import { settleSchema } from "./tools.ts";
import { restore, writeWork } from "../workspace/index.ts";
import { partialJson } from "./partial.ts";
import { CutOff, generate, type Item } from "../models/index.ts";
import { observe, Unavailable } from "../observation/index.ts";
import { boxOf, costOf, guideTopics, labelOf, modelCatalogSchema, type Run, type Work } from "../contracts/index.ts";
import { removeParts, setData } from "../editing/index.ts";
import { tracer } from "../trace/index.ts";
import { library as client, resolveStyle } from "../materials/index.ts";
import { serveLibrary, picture, solid } from "@drawy/materials/testing";
import type { DrawingMaterial } from "@drawy/materials/schema";

let library: ReturnType<typeof serveLibrary>;
/** A storage in a temporary directory, an author account in it, and a work to draw on,
 * saved as revision 1 with an empty child scene. */
let dir: string, db: Storage, store: UserStore, work: Work;
beforeEach(() => {
  library = serveLibrary(client.base);
  dir = mkdtempSync(join(tmpdir(), "drawy-agent-"));
  db = new Storage(dir);
  store = db.scoped(register(db, "author", "abcdef").id);
  work = fixture();
  work.revision = 0;
  work.scenes.child.modules = [];
  store.commit(work, 0, { kind: "edit" });
});
afterEach(() => {
  vi.mocked(generate).mockReset();
  vi.mocked(observe).mockClear();
  library.close();
  db.close();
  rmSync(dir, { recursive: true });
});
vi.mock("../models/index.ts", async (original) => ({
  ...(await original<object>()),
  generate: vi.fn(),
}));
const looked = async (s: UserStore, workId: string) => ({
  observation: {
    at: Date.now(),
    revision: s.work(workId).revision,
    sceneIds: ["root"],
    overview: true,
    screenshots: [],
    errors: [],
  },
  content: [{ type: "input_image", image_url: "data:image/png;base64,dmlzaWJsZQ==" }],
});
vi.mock("../observation/index.ts", async (original) => ({
  ...(await original<object>()),
  observe: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(observe).mockImplementation(looked as never);
});

/** A tool call, or for `finish` the closing words of a turn without calls. */
const item = (name: string, args: unknown, call_id = name): Item =>
  name === "finish"
    ? {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: (args as { message: string }).message }],
      }
    : {
        type: "function_call",
        name,
        arguments: typeof args === "string" ? args : JSON.stringify(args),
        call_id,
      };
type Turn = [string, unknown] | Item[] | ((turn: Parameters<typeof generate>[1]) => unknown);
/** Answers each model turn from the script: a call, a batch of items, or a function of what
 * the turn was sent. Returns the input every turn saw. */
function script(turns: Turn[]) {
  const seen: Item[][] = [];
  vi.mocked(generate).mockImplementation(async (_role, turn) => {
    seen.push(structuredClone(turn.input));
    const step = turns[seen.length - 1];
    if (!step) throw Error("the script ran out");
    if (typeof step === "function") return (await step(turn)) as never;
    const items = typeof step[0] === "string" ? [item(step[0], step[1], "c" + seen.length)] : step;
    return { items, usage: {}, response: {} } as never;
  });
  return seen;
}
const outputs = (input: Item[]) =>
  input.filter((x) => x.type === "function_call_output").map((x) => {
    try {
      return JSON.parse(x.output);
    } catch {
      return x.output;
    }
  });
const ask = { questions: [{ id: "q", text: "Which?", options: [{ label: "A" }, { label: "B" }] }] };
const newRun = (id = "run"): Run => {
  const run: Run = {
    id,
    workId: work.id,
    sceneId: "root",
    status: "running",
    steps: [{ kind: "message", role: "user", text: "改一下", materials: [] }],
    observations: [],
    startedAt: Date.now(),
  };
  store.saveRun(run);
  return run;
};
/** Executes a run straight from a conversation, as a request would. */
async function execute(input: Item[] = [], run = newRun()) {
  const ctx = { input, settings: store.settings(), generations: 0, format: CONTEXT_FORMAT };
  await new Agent(() => {}).execute(store, run, ctx, "request");
  return { run, ctx };
}
const waitFor = (runId: string, status: Run["status"]) =>
  vi.waitFor(() => expect(store.run(runId).status).toBe(status));
const brief = {
  subject: "苹果（水果）的结构",
  intent: "果皮、果肉、果核与种子",
  audience: "初中生",
  ideas: [
    { kind: "anatomy", idea: "一只纵切开的苹果，由外向内指出各层" },
    { kind: "change", idea: "从花到果的四个时刻，看各部分从哪里长出来" },
  ],
  concept: "一只纵切开的苹果占满画面，由外向内依次指出果皮、果肉、果核与种子",
  register: "formal",
  style: "textbook",
  direction: "剖面线描",
  cast: ["苹果", "种子"],
  basis: { subject: "苹果", intent: "苹果", register: "严谨" },
};

it("runs a request through: a brief on the user's words, a question, a batch, and an end only once the latest revision was seen", async () => {
  work.brief = null;
  for (const s of Object.values(work.scenes)) s.modules = [];
  store.commit(work, 1, { kind: "edit" });
  // The first look finds text too small to read; that holds the end once.
  vi.mocked(observe).mockImplementationOnce((async (s: UserStore, workId: string) => {
    const shot = await looked(s, workId);
    return { ...shot, observation: { ...shot.observation, smallestText: { root: 11 } } };
  }) as never);
  const seen = script([
    // "严谨" is not the user's word: the brief is refused.
    ["set_brief", brief],
    ["ask_user", { questions: [{ id: "focus", text: "画苹果的什么？", options: [{ label: "结构" }, { label: "生长", materials: ["crayon"] }] }] }],
    ["set_brief", { ...brief, basis: { subject: "苹果", intent: "“苹果”“结构”", register: "教科书" } }],
    ["finish", { message: "premature" }],
    [item("find_materials", { subjects: ["苹果"], kinds: ["picture"] }, "a"), item("draw_guide", { topics: ["copy"] }, "b")],
    [
      item("write_work", {
        drawings: [{ id: "fruit", name: "苹果", source: 'return api.material("apple")' }],
        scenes: [{ id: "root", clear: true }],
        modules: [{ id: "apple", label: "苹果", drawingId: "fruit", bounds: [0, 0, 200, 194] }],
      }, "w1"),
      item("view_canvas", {}, "v1"),
    ],
    ["finish", { message: "small" }],
    ["write_work", { title: "edited" }],
    ["finish", { message: "stale" }],
    ["view_canvas", {}],
    ["finish", { message: "done" }],
  ]);
  const agent = new Agent(() => {});
  const run = await agent.start(store, work.id, "root", "苹果");
  await waitFor(run.id, "waiting");
  expect(outputs(seen[1]).at(-1).error).toContain("不是用户说过的话");
  expect(store.work(work.id).brief).toBeNull();
  // A style option shows the style's own samples.
  expect(store.run(run.id).questions![0].options[1].pictures![0]).toMatchObject({
    id: "lighthouse-crayon",
    url: "/materials/thumbs/lighthouse-crayon?size=256",
  });
  await agent.resume(store, run.id, "画苹果的什么？\n→ 结构，教科书那样");
  await waitFor(run.id, "completed");

  const saved = store.work(work.id);
  // The concept is the author's own and needs no quote; the ideas stay with the run.
  expect(saved.brief).toMatchObject({ style: "textbook", concept: brief.concept });
  expect(saved.brief).not.toHaveProperty("ideas");
  expect(settleSchema.safeParse({ ...brief, ideas: [brief.ideas[0], { ...brief.ideas[1], kind: "anatomy" }] }).success).toBe(false);
  expect(saved.style.font).toContain("PingFang");
  expect(saved.title).toBe("edited");
  // The cast is searched in the brief's style and shown as pictures.
  const settled = outputs(seen[3]).at(-1);
  expect(settled.cast[0].hits[0]).toMatchObject({ id: "apple-textbook", style: "textbook" });
  expect(seen[3].at(-1)!.content.some((c: Item) => c.type === "input_image")).toBe(true);
  // Every call of a batch is answered before its pictures.
  const batch = seen[5].slice(-3).map((i) => i.call_id ?? i.role);
  expect(batch).toEqual(["a", "b", "user"]);
  // Closing words are answered with what is missing: the root drawn, too-small text
  // (once), and a look at the latest revision.
  const held = seen.flatMap((input) => input.filter((i) => String(i.content).startsWith("The work is not done yet: ")));
  const reasons = [...new Set(held.map((i) => i.content))];
  expect(reasons).toHaveLength(3);
  expect(reasons[0]).toContain("请先完成根场景");
  expect(reasons[1]).toContain("root 11px");
  expect(reasons[2]).toContain("查看");

  const steps = store.run(run.id).steps;
  expect(steps.filter((s) => s.kind === "message").map((s) => s.text)).toEqual([
    "苹果",
    "画苹果的什么？\n1. 结构\n2. 生长",
    "画苹果的什么？\n→ 结构，教科书那样",
    "premature",
    "small",
    "stale",
    "done",
  ]);
  expect(steps.find((s) => s.kind === "tool" && s.name === "set_brief" && s.status === "done")).toMatchObject({
    revision: 3,
    ideas: brief.ideas.map((i) => i.idea),
    concept: brief.concept,
    found: [{ subject: "苹果" }, { subject: "种子" }],
  });
  expect(store.run(run.id).observations.map((o) => o.revision)).toEqual([4, 5]);
  // The pictures each look took are in the saved conversation.
  expect(store.context(run.id).input.some((x: Item) => Array.isArray(x.content) && x.content.some((v: Item) => v.type === "input_image"))).toBe(true);
});

it("shows a turn's thinking, words and streamed layout as steps before the write is saved", async () => {
  expect(partialJson('{"a":[1,2')).toEqual({ a: [1] });
  expect(partialJson('[{"b":{"x":1,"w":2}},{"b":{"x":')).toEqual([{ b: { x: 1, w: 2 } }, { b: {} }]);
  expect(partialJson('{"q":"a\\"],"')).toEqual({});
  const scene = work.scenes.root,
    flat = scene.modules.map(({ bounds, ...m }) => ({ ...m, bounds: boxOf(bounds) })),
    args = JSON.stringify({ modules: flat, links: scene.links, drawings: Object.values(work.drawings) }),
    cut = args.indexOf(JSON.stringify(flat[3])),
    writing = Object.values(work.drawings)[0],
    within = args.indexOf(JSON.stringify(writing.source)) + 8;
  const [first, second] = scene.modules;
  const moved = { x: 5, y: 6, width: 70, height: 80 };
  script([
    async ({ onEvent }) => {
      onEvent!({ type: "response.reasoning_summary_part.added" });
      onEvent!({ type: "response.reasoning_summary_text.delta", delta: "**Laying" });
      onEvent!({ type: "response.reasoning_summary_text.delta", delta: " out**" });
      onEvent!({ type: "response.output_item.added", item: { id: "m", type: "message" } });
      onEvent!({ type: "response.output_text.delta", delta: "先起稿" });
      onEvent!({ type: "response.output_item.added", item: { id: "w", type: "function_call", name: "write_work", call_id: "w" } });
      for (const delta of [args.slice(0, cut), args.slice(cut, within), args.slice(within)]) {
        onEvent!({ type: "response.function_call_arguments.delta", item_id: "w", delta });
        await new Promise((r) => setTimeout(r, 300));
      }
      onEvent!({ type: "response.output_item.done", item: { id: "w" } });
      return { items: [{ type: "message", content: [{ type: "output_text", text: "先起稿" }] }, item("write_work", args, "w")], usage: {}, response: {} };
    },
    // A partial write: one module moved, another's data changed, the order swapped.
    ["write_work", { scenes: [{ id: "root", order: [second.id, first.id] }], modules: [{ id: first.id, bounds: boxOf(moved) }, { id: second.id, data: { extra: 1 } }] }],
    ["view_canvas", {}],
    ["finish", { message: "done" }],
  ]);
  const laid: number[] = [],
    written: (string | undefined)[] = [];
  const run = newRun();
  await new Agent((_user, event: any) => {
    const step = event.run?.steps.find((s: any) => s.name === "write_work" && s.status === "running");
    if (step) {
      laid.push(step.scenes[0]?.modules.length);
      written.push(step.writing);
    }
  }).execute(store, run, { input: [], settings: store.settings(), generations: 0 }, "request");
  expect(run.status).toBe("completed");
  // The layout showed part way, and which drawing was being written.
  expect(laid).toContain(3);
  expect(written).toContain(writing.id);
  expect(run.steps.slice(1, 4)).toMatchObject([
    { kind: "thinking", text: "**Laying out**" },
    { kind: "message", role: "assistant", text: "先起稿" },
    {
      status: "done",
      drawings: Object.keys(work.drawings),
      scenes: [{ id: "root", modules: scene.modules.map(({ id, label, bounds, data }) => ({ id, label: labelOf({ id: "", label, data }), bounds })) }],
    },
  ]);
  // A partial write shows only what it changed, laying out what moved.
  expect(run.steps.filter((s) => s.kind === "tool" && s.name === "write_work")[1]).toMatchObject({
    status: "done",
    revision: 3,
    changed: 2,
    scenes: [{ id: "root", modules: [{ id: first.id, bounds: moved }] }],
  });
  const saved = store.work(work.id).scenes.root;
  expect(saved.modules.find((m) => m.id === second.id)!.data.extra).toBe(1);
  expect(saved.modules.slice(0, 2).map((m) => m.id)).toEqual([second.id, first.id]);
});

it("continues the conversation across answers and requests, with the user's preferences told only when they change", async () => {
  const reference = await client.ingest(
    await picture(),
    "image/png",
    { type: "object", name: { zh: "参考", en: "reference" }, style: null, origin: { kind: "upload" } },
    store.userId,
  );
  const instructions: string[] = [];
  vi.mocked(generate).mockImplementation(async (_role, turn) => {
    instructions.push(turn.instructions);
    return { items: [item("ask_user", ask, crypto.randomUUID())], usage: {}, response: {} };
  });
  const agent = new Agent(() => {});
  store.saveOwnSettings({ ...store.ownSettings(), preferences: "用中文标注" });
  const run = await agent.start(store, work.id, "root", "Match this", [reference.id]);
  await waitFor(run.id, "waiting");
  const initial = store.context(run.id).input;
  expect(initial.slice(0, 3).map((i: Item) => (typeof i.content === "string" ? i.content.split("\n")[0] : i.content[0].text))).toEqual([
    "User preferences: 用中文标注",
    "Match this",
    "Current scene: root",
  ]);
  expect(initial[2].content).toContain("Current work:");
  // An answer with a picture goes on from the exact conversation.
  await agent.resume(store, run.id, "Five panels", [reference.id]);
  await waitFor(run.id, "waiting");
  const answered = store.context(run.id).input;
  expect(answered.slice(0, initial.length)).toEqual(initial);
  expect(answered[initial.length].content[1].text).toMatch(/^Attached picture /);
  expect(answered[initial.length].content[2].image_url).toMatch(/^data:image\/webp;base64,/);
  expect(store.run(run.id).steps.findLast((s) => s.kind === "message" && s.role === "user")).toMatchObject({ materials: [reference.id] });
  agent.cancel(store, run.id);
  // The next request continues it: the preferences are not told again, and the work is as it was.
  const next = await agent.start(store, work.id, "root", "Again");
  await waitFor(next.id, "waiting");
  const continued = store.context(next.id).input;
  expect(continued.slice(0, answered.length)).toEqual(answered);
  const again = continued.findIndex((i: Item) => Array.isArray(i.content) && i.content[0].text === "Again");
  expect(continued.slice(again, again + 2).map((i: Item) => i.content)).toEqual([
    [{ type: "input_text", text: "Again" }],
    "Current scene: root\nThe work is as you last saw it (revision 1).",
  ]);
  agent.cancel(store, next.id);
  store.saveOwnSettings({ ...store.ownSettings(), preferences: "少用红色" });
  const third = await agent.start(store, work.id, "root", "Once more");
  await waitFor(third.id, "waiting");
  expect(store.context(third.id).input.filter((i: Item) => String(i.content).startsWith("User preferences: ")).map((i: Item) => i.content)).toEqual([
    "User preferences: 用中文标注",
    "User preferences: 少用红色",
  ]);
  agent.cancel(store, third.id);
  // The instructions are the same whatever the user prefers.
  expect(new Set(instructions).size).toBe(1);
  expect(instructions[0]).not.toContain("用中文标注");

  // A conversation saved in an older format starts over from what was asked and the whole work.
  store.saveContext(third.id, { ...store.context(third.id), format: 1 });
  const fresh = await agent.start(store, work.id, "root", "再加一层");
  await waitFor(fresh.id, "waiting");
  const words = JSON.stringify(store.context(fresh.id).input);
  expect(words).toContain("Earlier requests on this work, oldest first:\\n- Match this\\n- Five panels\\n- Again\\n- Once more");
  expect(words).toContain("Current work:");
  expect(store.context(fresh.id).input.filter((i: Item) => i.type === "function_call")).toHaveLength(1);
});

it("catches a continuing conversation up with what the user changed themselves, and only that", async () => {
  vi.mocked(generate).mockImplementation(async () => ({ items: [item("ask_user", ask, crypto.randomUUID())], usage: {}, response: {} }));
  const agent = new Agent(() => {});
  const told = async (prompt: string) => {
    const run = await agent.start(store, work.id, "root", prompt);
    await waitFor(run.id, "waiting");
    agent.cancel(store, run.id);
    return store.context(run.id).input.findLast((i: Item) => typeof i.content === "string" && i.content.includes("Current scene:")).content as string;
  };
  const delta = (text: string) => JSON.parse(text.match(/\nChanged: (.*)\nCurrent scene: root$/)![1]);
  const byHand = async () => {
    for (const edit of [
      (w: Work) => setData(w, "root", "level-0", { color: "#000000" }),
      (w: Work) => removeParts(w, "root", ["control"]),
    ])
      await writeWork(store, work.id, edit(store.work(work.id)), { cause: { kind: "edit" } });
  };
  expect(await told("Draw")).toContain("Current work:");
  await byHand();
  const changes = await told("Continue");
  expect(changes).toMatch(
    /^Since your last turn the user changed the work themselves \(revision 1 to 3\)\.[^\n]*\n- scene root: changed level-0; removed control; interaction checks changed\n/,
  );
  expect(changes).not.toContain("Current work:");
  const now = store.work(work.id).scenes.root;
  const level = now.modules.find((m) => m.id === "level-0")!;
  // Changed parts come in the short form the author writes.
  expect(delta(changes).scenes.root).toMatchObject({
    modules: [expect.objectContaining({ id: "level-0", data: level.data, bounds: boxOf(level.bounds) })],
    order: now.modules.map((m) => m.id),
    removed: ["control"],
  });
  expect(delta(changes).drawings).toBeUndefined();
  // Restoring an earlier draft may change only the checks; the author still gets their value.
  const before = store.work(work.id);
  await writeWork(store, work.id, { scenes: [{ id: "root", checks: [{ moduleId: "level-0", selector: ".inspect" }] }] }, { cause: { kind: "edit" } });
  expect(delta(await told("Check this")).scenes.root.checks).toEqual([{ moduleId: "level-0", selector: ".inspect" }]);
  restore(store, work.id, before.revision);
  const restored = delta(await told("Continue from the earlier draft"));
  expect(restored.scenes.root.checks).toEqual(before.scenes.root.checks);
  expect(restored.scenes.root.modules).toEqual([]);
  // A revision the author saved that this conversation does not hold: the whole work, with
  // what the user changed since that author's save.
  await writeWork(store, work.id, { title: "drawn" }, { cause: { kind: "run", runId: "elsewhere", prompt: "draw" } });
  await writeWork(store, work.id, setData(store.work(work.id), "root", "level-1", { color: "#000000" }), { cause: { kind: "edit" } });
  const whole = await told("More");
  expect(whole).toMatch(/^Since your last turn the user changed the work themselves \(revision 6 to 7\)\.[^\n]*\n- scene root: changed level-1\nCurrent scene: root\nCurrent work: /);
});

it("compacts the conversation at its budget, and goes on without old pictures when a summary fails", async () => {
  const reference = await client.ingest(
    await picture(),
    "image/png",
    { type: "object", name: { zh: "参考", en: "reference" }, style: null, origin: { kind: "upload" } },
    store.userId,
  );
  const run = newRun("budget");
  run.steps[0] = { kind: "message", role: "user", text: "Match", materials: [reference.id] };
  store.saveRun(run);
  const long = [
    { role: "user", content: "x".repeat(600001) },
    { type: "configuration_update", reasoning: { effort: "max" } },
  ];
  const requests: { instructions: string; tools: unknown; cacheKey?: string }[] = [];
  const agent = new Agent(() => {});
  script([
    ({ input, tools, budget, instructions, cacheKey }) => {
      requests.push({ instructions, tools, cacheKey });
      // A summary is asked of the conversation as it stands, after it, so the cached prefix
      // is read rather than paid for again; with little thought and room to finish.
      expect(input.slice(0, long.length)).toEqual(long);
      expect(String(input.at(-1)!.content)).toContain("Summarize this drawing conversation");
      expect(input.at(-2)).toEqual({ type: "configuration_update", reasoning: { effort: "low" } });
      expect(budget).toBe(16384);
      return { items: [item("finish", { message: "Keep five panels" })], usage: {}, response: {} };
    },
    ({ input, tools, instructions, cacheKey }) => {
      requests.push({ instructions, tools, cacheKey });
      // The standing preferences, then the summary with the original references, then the work.
      expect(input[0].content).toBe("User preferences: none");
      expect(input[1].content[0].text).toContain("Keep five panels");
      expect(input[1].content[1].text).toContain(reference.id);
      expect(input[1].content[2].image_url).toMatch(/^data:image\/webp/);
      expect(input[2].content).toContain(work.id);
      agent.cancel(store, run.id);
      return { items: ["one", "two"].map((id) => item("read_work", {}, id)), usage: {}, response: {} };
    },
  ]);
  const ctx = { input: structuredClone(long) as Item[], settings: store.settings(), generations: 0, format: CONTEXT_FORMAT };
  await agent.execute(store, run, ctx, "request");
  expect(requests[0]).toEqual(requests[1]);
  expect(store.run(run.id).status).toBe("cancelled");
  // A cancelled batch still answers every call.
  expect(store.context(run.id).input.filter((i: Item) => i.type === "function_call_output").map((i: Item) => i.call_id)).toEqual(["one", "two"]);

  // When the summary fails, the run goes on with only the latest two pictures.
  const shot = (n: number) => ({
    role: "user",
    content: [
      { type: "input_text", text: "look " + n },
      { type: "input_image", image_url: "data:image/webp;base64,AAAA" },
    ],
  });
  let summaries = 0;
  const seen: Item[][] = [];
  vi.mocked(generate).mockImplementation(async (_role, { input }) => {
    if (String(input.at(-1)?.content).includes("Summarize this drawing conversation")) {
      summaries++;
      throw Error("模型输出被截断");
    }
    seen.push(input);
    if (seen.length === 1)
      return {
        // Encrypted reasoning reads as far more text than it costs.
        items: [{ type: "reasoning", encrypted_content: "e".repeat(600000) }, item("read_work", {}, "r")],
        usage: { input_tokens: 190000, output_tokens: 100 },
        response: {},
      };
    return { items: [item("ask_user", ask)], usage: {}, response: {} };
  });
  const { run: fallback } = await execute([{ role: "user", content: "x".repeat(600001) }, shot(1), shot(2), shot(3)], newRun("fallback"));
  expect(fallback.status).toBe("waiting");
  expect(seen[0].filter((i) => Array.isArray(i.content) && i.content.some((c: Item) => c.type === "input_image")).map((i) => i.content[0].text)).toEqual(["look 2", "look 3"]);
  // The second turn did not summarize again: the reported 190k tokens plus what was added
  // stay below the threshold.
  expect(summaries).toBe(1);
  expect(fallback.usage!.failed).toMatchObject({ attempts: 1 });
});

it("bills every model attempt: a broken stream asked again, a refused request, and a turn cut off", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true, advanceTimeDelta: 500 });
  try {
    const run = newRun();
    const ctx = { input: [] as Item[], settings: store.settings(), generations: 0, format: CONTEXT_FORMAT };
    ctx.settings.prices = { ...ctx.settings.prices, author: { input: 4, cached: 0.2, cacheWrite: 5, output: 20 } };
    script([
      ({ onEvent }) => {
        // The input is reported as the stream opens; the output never is.
        onEvent!({ type: "response.usage", usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 900, cache_write_tokens: 100 }, output_tokens: 0 } });
        onEvent!({ type: "response.reasoning_summary_part.added" });
        onEvent!({ type: "response.reasoning_summary_text.delta", delta: "half a thought" });
        onEvent!({ type: "response.function_call_arguments.delta", item_id: "x", delta: "a".repeat(300) });
        throw Error("模型连接在完成前中断");
      },
      () => ({ items: [item("view_canvas", {})], usage: { input_tokens: 50, output_tokens: 5 }, response: {} }),
      ["finish", { message: "好了" }],
    ]);
    const going = new Agent(() => {}).execute(store, run, ctx, "request");
    await vi.advanceTimersByTimeAsync(3000);
    await going;
    expect(run.status).toBe("completed");
    // The broken attempt's steps were taken back.
    expect(run.steps.some((s) => s.kind === "thinking")).toBe(false);
    expect(run.usage).toMatchObject({
      input: 50,
      output: 5,
      failed: { attempts: 1, input: 1000, cached: 900, cacheWrite: 100, output: 105, estimated: 105, invalidCalls: 0, images: 0 },
    });
    expect(run.usage!.failed!.ms).toBeGreaterThanOrEqual(2000);
    const cost = costOf(run.usage, run.prices)!;
    // 900 read, 100 written and 105 written out (a third of the characters that arrived).
    expect(cost.failed).toBeCloseTo((900 * 0.2 + 100 * 5 + 105 * 20) / 1e6, 8);
    expect(cost.total).toBeCloseTo(cost.author + cost.search + cost.image + cost.failed, 8);
  } finally {
    vi.useRealTimers();
  }
  // A request refused is not asked again, and is counted at no cost.
  script([() => Promise.reject(Error("模型请求 400: 不行"))]);
  const { run: refused } = await execute([], newRun("refused"));
  expect(refused.status).toBe("failed");
  expect(refused.usage!.failed).toMatchObject({ attempts: 1, input: 0, output: 0, estimated: 0 });
  expect(costOf(refused.usage, refused.prices)!.failed).toBe(0);
  // A turn cut off with words written is spent all the same, and not asked again.
  script([() => Promise.reject(new CutOff("max_output_tokens", false, { input_tokens: 100, output_tokens: 32768 }))]);
  const { run: cut } = await execute([], newRun("cut"));
  expect(cut.error).toContain("截断");
  expect(cut.usage).toMatchObject({ input: 0, output: 0, failed: { attempts: 1, input: 100, output: 32768, estimated: 0 } });
});

it("bills pictures developing while the author composes, and holds the end until they were seen", async () => {
  const catalog = db.models();
  Object.assign(catalog.painters[0], { credential: "test", baseUrl: "https://example.invalid" });
  catalog.painters[0].models[0].prices = { image: 1, textInput: 5, imageInput: 8, output: 30, textOutput: 0 };
  db.saveModels(catalog);
  let paint!: () => void;
  const painted = new Promise<void>((r) => (paint = r));
  const [png, box] = [await picture(), await solid()];
  const paints: string[] = [];
  library.route(async (_url, init) => {
    const body = init?.body;
    const prompt = String(body instanceof FormData ? body.get("prompt") : JSON.parse(String(body)).prompt);
    const whale = prompt.includes("whale");
    paints.push(whale ? "whale" : "boat");
    if (whale) await painted;
    // The boat comes out with a background; painted again, that attempt fails.
    else if (paints.filter((p) => p === "boat").length === 2) return new Response("failed", { status: 400 });
    return Response.json({
      data: [{ b64_json: (whale ? png : box).toString("base64") }],
      usage: { input_tokens: 10, input_tokens_details: { text_tokens: 4, image_tokens: 6 }, output_tokens: 100 },
    });
  });
  const seen = script([
    ["generate_images", { images: [
      { name: { zh: "鲸", en: "whale" }, type: "object", depicts: "a blue whale, side view", aspect: "landscape" },
      { name: { zh: "船", en: "boat" }, type: "object", depicts: "a boat" },
    ] }],
    ["finish", { message: "too soon" }],
    ["view_canvas", {}],
    ["finish", { message: "done" }],
  ]);
  const going = execute();
  await vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(2));
  const [whale] = outputs(seen[1])[0].developing;
  expect(whale.id).toMatch(/^g-whale-/);
  // The picture is usable at once, before it exists.
  const { work: written } = await writeWork(store, work.id, { drawings: [{ id: "whale", name: "鲸", source: `return api.material("${whale.id}")` }] }, { cause: { kind: "edit" } });
  expect(written.materials[whale.id]).toMatchObject({ status: "developing" });
  await vi.waitFor(() => expect(seen.length).toBe(3));
  expect(String(seen[2].at(-1)!.content)).toContain("图片仍在生成");
  paint();
  const { run } = await going;
  expect(run.status).toBe("completed");
  // The finished pictures were shown before the final look.
  const shown = seen[3].find((x) => x.role === "user" && x.content?.[0]?.text?.startsWith?.("Pictures:"))!;
  expect(shown.content[0].text).toContain(whale.id);
  expect(shown.content[0].text).toContain("failed");
  expect(shown.content.some((c: Item) => c.type === "input_image")).toBe(true);
  expect(run.steps.find((s) => s.kind === "tool" && s.name === "generate_images")).toMatchObject({
    images: [{ id: whale.id, status: "ready" }, { status: "failed" }],
  });
  // Every picture returned is paid for, the boat's first attempt too, split as priced.
  expect(paints.sort()).toEqual(["boat", "boat", "whale"]);
  expect(run.usage?.images).toEqual({ count: 2, input: 20, output: 200, textInput: 8, imageInput: 12, textOutput: 0 });
  expect(run.usage?.failed?.images).toBe(1);
  expect(costOf(run.usage, run.prices)?.image).toBeCloseTo(2 * (1 + 3068 / 1e6), 8);
  expect(store.run(run.id).usage).toEqual(run.usage);
});

it("keeps web search within the request's budget without changing the tools it lists", () => {
  const search = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: "tool" as const, id: "ws" + i, status: "done" as const, name: "web_search" as const, queries: ["q"], urls: [] }));
  const draft = { kind: "tool" as const, id: "w", status: "done" as const, name: "write_work" as const, drawings: [], scenes: [], details: [], materials: [], removed: 0, revision: 2 };
  const run = (steps: Run["steps"]): Run => ({ id: "r", workId: "w", sceneId: "root", status: "running", steps, observations: [], startedAt: 0 });
  const hosted = [{ type: "function", name: "write_work" }, { type: "function", name: "view_canvas" }, { type: "web_search" }];
  const onlyDrawing = { tool_choice: { type: "allowed_tools", mode: "auto", tools: [{ type: "function", name: "write_work" }, { type: "function", name: "view_canvas" }] } };
  // Research before the first draft is free up to the request's limit; once a draft is
  // saved, a look gets a couple of follow-up calls, then search closes.
  expect(steering(run(search(3)), hosted)).toEqual({ max_tool_calls: SEARCH_LIMIT - 3 });
  expect(steering(run(search(SEARCH_LIMIT)), hosted)).toEqual(onlyDrawing);
  expect(steering(run([...search(1), draft]), hosted)).toEqual({ max_tool_calls: 2 });
  expect(steering(run([...search(1), draft, ...search(2)]), hosted)).toEqual(onlyDrawing);
  expect(steering(run([draft, ...search(5)]), hosted.slice(0, 2))).toEqual({});
  // The service's search is steered the same way, except where the format has no way to:
  // Chat Completions, Messages, and a Responses service without tool limits.
  const service = [{ type: "function", name: "write_work" }, { type: "function", name: "web_search" }, { type: "function", name: "open_page" }];
  expect(steering(run(search(2)), service)).toEqual({});
  expect(steering(run(search(SEARCH_LIMIT)), service)).toEqual({ tool_choice: { type: "allowed_tools", mode: "auto", tools: [{ type: "function", name: "write_work" }] } });
  for (const role of [{ protocol: "chat", toolLimits: true }, { protocol: "anthropic", toolLimits: true }, { protocol: "responses", toolLimits: false }] as const)
    expect(steering(run(search(SEARCH_LIMIT)), service, role)).toEqual({});
});

it("searches through the search service, counting each query against the budget", async () => {
  const catalog = db.models();
  Object.assign(catalog.writers[0].models[0], { name: "DeepSeek", protocol: "chat", model: "deepseek-flash", builtinSearch: false, speeds: [] });
  catalog.searches = [{ id: "web", name: "DeepSeek Search", provider: "deepseek", baseUrl: "https://search.invalid/v1/tools", credential: "k", prices: { query: 0.01, page: 0.02 } }];
  catalog.defaults.web = "web";
  db.saveModels(modelCatalogSchema.parse(catalog));
  const earlier = Array.from({ length: SEARCH_LIMIT - 4 }, (_, i) => ({ kind: "tool" as const, id: "old" + i, status: "done" as const, name: "web_search" as const, queries: ["q"], urls: [] }));
  const run = newRun("service-run");
  run.steps.push(...earlier);
  const asked: { url: string; body: any }[] = [];
  library.route(async (url, init) => {
    asked.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return String(url).endsWith("/search")
      ? Response.json({ results: [{ title: "Release", url: "https://news.invalid/a", snippet: "It shipped.", date: "2026-04-24T00:00:00Z" }] })
      : Response.json({ content: "The whole page." });
  });
  const seen = script([
    ({ tools = [] }: { tools?: Item[] }) => {
      // Only the service's search is offered, never the provider's own as well.
      expect(tools.some((t) => t.type === "web_search")).toBe(false);
      expect(tools.filter((t) => ["web_search", "open_page"].includes(t.name))).toHaveLength(2);
      return { items: [item("web_search", { queries: ["release date", "launch city"] }, "c1")], usage: {}, response: {} };
    },
    ["open_page", { url: "https://news.invalid/a" }],
    ["web_search", { queries: ["once more", "and again"] }],
    ["web_search", { queries: ["last"] }],
    ["view_canvas", {}],
    ["finish", { message: "done" }],
  ]);
  await execute([], run);
  expect(run.status).toBe("completed");
  expect(asked).toEqual([
    { url: "https://search.invalid/v1/tools/search", body: { query: "release date" } },
    { url: "https://search.invalid/v1/tools/search", body: { query: "launch city" } },
    { url: "https://search.invalid/v1/tools/fetch", body: { url: "https://news.invalid/a" } },
    { url: "https://search.invalid/v1/tools/search", body: { query: "once more" } },
  ]);
  const [found, page, budgeted, closed, look] = outputs(seen.at(-1)!);
  expect(found.results[0]).toEqual({ query: "release date", results: [{ title: "Release", url: "https://news.invalid/a", snippet: "It shipped.", date: "2026-04-24" }] });
  expect(page).toEqual({ url: "https://news.invalid/a", text: "The whole page." });
  // The queries past the budget are not asked, and the author is told which.
  expect(budgeted.results.map((r: any) => r.query)).toEqual(["once more"]);
  expect(budgeted.notAsked).toEqual(["and again"]);
  // Past the budget a call is refused and leaves no step behind.
  expect(closed.error).toContain("closed");
  expect(look.research).toMatchObject({ searchQueriesLeft: 0, pagesOpened: ["https://news.invalid/a"] });
  const searches = run.steps.filter((s) => s.kind === "tool" && s.name === "web_search");
  expect(searches).toHaveLength(SEARCH_LIMIT - 1);
  expect(searches.slice(-3)).toEqual([
    { kind: "tool", id: "c1", status: "done", name: "web_search", queries: ["release date", "launch city"], urls: [], action: "search" },
    { kind: "tool", id: "c2", status: "done", name: "web_search", queries: [], urls: ["https://news.invalid/a"], action: "open_page" },
    { kind: "tool", id: "c3", status: "done", name: "web_search", queries: ["once more"], urls: [], action: "search" },
  ]);
  expect(run.usage).toMatchObject({ searches: 3, pages: 1 });
  expect(run.services).toEqual({ label: "默认", author: "DeepSeek", model: "deepseek-flash", effort: "medium", speed: "default", search: "service", searchBy: "DeepSeek Search", image: "gpt-image-2.5-sunburst[api]" });
  expect(costOf(run.usage, run.prices)!.search).toBeCloseTo(3 * 0.01 + 0.02);
});

it("keeps hosted tools in the conversation as steps, records them under their turn and counts them", async () => {
  tracer.open(dir);
  try {
    const run = newRun("hosted-run");
    tracer.begin({ id: run.id, userId: store.userId, workId: work.id, title: "t", prompt: "p", status: "running", startedAt: run.startedAt });
    const code = { type: "code_interpreter_call", id: "ci_1", status: "completed", code: "print(6 * 7)" };
    const search = { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "open_page", url: "https://example.com/a" } };
    const annotation = { type: "url_citation", start_index: 2, end_index: 5, url: "https://openai.com/", title: "OpenAI" };
    const message = { type: "message", role: "assistant", content: [{ type: "output_text", text: "说明[1]", annotations: [annotation] }] };
    const usage = (n: number) => ({ input_tokens: n, output_tokens: 10, input_tokens_details: { cached_tokens: n / 2 }, output_tokens_details: { reasoning_tokens: 4 } });
    const states: string[] = [];
    const seen = script([
      ({ tools = [], onEvent }: { tools?: Item[]; onEvent?: (e: Item) => void }) => {
        expect(tools.filter((t) => t.type === "web_search")).toEqual([{ type: "web_search", search_context_size: "low" }]);
        for (const it of [code, search]) {
          onEvent!({ type: "response.output_item.added", item: { type: it.type, id: it.id } });
          onEvent!({ type: "response.output_item.done", item: it });
        }
        return { items: [code, search, message], usage: usage(100), response: {} };
      },
      () => ({ items: [item("view_canvas", {})], usage: usage(200), response: {} }),
      () => ({ items: [item("finish", { message: "done" })], usage: usage(200), response: {} }),
    ]);
    await tracer.within(run.id, () =>
      new Agent((_user, event: any) => {
        const step = event.run?.steps.find((s: any) => s.id === "ws_1");
        if (step) states.push(step.status);
      }).execute(store, run, { input: [], settings: store.settings(), generations: 0 }, "request"),
    );
    expect(run.status).toBe("completed");
    expect(states).toContain("running");
    // The provider's calls stay in the conversation and are never answered here.
    expect(seen[1]).toEqual(expect.arrayContaining([code, search, message]));
    expect(seen[1].some((i) => i.type === "function_call_output" && i.call_id === "ws_1")).toBe(false);
    expect(run.steps).toContainEqual({ kind: "tool", id: "ci_1", status: "done", name: "hosted", tool: "code_interpreter", detail: "print(6 * 7)" });
    expect(run.steps).toContainEqual({ kind: "tool", id: "ws_1", status: "done", name: "web_search", queries: [], urls: ["https://example.com/a"], action: "open_page" });
    expect(run.steps).toContainEqual({ kind: "message", role: "assistant", text: "说明[1]", citations: [{ start: 2, end: 5, url: "https://openai.com/", title: "OpenAI" }] });
    expect(run.usage).toEqual({ input: 500, cached: 250, output: 30, reasoning: 12, pages: 1, hosted: { code_interpreter: 1, web_search: 1 } });
    // A look tells the author what it has already searched, to judge against it.
    expect(outputs(seen[2])[0].research).toMatchObject({ calls: 1, pagesOpened: ["https://example.com/a"] });
    const { spans, trace } = tracer.get(store.userId, run.id)!;
    const first = spans.find((s) => s.kind === "turn")!;
    expect(spans.filter((s) => s.attrs.hosted).map((s) => [s.kind, s.name, s.parentId])).toEqual([
      ["tool", "code_interpreter", first.id],
      ["tool", "web_search", first.id],
    ]);
    const meter = (key: string) => trace.meters.find((m) => m.key === key);
    expect(meter("web_search")).toMatchObject({ kind: "tool", calls: 1 });
    expect(meter("model")).toMatchObject({ kind: "turn", calls: 3, input: 500, cached: 250, output: 30 });
    // The timeline has each span's brief; the whole record comes one span at a time.
    expect(first.attrs.output).toBeUndefined();
    const second = spans.filter((s) => s.kind === "turn")[1];
    expect(tracer.whole(store.userId, run.id, second.id)!.context!.items).toEqual(expect.arrayContaining([code, search]));
    expect(tracer.whole("someone-else", run.id, second.id)).toBeUndefined();
  } finally {
    tracer.close();
  }
});

it("holds a refused write for amending, so a correction carries only what was wrong and saves as one revision", async () => {
  const module = (id: string, x = 0) => ({ id, bounds: [x, 0, 100, 60], drawingId: "tier", data: { color: "#000", label: id, tip: "" } });
  const big = {
    modules: Array.from({ length: 12 }, (_, i) => module(`m${i}`, i * 120)),
    links: [
      { id: "ok", from: "m0", to: "m1" },
      { id: "a", from: "m1", to: "ghost" },
      { id: "b", from: "gone", to: "m2" },
    ],
  };
  const seen = script([
    ["write_work", { amend: true, title: "x" }],
    ["write_work", big],
    // Corrected in two steps.
    ["write_work", { amend: true, links: [{ id: "a", to: "m3" }] }],
    ["write_work", { amend: true, links: [{ id: "b", from: "m4" }] }],
    // A later write without amend replaces what was held.
    ["write_work", { links: [{ id: "c", from: "x", to: "y" }] }],
    ["write_work", { title: "另写" }],
    ["view_canvas", {}],
    ["finish", { message: "好了" }],
  ]);
  const { run } = await execute();
  expect(run.status).toBe("completed");
  const results = outputs(seen.at(-1)!);
  // Amend with nothing held is a plain failure.
  expect(results[0].error).toContain("没有等待修正的写入");
  expect(results[1].problems.map((p: any) => p.at)).toEqual(["links.a.to", "links.b.from"]);
  expect(results[1].problems[0].problem).toContain("ghost");
  expect(results[1].note).toContain("amend: true");
  expect(results[1].note).toContain("m11");
  expect(results[2].problems.map((p: any) => p.at)).toEqual(["links.b.from"]);
  expect(results[3].revision).toBe(2);
  expect(results[4].problems.map((p: any) => p.at)).toEqual(["links.c.from", "links.c.to"]);
  const saved = store.work(work.id);
  expect(saved.title).toBe("另写");
  expect(saved.scenes.root.links.map((l) => [l.id, l.from.moduleId, l.to.moduleId])).toEqual([
    ["ok", "m0", "m1"],
    ["a", "m1", "m3"],
    ["b", "m4", "m2"],
  ]);
  expect(saved.scenes.root.modules[0]).toEqual(work.scenes.root.modules[0]);
  expect(store.revisions(work.id).map((r) => r.revision)).toEqual([3, 2, 1]);
});

it("answers tool input written broken as a failed call, holding a write's whole records for the correction", async () => {
  const module = (id: string, x = 0) => ({ id, bounds: [x, 0, 100, 60], drawingId: "tier", data: { color: "#000", label: id, tip: "" } });
  const broken = `{"modules":[${JSON.stringify(module("first"))},${JSON.stringify(module("second", 200))},{"id":"third","bounds":[0,0,1,1],"drawingId":"tier","data":{"label":"bad "quote""}}],"links":[]}`;
  expect(() => JSON.parse(broken)).toThrow();
  const seen = script([
    async ({ onEvent }) => {
      onEvent!({ type: "response.output_item.added", item: { id: "w", type: "function_call", name: "write_work", call_id: "w" } });
      return {
        items: [item("write_work", broken, "w"), item("view_canvas", {}, "v")],
        usage: { input_tokens: 100, output_tokens: 40 },
        response: {},
      };
    },
    () => ({ items: [item("draw_guide", "{not json", "g")], usage: { input_tokens: 150, output_tokens: 10 }, response: {} }),
    () => ({ items: [item("write_work", { amend: true, modules: [module("third", 400)] }, "w2"), item("view_canvas", {}, "v2")], usage: { input_tokens: 200, output_tokens: 20 }, response: {} }),
    ["finish", { message: "好了" }],
  ]);
  const { run } = await execute();
  expect(run.status).toBe("completed");
  const [write, look, guide] = outputs(seen[2]);
  // What it wrote, why it failed, which records are held, and that the look was not taken
  // at an older version.
  expect(write.error).toContain("不是有效的 JSON");
  expect(write.note).toContain("modules: first, second");
  expect(write.note).not.toContain("third");
  expect(look.error).toContain("write_work failed");
  expect(guide.error).toContain("请改正后把完整参数重发");
  expect(seen[1].find((i) => i.call_id === "w" && i.type === "function_call")!.arguments).toBe(broken);
  // The step that streamed ended.
  expect(run.steps.find((s) => s.kind === "tool" && s.id === "w")).toMatchObject({ status: "failed", error: expect.stringContaining("不是有效的 JSON") });
  // Every turn's tokens are the run's own; only the calls are counted as broken.
  expect(run.usage).toMatchObject({ input: 450, output: 70 });
  expect(run.usage!.failed).toMatchObject({ attempts: 0, invalidCalls: 2 });
  expect(store.work(work.id).scenes.root.modules.map((m) => m.id).slice(-3)).toEqual(["first", "second", "third"]);
  expect(store.revisions(work.id)).toHaveLength(2);
});

it("asks a turn that thought away its budget once more with the least thought, then returns to the configured effort", async () => {
  const thoughtOut = () => Promise.reject(new CutOff("max_output_tokens", true, { input_tokens: 100, output_tokens: 1000, output_tokens_details: { reasoning_tokens: 1000 } }));
  const efforts: unknown[] = [];
  const effort = (input: Item[]) => efforts.push(input.findLast((i) => i.type === "configuration_update")?.reasoning.effort);
  script([
    ({ input }) => (effort(input), thoughtOut()),
    ({ input }) => (effort(input), { items: [item("write_work", { title: "edited" })], usage: {}, response: {} }),
    ({ input }) => (effort(input), { items: [item("view_canvas", {})], usage: {}, response: {} }),
    ["finish", { message: "done" }],
  ]);
  const { run } = await execute();
  expect(run.status).toBe("completed");
  expect(efforts).toEqual([undefined, "low", "medium"]);
  // Thought away again at the least: it stops rather than paying a third time.
  efforts.length = 0;
  script([({ input }) => (effort(input), thoughtOut()), ({ input }) => (effort(input), thoughtOut())]);
  const { run: again } = await execute([], newRun("again"));
  expect(efforts).toEqual([undefined, "low"]);
  expect(again.usage).toMatchObject({ output: 0, failed: { attempts: 2, output: 2000 } });
  expect(again.error).toContain("思考");

  // Less thought is asked the way the request format changes effort.
  const input: Item[] = [];
  const role = (protocol: string, model: string, efforts: string[]) => ({ protocol, model, efforts, effort: "high" }) as never;
  // In the conversation: the request stays as it is, so the cached prefix holds.
  expect((withLessThought(input, role("responses", "gpt-6-astra", ["low", "high", "max"]), "max")!.role as any).effort).toBe("high");
  expect(input).toEqual([{ type: "configuration_update", reasoning: { effort: "low" } }]);
  input.length = 0;
  // A model whose effort only the request sets, such as DeepSeek's over Responses.
  expect((withLessThought(input, role("responses", "deepseek-flash", ["low", "high", "max"]), "high")!.role as any).effort).toBe("low");
  // Per request, in the turn itself.
  const chat = withLessThought(input, role("chat", "deepseek-chat", ["low", "high"]), "high")!;
  expect([chat.effort, (chat.role as any).effort, input]).toEqual(["low", "high", []]);
  expect(withLessThought(input, role("chat", "x", ["high"]), "high")).toBeUndefined();
});

it("pins a run's settings and prices across answers, other works and a storage restart", async () => {
  const user = store.userId;
  const catalog = db.models();
  const first = catalog.writers[0].models[0];
  first.model = "writer-a";
  first.prices = { input: 2, cached: 0.2, cacheWrite: 2.5, output: 10, search: 0.01 };
  catalog.writers[0].models.push({ ...structuredClone(first), id: "writer-b", model: "writer-b" });
  const image = catalog.painters[0].models[0].id;
  catalog.labels = [
    { id: "a", name: "A", description: "", writer: first.id, web: "builtin", image },
    { id: "b", name: "B", description: "", writer: "writer-b", web: "off", image },
  ];
  catalog.defaults.label = "a";
  db.saveModels(modelCatalogSchema.parse(catalog));
  const original = store.settings();
  vi.mocked(generate).mockImplementation(async () => ({
    items: [item("ask_user", ask, crypto.randomUUID())],
    usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 }, output_tokens: 100 },
    response: {},
  }));
  let agent = new Agent(() => {});
  const run = await agent.start(store, work.id, "root", "Solar system");
  await waitFor(run.id, "waiting");
  const before = store.run(run.id);
  const cost = costOf(before.usage, before.prices)!.total;
  // Another selection and an administrator's price and connection edits must not change
  // the model, tools or prices of the run already waiting for an answer.
  store.saveOwnSettings({ ...store.ownSettings(), label: "b", preferences: "New preference" });
  catalog.writers[0].credential = "new-credential";
  for (const model of catalog.writers[0].models) model.prices.output = 99;
  catalog.painters[0].models[0].model = "new-painter";
  db.saveModels(modelCatalogSchema.parse(catalog));
  const current = store.settings();
  expect(current.author.model).toBe("writer-b");
  store.commit({ ...fixture(), id: "other-work", revision: 0 }, 0, { kind: "edit" });
  const other = await agent.start(store, "other-work", "root", "Another picture");
  await waitFor(other.id, "waiting");
  expect(vi.mocked(generate).mock.calls.at(-1)![0]).toEqual(current.author);

  db.close();
  db = new Storage(dir);
  store = db.scoped(user);
  agent = new Agent(() => {});
  await agent.resume(store, run.id, "Orbits");
  await waitFor(run.id, "waiting");
  expect(vi.mocked(generate).mock.calls.at(-1)![0]).toEqual(original.author);
  expect(store.context(run.id).settings).toEqual(original);
  const resumed = store.run(run.id);
  expect(resumed.services).toEqual(before.services);
  expect(resumed.prices).toEqual(before.prices);
  expect(resumed.usage!.input).toBe(2000);
  expect(costOf(resumed.usage, resumed.prices)!.total).toBeCloseTo(cost * 2);
  expect(resumed).not.toHaveProperty("settings");
  // A new request on the same work uses today's selection.
  agent.cancel(store, run.id);
  const next = await agent.start(store, work.id, "root", "Continue");
  await waitFor(next.id, "waiting");
  expect(vi.mocked(generate).mock.calls.at(-1)![0]).toEqual(current.author);
  expect(store.context(next.id).settings).toEqual(current);
  expect(store.run(next.id).prices).toEqual(current.prices);
});

it("stops the run when the canvas cannot be looked at, instead of spending turns on it", async () => {
  vi.mocked(observe).mockRejectedValue(new Unavailable("画布查看服务不可用 (500)"));
  const seen = script([["view_canvas", {}], ["finish", { message: "never" }]]);
  const { run } = await execute();
  expect(seen).toHaveLength(1);
  expect(vi.mocked(observe)).toHaveBeenCalledTimes(3);
  expect(run.status).toBe("failed");
  expect(run.error).toContain("画布查看服务不可用");
}, 20000);

it("keeps a saved write done when its embedded view cannot reach the canvas", async () => {
  vi.mocked(observe).mockRejectedValue(new Unavailable("画布查看服务不可用 (500)"));
  script([["write_work", { title: "v2", view: { claims: ["c"] } }], ["finish", { message: "never" }]]);
  const { run } = await execute();
  expect(run.status).toBe("failed");
  const [write, view] = run.steps.filter((s) => s.kind === "tool");
  expect(write).toMatchObject({ name: "write_work", status: "done", revision: 2 });
  expect(view).toMatchObject({ name: "view_canvas", status: "failed" });
}, 20000);

it("gives guides and material cards on demand, once, and reminds the author of those it has not read", async () => {
  work.materials = {};
  store.commit(work, 1, { kind: "edit" });
  const uses = { scenes: [{ id: "root", clear: true }], modules: [{ id: "a", label: "a", bounds: [0, 0, 10, 10], drawingId: "plot" }] };
  const seen = script([
    ["set_brief", { ...brief, cast: [], basis: { subject: "苹果", intent: "苹果" } }],
    ["write_work", uses],
    ["write_work", { ...uses, title: "again" }],
    [item("draw_guide", { topics: ["maps", "copy"] }, "g1"), item("read_materials", { ids: ["arrow", "geomap", "no-such"] }, "r1")],
    // Asked again: what was shown is above, and only plot is new.
    [item("draw_guide", { topics: ["maps"] }, "g2"), item("read_materials", { ids: ["geomap", "arrow", "plot"] }, "r2")],
    ["draw_guide", {}],
    // Asked for in the same message as the brief and the write, nothing is pointed out.
    [item("set_brief", { ...brief, cast: [], basis: { subject: "苹果", intent: "苹果" } }, "s2"), item("draw_guide", { topics: ["diagrams"] }, "d2")],
    [item("write_work", { ...uses, modules: [{ ...uses.modules[0], drawingId: "bars" }] }, "w3"), item("read_materials", { ids: ["bars"] }, "d3")],
    ["view_canvas", {}],
    ["finish", { message: "done" }],
  ]);
  const run = await new Agent(() => {}).start(store, work.id, "root", "画苹果");
  await waitFor(run.id, "completed");
  const [settled, written, again, guide, first, guideAgain, second, empty, settledAgain, , writtenAgain] = outputs(seen.at(-1)!);
  expect(settled.guides).toContain("draw_guide");
  expect(written.cardsUnread).toEqual(["plot"]);
  expect(again.cardsUnread).toBeUndefined();
  // Guides read as text under their topics, and cards one line of JSON each.
  const cards = (text: string) => text.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line));
  expect([...guide.matchAll(/^## (\w+)$/gm)].map((m: string[]) => m[1])).toEqual(["maps", "copy"]);
  expect(guide).toContain("Real geography comes from data.");
  // No guide names a library material; the map drawing is found by searching.
  expect(guide).not.toContain("geomap");
  expect(cards(first).map((d: any) => d.id)).toEqual(["arrow", "geomap"]);
  expect(cards(first)[0]).toMatchObject({ use: "link", size: "200×60", example: { flow: true }, version: 1 });
  expect(first).toContain("Not in the library: no-such.");
  expect(guideAgain).toContain("Already above in this conversation: maps.");
  expect(cards(second).map((d: any) => d.id)).toEqual(["plot"]);
  expect(second).toContain("Already above in this conversation: geomap, arrow.");
  expect(empty.error).toBeTruthy();
  expect(settledAgain.guides).toBeUndefined();
  expect(writtenAgain.cardsUnread).toBeUndefined();
  expect(store.run(run.id).steps.find((s) => s.kind === "tool" && s.name === "draw_guide")).toMatchObject({
    status: "done",
    topics: ["maps", "copy"],
  });
  expect(store.run(run.id).steps.find((s) => s.kind === "tool" && s.name === "read_materials")).toMatchObject({
    status: "done",
    ids: ["arrow", "geomap"],
  });
  // A card read before a summary, or by a call refused or not yet answered, is not above;
  // nor is one the answer left out.
  const read = [
    { type: "function_call", name: "read_materials", call_id: "a", arguments: '{"ids":["geomap","plot"]}' },
    { type: "function_call_output", call_id: "a", output: '{"id":"geomap","version":1}\n\nNot shown, to keep this answer short: plot.' },
  ];
  expect([...guidesRead(read).drawings]).toEqual(["geomap"]);
  expect(guidesRead([{ role: "user", content: "Conversation summary. …" }]).topics.size).toBe(0);
  expect(guidesRead(read.slice(0, 1)).drawings.size).toBe(0);
  for (const args of ['{"topics":["maps","bogus"]}', "{not json"])
    expect(guidesRead([{ ...read[0], name: "draw_guide", arguments: args }, { ...read[1], output: '{"error":"x"}' }]).topics.size).toBe(0);
});

it("does not take a withdrawn style for a new brief", async () => {
  library.library.withdraw("crayon");
  const { style, chosen } = await resolveStyle("crayon", store.viewer, "expressive");
  expect(style.id).not.toBe("crayon");
  expect(chosen).toBe(true);
});

it("answers a tool the author invented with an error, and goes on", async () => {
  const seen = script([
    ["parallel", { tool_uses: [{ recipient_name: "functions.read_work", parameters: {} }] }],
    ["read_work", {}],
    ["view_canvas", {}],
    ["finish", { message: "done" }],
  ]);
  const run = await new Agent(() => {}).start(store, work.id, "root", "看看");
  await waitFor(run.id, "completed");
  const [invented] = outputs(seen.at(-1)!);
  expect(JSON.stringify(invented)).toContain("没有 parallel 这个工具");
});

it("gives the cards of what a search finds when asked, and counts them as read", async () => {
  work.materials = {};
  store.commit(work, 1, { kind: "edit" });
  const seen = script([
    ["find_materials", { subjects: ["柱状图", "苹果"], cards: true }],
    ["read_materials", { ids: ["bars"] }],
    ["write_work", { scenes: [{ id: "root", clear: true }], modules: [{ id: "a", label: "a", bounds: [0, 0, 10, 10], drawingId: "bars" }] }],
    ["view_canvas", {}],
    ["finish", { message: "done" }],
  ]);
  const run = await new Agent(() => {}).start(store, work.id, "root", "画柱状图");
  await waitFor(run.id, "completed");
  const [found, again, written] = outputs(seen.at(-1)!);
  expect(found.results[0].hits[0]).toMatchObject({ id: "bars", match: "exact" });
  // A search result never carries code; the card asked for does, and pictures get none.
  expect(JSON.stringify(found.results)).not.toContain("example");
  expect(found.cards).toContain('{"id":"bars","version":1');
  expect(found.cards).not.toContain('"id":"apple"');
  expect(again).toContain("Already above in this conversation: bars.");
  expect(written.cardsUnread).toBeUndefined();
});

it("gives a search's card at the version the work holds", async () => {
  // The work holds bars at version 1; the library has moved on to version 2.
  const bars = library.library.get("bars") as DrawingMaterial;
  library.library.catalog.put({ ...bars, about: bars.about + " Newer.", version: 2, hash: "newer" });
  work.materials = { bars: { id: "bars", kind: "drawing", version: 1, name: "柱状图", source: bars.source, defaults: {}, params: {} } };
  store.commit(work, 1, { kind: "edit" });
  const seen = script([
    ["find_materials", { subjects: ["柱状图"], cards: true }],
    ["finish", { message: "done" }],
  ]);
  const run = await new Agent(() => {}).start(store, work.id, "root", "看看");
  await vi.waitFor(() => expect(["completed", "failed"]).toContain(store.run(run.id).status));
  const [found] = outputs(seen.at(-1)!);
  expect(found.cards).toContain('{"id":"bars","version":1');
  expect(found.cards).not.toContain("Newer.");
});

it("keeps the instructions and tools the same for every request, with what only some works need listed to read", async () => {
  // Two users, each with their own preferences and works, are sent the same prefix.
  const other = db.scoped(register(db, "other", "abcdef").id);
  other.saveOwnSettings({ ...other.ownSettings(), preferences: "少用红色" });
  other.commit({ ...fixture(), revision: 0 }, 0, { kind: "edit" });
  const prefixes: string[] = [];
  vi.mocked(generate).mockImplementation(async (_role, turn) => {
    prefixes.push(JSON.stringify([turn.instructions, turn.tools]));
    return { items: [item("ask_user", ask, crypto.randomUUID())], usage: {}, response: {} };
  });
  const agent = new Agent(() => {});
  const started: string[] = [];
  for (const s of [store, other]) {
    const run = await agent.start(s, work.id, "root", "画");
    started.push(run.id);
    await vi.waitFor(() => expect(s.run(run.id).status).toBe("waiting"));
  }
  expect(prefixes).toHaveLength(2);
  expect(prefixes[0]).toBe(prefixes[1]);
  expect(vi.mocked(generate).mock.calls.map(([, t]) => t.cacheKey)).toEqual([store.userId, other.userId]);
  // Every guide is listed with when to read it.
  const instructions = JSON.parse(prefixes[0])[0] as string;
  expect(Object.keys(guides).sort()).toEqual([...guideTopics].sort());
  for (const topic of guideTopics) expect(instructions).toContain(`- ${topic}: ${guides[topic].when}.`);
  expect(instructions + Object.values(guides).map((g) => g.text).join("")).not.toMatch(/\b(MUST|NEVER|ALWAYS|IMPORTANT|CRITICAL)\b/);
  // The instructions describe how the library is used, never what it holds: no style,
  // effect or drawing of the library is named but the app's own three, and adding to the
  // library leaves them byte for byte the same.
  const named = ["colored-pencil", "ink-wash", "pencil-grain", "rough-edge", "geomap", "step-badge", "leader-label"];
  for (const id of named) expect(instructions).not.toContain(id);
  library.library.catalog.put({
    ...(library.library.get("label") as DrawingMaterial),
    id: "label-extra",
    name: { zh: "新画法", en: "Extra" },
  });
  agent.cancel(store, started[0]);
  const later = await agent.start(store, work.id, "root", "再画");
  await vi.waitFor(() => expect(store.run(later.id).status).toBe("waiting"));
  expect(prefixes[2]).toBe(prefixes[0]);
  expect(instructions.length).toBeLessThan(20000);
});

it("observes in the same turn when write_work carries view, skips it on write failure, and does not double-capture beside view_canvas", async () => {
  const seen = script([
    // Failed write: embedded view must not run.
    ["write_work", { modules: [{ id: "bad", label: "bad", bounds: [0, 0, 10, 10], drawingId: "missing" }], view: { claims: ["skip"] } }],
    // Valid write with view: saves and captures in one turn, passing claims through.
    ["write_work", { modules: [{ id: "m1", label: "ok", bounds: [0, 0, 40, 40], drawingId: "plot" }], view: { claims: ["m1 sits at origin"] } }],
    // Batch with both write_work(view) and view_canvas: captures once, not twice.
    [
      item("write_work", { title: "v2", view: { claims: ["ignored duplicate"] } }, "w2"),
      item("view_canvas", { claims: ["explicit look"] }, "v2"),
    ],
    ["finish", { message: "all checked" }],
  ]);
  const { run } = await execute();
  expect(run.status).toBe("completed");
  expect(vi.mocked(observe)).toHaveBeenCalledTimes(2);
  expect(vi.mocked(observe).mock.calls[0][2]).toEqual({ claims: ["m1 sits at origin"] });
  expect(vi.mocked(observe).mock.calls[1][2]).toEqual({ claims: ["explicit look"] });
  const [, writtenWithView, batchWrite] = outputs(seen.at(-1)!);
  expect(writtenWithView.view).toMatchObject({ revision: 2, overview: true });
  expect(batchWrite.view).toBeUndefined();
  const viewSteps = run.steps.filter((s) => s.kind === "tool" && s.name === "view_canvas");
  expect(viewSteps).toHaveLength(2);
  expect(viewSteps.every((s) => s.status === "done")).toBe(true);
});

it("sends image-only requests without synthetic no-words or language prompts, lets set_brief cite the picture, ignores drawing-id collisions in module data, and skips redundant view_canvas on read-only turns", async () => {
  const reference = await client.ingest(
    await picture(),
    "image/png",
    { type: "object", name: { zh: "评审表", en: "review" }, style: null, origin: { kind: "upload" } },
    store.userId,
  );
  // First run: image-only request (no typed text).
  const firstSeen = script([
    ["set_brief", { ...brief, cast: [], basis: { subject: reference.id, intent: reference.id } }],
    [
      "write_work",
      {
        drawings: [{ id: "glyph-box", name: "Glyph", source: "return api.html(`<div>${api.data.glyph}</div>`)" }],
        scenes: [{ id: "root", clear: true }],
        modules: [{ id: "g1", label: "g1", bounds: [0, 0, 40, 40], drawingId: "glyph-box", data: { glyph: "gauge" } }],
        view: { claims: ["g1 shown"] },
      },
    ],
    ["finish", { message: "drawn" }],
  ]);
  const agent = new Agent(() => {});
  const run1 = await agent.start(store, work.id, "root", "", [reference.id]);
  await waitFor(run1.id, "completed");
  const userTurn = firstSeen[0].find((i: Item) => Array.isArray(i.content))!;
  const texts = (userTurn.content as { type: string; text?: string }[]).filter((p) => p.type === "input_text").map((p) => p.text ?? "");
  expect(texts.join("\n")).not.toMatch(/Pictures only|no words|The user reads/i);
  expect(texts.join("\n")).toContain(reference.id);
  const [, written] = outputs(firstSeen.at(-1)!);
  // Module data { glyph: "gauge" } must not pull the library "gauge" drawing into work.materials.
  expect(written.materialsAdded).toBeUndefined();
  expect(written.cardsUnread).toBeUndefined();
  expect(store.work(work.id).materials.gauge).toBeUndefined();

  // Second run: pure Q&A turn without edits completes without forcing view_canvas again.
  vi.mocked(observe).mockClear();
  script([["finish", { message: "这是面向客户的概览图。" }]]);
  const run2 = await agent.start(store, work.id, "root", "这是专业级别的架构图？");
  await waitFor(run2.id, "completed");
  expect(vi.mocked(observe)).not.toHaveBeenCalled();
  expect(store.run(run2.id).steps.filter((s) => s.kind === "tool")).toEqual([]);
});

it("keeps top-level request effort pinned across runs on conversation-effort models and switches via configuration_update", async () => {
  const catalog = db.models();
  catalog.writers[0].models[0].model = "gpt-6.2-sol";
  catalog.writers[0].models[0].efforts = ["low", "medium", "high"];
  catalog.writers[0].models[0].effort = "medium";
  db.saveModels(modelCatalogSchema.parse(catalog));
  const seen: { roleEffort: string; turnEffort?: string; updates: string[] }[] = [];
  vi.mocked(generate).mockImplementation(async (role, turn) => {
    seen.push({
      roleEffort: role.effort,
      turnEffort: turn.effort,
      updates: turn.input
        .filter((i) => i.type === "configuration_update")
        .map((i) => i.reasoning.effort),
    });
    return { items: [item("view_canvas", {})], usage: {}, response: {} };
  });
  const agent = new Agent(() => {});
  // Run 1 at medium: opens conversation at baseEffort = medium, no configuration_update.
  vi.mocked(generate)
    .mockImplementationOnce(async (role, turn) => {
      seen.push({
        roleEffort: role.effort,
        turnEffort: turn.effort,
        updates: turn.input.filter((i) => i.type === "configuration_update").map((i) => i.reasoning.effort),
      });
      return { items: [item("view_canvas", {})], usage: {}, response: {} };
    })
    .mockImplementationOnce(async (role, turn) => {
      seen.push({
        roleEffort: role.effort,
        turnEffort: turn.effort,
        updates: turn.input.filter((i) => i.type === "configuration_update").map((i) => i.reasoning.effort),
      });
      return { items: [item("finish", { message: "done 1" })], usage: {}, response: {} };
    });
  const run1 = await agent.start(store, work.id, "root", "第一稿");
  await waitFor(run1.id, "completed");
  expect(seen).toEqual([
    { roleEffort: "medium", turnEffort: "medium", updates: [] },
    { roleEffort: "medium", turnEffort: "medium", updates: [] },
  ]);

  // Run 2 switches effort to high: top-level role.effort stays pinned at medium, input appends configuration_update(high).
  catalog.writers[0].models[0].effort = "high";
  db.saveModels(modelCatalogSchema.parse(catalog));
  seen.length = 0;
  vi.mocked(generate).mockImplementationOnce(async (role, turn) => {
    seen.push({
      roleEffort: role.effort,
      turnEffort: turn.effort,
      updates: turn.input.filter((i) => i.type === "configuration_update").map((i) => i.reasoning.effort),
    });
    return { items: [item("finish", { message: "done 2" })], usage: {}, response: {} };
  });
  const run2 = await agent.start(store, work.id, "root", "第二轮用 high");
  await waitFor(run2.id, "completed");
  expect(seen).toEqual([{ roleEffort: "medium", turnEffort: "high", updates: ["high"] }]);

  // Run 3 switches back to medium: top-level role.effort stays medium, input appends configuration_update(medium).
  catalog.writers[0].models[0].effort = "medium";
  db.saveModels(modelCatalogSchema.parse(catalog));
  seen.length = 0;
  vi.mocked(generate).mockImplementationOnce(async (role, turn) => {
    seen.push({
      roleEffort: role.effort,
      turnEffort: turn.effort,
      updates: turn.input.filter((i) => i.type === "configuration_update").map((i) => i.reasoning.effort),
    });
    return { items: [item("finish", { message: "done 3" })], usage: {}, response: {} };
  });
  const run3 = await agent.start(store, work.id, "root", "第三轮切回 medium");
  await waitFor(run3.id, "completed");
  expect(seen).toEqual([{ roleEffort: "medium", turnEffort: "medium", updates: ["high", "medium"] }]);
});

it("exempts the drawings the library binds to text, pictures and links from cardsUnread and treats cards as read in set_brief", async () => {
  work.materials = {};
  store.commit(work, 1, { kind: "edit" });
  const seen = script([
    [
      item("set_brief", { ...brief, cast: [], basis: { subject: "苹果", intent: "苹果" } }, "s1"),
      item("read_materials", { ids: ["bars"] }, "d1"),
    ],
    [
      "write_work",
      {
        scenes: [{ id: "root", clear: true }],
        modules: [
          { id: "p1", label: "p1", bounds: [0, 0, 100, 100], drawingId: "picture", data: { material: "apple-textbook" } },
          { id: "l1", bounds: [0, 110, 100, 30], drawingId: "label", data: { text: "苹果" } },
        ],
        links: [{ id: "k1", from: "p1", to: "l1", drawingId: "arrow" }],
        view: { claims: ["p1 and l1 linked"] },
      },
    ],
    ["finish", { message: "done" }],
  ]);
  const run = await new Agent(() => {}).start(store, work.id, "root", "画苹果");
  await waitFor(run.id, "completed");
  const [settled, , written] = outputs(seen.at(-1)!);
  expect(settled.guides).toBeUndefined();
  expect(written.cardsUnread).toBeUndefined();
});


